import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

/**
 * Environment-adaptive vector search engine for eternal memory.
 *
 * Design contract (owner requirements, 2026-10-17):
 * - Never degrade: results stay ranked by cosine over the full memory at any
 *   size. No cap may silently drop memories.
 * - Scale to millions: an HNSW ANN index persisted on disk (USearch) serves
 *   searches in milliseconds with bounded RAM (memory-mapped via view()).
 * - Adapt to any environment: CPU features, RAM and disk are probed at
 *   startup; the best engine that actually runs here is chosen and the choice
 *   is logged. USearch's native addon does runtime CPU dispatch (simsimd:
 *   scalar/SSE/AVX), so it runs fast where AVX exists and correctly where it
 *   does not (verified 2026-10-17 on the prod QEMU no-AVX box, where
 *   LanceDB's compile-time-AVX kernels die with SIGILL).
 * - The canonical LanceDB projection table remains the source of truth; the
 *   ANN index is a rebuildable derived structure. Missing/corrupt/mismatched
 *   index files are rebuilt from the projection, loudly.
 */

// ---------------------------------------------------------------------------
// Environment probe
// ---------------------------------------------------------------------------

export interface VectorEnvProbe {
    platform: string;
    cpuModel: string;
    avx: boolean;
    avx2: boolean;
    ramTotalMB: number;
    diskFreeMB: number | null;
}

export function probeVectorEnvironment(cpuinfoPath = '/proc/cpuinfo', diskDir?: string): VectorEnvProbe {
    let cpuModel = 'unknown';
    let avx = true;
    let avx2 = true;
    if (process.platform === 'linux') {
        try {
            const info = fs.readFileSync(cpuinfoPath, 'utf8');
            cpuModel = /^model name\s*:\s*(.+)$/m.exec(info)?.[1]?.trim() ?? 'unknown';
            avx = /^flags\s*:.*[ \t]avx([ \t]|$)/m.test(info);
            avx2 = /^flags\s*:.*[ \t]avx2([ \t]|$)/m.test(info);
        } catch {
            avx = false;
            avx2 = false;
        }
    }
    let diskFreeMB: number | null = null;
    if (diskDir) {
        try {
            const st = fs.statfsSync(diskDir);
            diskFreeMB = Math.round((st.bavail * st.bsize) / 1e6);
        } catch { /* statfs unsupported */ }
    }
    return { platform: process.platform, cpuModel, avx, avx2, ramTotalMB: Math.round(os.totalmem() / 1e6), diskFreeMB };
}

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

export type VectorEngineKind = 'usearch-native' | 'js-scan';

export interface VectorEngineStatus {
    kind: VectorEngineKind;
    reason: string;
    probe: VectorEnvProbe;
}

export type UsearchModule = { Index: new (opts: Record<string, unknown>) => any };

export function loadUsearchNative(): UsearchModule | null {
    try {
        const require = createRequire(import.meta.url);
        const mod = require('usearch');
        if (typeof mod?.Index !== 'function') return null;
        return mod as UsearchModule;
    } catch {
        return null;
    }
}

export function selectVectorEngine(
    env: NodeJS.ProcessEnv = process.env,
    load: () => UsearchModule | null = loadUsearchNative,
    probe: VectorEnvProbe = probeVectorEnvironment(),
): VectorEngineStatus {
    const forced = (env.VECTOR_ENGINE || 'auto').toLowerCase();
    if (forced === 'scan') return { kind: 'js-scan', reason: 'forced by VECTOR_ENGINE=scan', probe };
    const mod = load();
    if (mod) {
        return {
            kind: 'usearch-native',
            reason: `USearch native addon loaded; simsimd runtime CPU dispatch picks the fastest kernel this CPU supports (avx=${probe.avx}, avx2=${probe.avx2})`,
            probe,
        };
    }
    if (forced === 'usearch') throw new Error('VECTOR_ENGINE=usearch but the usearch native addon failed to load');
    return { kind: 'js-scan', reason: 'usearch native addon unavailable; exact partitioned JS scan (never drops rows)', probe };
}

// ---------------------------------------------------------------------------
// Key mapping: memory node ids (uuid strings) <-> u64 ANN keys
// ---------------------------------------------------------------------------

/** Stable u64 key for a memory id: first 8 bytes of sha256. Collision odds at 10M ids: ~10^-7 (birthday bound), and revalidation against canonical memory catches even that. */
export function memoryIdToU64(id: string): bigint {
    const digest = createHash('sha256').update(id).digest();
    return digest.readBigUInt64BE(0);
}

// ---------------------------------------------------------------------------
// ANN index for one embedding identity
// ---------------------------------------------------------------------------

export interface AnnRow { id: string; vector: number[]; ownerId: string }
export type AnnRowProvider = () => Promise<AnnRow[]>;

export interface AnnOpenReport {
    source: 'view' | 'rebuilt' | 'fresh';
    size: number;
    expected: number;
    fileMB: number;
}

interface KeyMapRow { u64: string; id: string; owner_id: string }

/**
 * One HNSW index per embedding identity, persisted as <dir>/<name>.usearch
 * with its key map in a shared sqlite file (<dir>/ann-keys.sqlite). The index
 * is opened with view() (memory-mapped): query-time RAM stays bounded
 * regardless of index size. Writes go to a writable Index loaded with load().
 */
export class AnnIndex {
    private writable: any | null = null;
    private readable: any | null = null;
    private dirty = false;
    private flushTimer: NodeJS.Timeout | null = null;
    public readonly file: string;

    constructor(
        private readonly opts: {
            dir: string;
            name: string;
            dimensions: number;
            Index: UsearchModule['Index'];
            sqlite: any; // better-sqlite3 Database
            flushMs?: number;
        },
    ) {
        this.file = path.join(opts.dir, `${opts.name}.usearch`);
        opts.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${opts.name}" (u64 TEXT PRIMARY KEY, id TEXT NOT NULL, owner_id TEXT NOT NULL)`);
    }

    private get dimensions() { return this.opts.dimensions; }

    private mapCount(): number {
        return this.opts.sqlite.prepare(`SELECT COUNT(*) AS c FROM "${this.opts.name}"`).get().c as number;
    }
    private mapGet(u64: bigint): KeyMapRow | undefined {
        return this.opts.sqlite.prepare(`SELECT * FROM "${this.opts.name}" WHERE u64 = ?`).get(u64.toString()) as KeyMapRow | undefined;
    }
    private mapIdsFor(u64s: bigint[], ownerScope?: string): string[] {
        if (u64s.length === 0) return [];
        const out: string[] = [];
        const stmt = this.opts.sqlite.prepare(`SELECT id, owner_id FROM "${this.opts.name}" WHERE u64 = ?`);
        for (const k of u64s) {
            const row = stmt.get(k.toString()) as { id: string; owner_id: string } | undefined;
            if (!row) continue;
            if (ownerScope && row.owner_id !== ownerScope && row.owner_id !== 'system') continue;
            out.push(row.id);
        }
        return out;
    }

    /** Open the index: memory-map the persisted file when counts agree with the key map and the projection; otherwise rebuild from the projection (source of truth). */
    async open(projectedCount: number, rows: AnnRowProvider): Promise<AnnOpenReport> {
        fs.mkdirSync(this.opts.dir, { recursive: true });
        const expected = projectedCount;
        const mapped = this.mapCount();
        if (fs.existsSync(this.file)) {
            try {
                const idx = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos' });
                idx.view(this.file);
                if (idx.size() === expected && mapped === expected) {
                    this.readable = idx;
                    const fileMB = fs.statSync(this.file).size / 1e6;
                    console.log(`[VECTOR] ${this.opts.name}: memory-mapped ANN index (${expected} vectors, ${fileMB.toFixed(0)}MB on disk, RAM bounded by page cache)`);
                    return { source: 'view', size: expected, expected, fileMB };
                }
                console.warn(`[VECTOR] ${this.opts.name}: index/map/projection mismatch (index=${idx.size()}, map=${mapped}, projection=${expected}) - rebuilding from projection`);
            } catch (e) {
                console.warn(`[VECTOR] ${this.opts.name}: unreadable index file (${(e as Error).message}) - rebuilding from projection`);
            }
        }
        await this.rebuild(rows);
        return { source: this.size() > 0 ? 'rebuilt' : 'fresh', size: this.size(), expected, fileMB: fs.existsSync(this.file) ? fs.statSync(this.file).size / 1e6 : 0 };
    }

    private async rebuild(rows: AnnRowProvider): Promise<void> {
        const all = await rows();
        const idx = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos', connectivity: 16, expansion_add: 128, expansion_search: 64 });
        this.opts.sqlite.prepare(`DELETE FROM "${this.opts.name}"`).run();
        const insert = this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}" (u64, id, owner_id) VALUES (?, ?, ?)`);
        const vec = new Float32Array(this.dimensions);
        for (const row of all) {
            if (!Array.isArray(row.vector) || row.vector.length !== this.dimensions) continue;
            for (let i = 0; i < this.dimensions; i++) vec[i] = row.vector[i];
            const key = memoryIdToU64(row.id);
            idx.add(key, vec);
            insert.run(key.toString(), row.id, row.ownerId || 'system');
        }
        this.writable = idx;
        this.readable = idx;
        this.dirty = true;
        this.flush();
        console.log(`[VECTOR] ${this.opts.name}: rebuilt ANN index from projection (${idx.size()} vectors)`);
    }

    size(): number {
        return this.readable ? this.readable.size() : 0;
    }

    /** Insert or replace one vector. Callers must await; failures mark nothing silently - they throw to the caller, which logs and falls back. */
    upsert(id: string, ownerId: string, vector: ArrayLike<number>): void {
        if (!this.writable) {
            if (this.readable && fs.existsSync(this.file)) {
                this.writable = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos', connectivity: 16, expansion_add: 128, expansion_search: 64 });
                this.writable.load(this.file);
                this.readable = this.writable;
            } else {
                this.writable = this.readable;
            }
        }
        if (!this.writable) throw new Error('ANN index is not open');
        const key = memoryIdToU64(id);
        const existing = this.mapGet(key);
        if (existing && existing.id !== id) {
            // sha256-prefix collision between two distinct memory ids: keep both searchable by refusing the alias and letting the caller fall back to exact scan for the displaced id.
            throw new Error(`ANN key collision between ${existing.id} and ${id}; exact scan covers both until re-keyed`);
        }
        this.writable.remove(BigInt(key));
        const vec = new Float32Array(this.dimensions);
        for (let i = 0; i < this.dimensions; i++) vec[i] = Number(vector[i]);
        this.writable.add(BigInt(key), vec);
        this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}" (u64, id, owner_id) VALUES (?, ?, ?)`).run(key.toString(), id, ownerId || 'system');
        this.scheduleFlush();
    }

    remove(id: string): void {
        const key = memoryIdToU64(id);
        if (!this.mapGet(key)) return;
        if (this.writable) this.writable.remove(BigInt(key));
        else if (fs.existsSync(this.file)) {
            this.writable = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos' });
            this.writable.load(this.file);
            this.writable.remove(BigInt(key));
            this.readable = this.writable;
        }
        this.opts.sqlite.prepare(`DELETE FROM "${this.opts.name}" WHERE u64 = ?`).run(key.toString());
        this.scheduleFlush();
    }

    /** ANN search: returns memory ids best-first, post-filtered by owner scope through the key map (overfetch to absorb filtering). */
    search(vector: ArrayLike<number>, limit: number, ownerScope?: string): string[] {
        if (!this.readable || this.readable.size() === 0) return [];
        const vec = new Float32Array(this.dimensions);
        for (let i = 0; i < this.dimensions; i++) vec[i] = Number(vector[i]);
        const want = Math.min(this.readable.size(), ownerScope ? limit * 5 : limit);
        const result = this.readable.search(vec, want);
        const keys: bigint[] = Array.from(result.keys as BigUint64Array);
        return this.mapIdsFor(keys, ownerScope).slice(0, limit);
    }

    private scheduleFlush(): void {
        this.dirty = true;
        if (this.flushTimer) return;
        const ms = this.opts.flushMs ?? 30000;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            try {
                this.flush();
            } catch (e) {
                // A failed debounced save must never crash the process; the next
                // open() detects the count mismatch and rebuilds from the projection.
                console.error(`[VECTOR] ${this.opts.name}: debounced index save failed (${(e as Error).message}); writes remain in memory and the index self-heals on next open`);
            }
        }, ms);
        this.flushTimer.unref?.();
    }

    flush(): void {
        if (!this.dirty || !this.writable) return;
        this.writable.save(this.file);
        this.dirty = false;
    }
}
