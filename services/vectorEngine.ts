import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

/**
 * Environment-adaptive vector search engine for eternal memory.
 *
 * Design contract (owner requirements, 2026-10-17):
 * - Never degrade: full-memory cosine ranking at any size; no cap hides data.
 * - Scale to millions: HNSW ANN (USearch) persisted on disk.
 * - Bounded RAM, honestly: reads use a memory-mapped view. Writes NEVER load
 *   the index on the request path - they go to a durable pending-writes log
 *   first (crash-safe intent), and a debounced flusher applies them in one
 *   batch: load (transient RAM spike ~ index size, logged), write, save, and
 *   drop back to the mmap view unless the probe says the machine can keep a
 *   resident writable copy. Search merges the (small) pending log exactly, so
 *   fresh memories are always searchable before the flush.
 * - Consistency: open() verifies count AND an ids digest of the projection
 *   (source of truth); mismatch rebuilds. A failed queue write marks the
 *   index stale: searches fall back to the exact scan until rebuild.
 * - Adapts anywhere: CPU/RAM/disk probed at startup; USearch native does
 *   runtime SIMD dispatch (correct and fast with or without AVX); the exact
 *   paged JS scan is the universal fallback. The choice is logged.
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
// Key mapping
// ---------------------------------------------------------------------------

/** Stable u64 key for a memory id: first 8 bytes of sha256. */
export function memoryIdToU64(id: string): bigint {
    const digest = createHash('sha256').update(id).digest();
    return digest.readBigUInt64BE(0);
}

function idsDigest(ids: string[]): string {
    const sorted = [...new Set(ids)].sort();
    return createHash('sha256').update(sorted.join('')).digest('hex');
}

// ---------------------------------------------------------------------------
// ANN index for one embedding identity
// ---------------------------------------------------------------------------

export interface AnnRow { id: string; vector: number[]; ownerId: string }
export type AnnRowProvider = () => Promise<AnnRow[]>;
export type AnnIdsProvider = () => Promise<string[]>;

export interface AnnOpenReport {
    source: 'view' | 'rebuilt' | 'fresh';
    size: number;
    expected: number;
    fileMB: number;
}

interface PendingWrite { u64: string; id: string; owner_id: string; op: 'add' | 'del'; vector: string | null; ts: number }

/**
 * One HNSW index per embedding identity (<dir>/<name>.usearch) with its key
 * map, meta digest and durable pending-writes log in a shared sqlite file.
 * Reads memory-map the index (bounded RAM at any size). Writes are queued
 * durably BEFORE the canonical write (intent-first) and applied in batches.
 */
export class AnnIndex {
    private writable: any | null = null;
    private readable: any | null = null;
    private flushTimer: NodeJS.Timeout | null = null;
    private flushing: Promise<void> | null = null;
    private stale = false;
    public readonly file: string;

    constructor(
        private readonly opts: {
            dir: string;
            name: string;
            dimensions: number;
            Index: UsearchModule['Index'];
            sqlite: any; // better-sqlite3 Database
            flushMs?: number;
            probe?: VectorEnvProbe;
        },
    ) {
        this.file = path.join(opts.dir, `${opts.name}.usearch`);
        opts.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${opts.name}" (u64 TEXT PRIMARY KEY, id TEXT NOT NULL, owner_id TEXT NOT NULL)`);
        opts.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${opts.name}__meta" (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
        opts.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${opts.name}__pending" (u64 TEXT PRIMARY KEY, id TEXT NOT NULL, owner_id TEXT NOT NULL, op TEXT NOT NULL, vector TEXT, ts INTEGER NOT NULL)`);
    }

    private get dimensions() { return this.opts.dimensions; }
    /** Test-only fault injection: throw at a named flush point to simulate a crash. */
    static faultHook: ((point: 'after-apply-before-save' | 'after-save-before-commit' | 'after-commit', name: string) => void) | null = null;
    private fault(point: 'after-apply-before-save' | 'after-save-before-commit' | 'after-commit'): void {
        AnnIndex.faultHook?.(point, this.opts.name);
    }
    private generation(): number {
        return parseInt(this.metaGet('generation') ?? '0', 10);
    }
    private metaGet(k: string): string | null {
        return (this.opts.sqlite.prepare(`SELECT v FROM "${this.opts.name}__meta" WHERE k = ?`).get(k) as { v: string } | undefined)?.v ?? null;
    }
    private metaSet(k: string, v: string): void {
        this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}__meta" (k, v) VALUES (?, ?)`).run(k, v);
    }
    private mapCount(): number {
        return this.opts.sqlite.prepare(`SELECT COUNT(*) AS c FROM "${this.opts.name}"`).get().c as number;
    }
    private pendingAll(): PendingWrite[] {
        return this.opts.sqlite.prepare(`SELECT * FROM "${this.opts.name}__pending" ORDER BY ts ASC`).all() as PendingWrite[];
    }
    private pendingCount(): number {
        return this.opts.sqlite.prepare(`SELECT COUNT(*) AS c FROM "${this.opts.name}__pending"`).get().c as number;
    }

    markStale(reason: string): void {
        if (!this.stale) console.error(`[VECTOR] ${this.opts.name}: index marked STALE (${reason}); searches use the exact scan until the next rebuild`);
        this.stale = true;
    }
    isStale(): boolean { return this.stale; }

    /** Open: mmap the persisted index when it provably matches the projection (count + ids digest); otherwise rebuild from the projection. Pending intents are always flushed after opening. */
    async open(projectedCount: number, rows: AnnRowProvider, ids: AnnIdsProvider): Promise<AnnOpenReport> {
        fs.mkdirSync(this.opts.dir, { recursive: true });
        const mapped = this.mapCount();
        if (fs.existsSync(this.file)) {
            try {
                const idx = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos' });
                idx.view(this.file);
                const idList = await ids();
                const digest = idsDigest(idList);
                const uniqueCount = new Set(idList).size;
                if (idx.size() === uniqueCount && mapped === uniqueCount && this.metaGet('idsDigest') === digest) {
                    this.readable = idx;
                    const fileMB = fs.statSync(this.file).size / 1e6;
                    console.log(`[VECTOR] ${this.opts.name}: memory-mapped ANN index (${uniqueCount} vectors, ${fileMB.toFixed(0)}MB on disk, RAM bounded by page cache)`);
                    await this.flushPending();
                    // A validated reopen (count + ids digest match, pending log
                    // flushed) proves the on-disk index matches the projection,
                    // so it clears a stale mark just like a rebuild does.
                    this.stale = false;
                    return { source: 'view', size: uniqueCount, expected: projectedCount, fileMB };
                }
                console.warn(`[VECTOR] ${this.opts.name}: content mismatch (index=${idx.size()}, map=${mapped}, projection=${uniqueCount} unique of ${projectedCount} rows, digestMatch=${this.metaGet('idsDigest') === digest}) - rebuilding from projection`);
            } catch (e) {
                console.warn(`[VECTOR] ${this.opts.name}: unreadable index file (${(e as Error).message}) - rebuilding from projection`);
            }
        }
        await this.rebuild(rows);
        await this.flushPending();
        return { source: this.size() > 0 ? 'rebuilt' : 'fresh', size: this.size(), expected: projectedCount, fileMB: fs.existsSync(this.file) ? fs.statSync(this.file).size / 1e6 : 0 };
    }

    private async rebuild(rows: AnnRowProvider): Promise<void> {
        const all = await rows();
        const idx = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos', connectivity: 16, expansion_add: 128, expansion_search: 64 });
        this.opts.sqlite.prepare(`DELETE FROM "${this.opts.name}"`).run();
        const insert = this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}" (u64, id, owner_id) VALUES (?, ?, ?)`);
        const vec = new Float32Array(this.dimensions);
        const ids: string[] = [];
        const seenKeys = new Set<string>();
        for (const row of all) {
            if (!Array.isArray(row.vector) || row.vector.length !== this.dimensions) continue;
            const key = memoryIdToU64(row.id);
            const keyStr = key.toString();
            if (seenKeys.has(keyStr)) {
                // The projection can hold a duplicate id (observed in prod
                // 2026-10-19: one byte-identical row pair). The index is a set:
                // keep the first copy, log loudly, never crash the rebuild.
                console.warn(`[VECTOR] ${this.opts.name}: projection holds a duplicate id (${row.id}); keeping the first copy`);
                continue;
            }
            seenKeys.add(keyStr);
            for (let i = 0; i < this.dimensions; i++) vec[i] = row.vector[i];
            idx.add(key, vec);
            insert.run(keyStr, row.id, row.ownerId || 'system');
            ids.push(row.id);
        }
        this.metaSet('idsDigest', idsDigest(ids));
        this.writable = idx;
        this.readable = idx;
        this.saveNow();
        this.stale = false;
        console.log(`[VECTOR] ${this.opts.name}: rebuilt ANN index from projection (${idx.size()} vectors)`);
    }

    size(): number {
        return (this.readable ? this.readable.size() : 0) + this.pendingCount();
    }

    /**
     * Durable intent-first write: the pending row is the recovery record, so
     * it is committed BEFORE the caller's canonical write. Applied to the HNSW
     * index by the debounced flusher; searchable immediately via merge.
     */
    queueUpsert(id: string, ownerId: string, vector: ArrayLike<number>): void {
        const key = memoryIdToU64(id);
        const existing = this.opts.sqlite.prepare(`SELECT id FROM "${this.opts.name}" WHERE u64 = ?`).get(key.toString()) as { id: string } | undefined;
        if (existing && existing.id !== id) {
            throw new Error(`ANN key collision between ${existing.id} and ${id}; exact scan covers both until re-keyed`);
        }
        this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}__pending" (u64, id, owner_id, op, vector, ts) VALUES (?, ?, ?, 'add', ?, ?)`)
            .run(key.toString(), id, ownerId || 'system', JSON.stringify(Array.from(vector as ArrayLike<number>)), Date.now());
        this.scheduleFlush();
    }

    queueRemove(id: string): void {
        const key = memoryIdToU64(id);
        this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}__pending" (u64, id, owner_id, op, vector, ts) VALUES (?, ?, ?, 'del', NULL, ?)`)
            .run(key.toString(), id, 'system', Date.now());
        this.scheduleFlush();
    }

    /**
     * Apply the durable pending log to the index in one batch. This is the
     * ONLY place a writable index is loaded: transient RAM spike ~= index
     * file size, logged honestly. Afterwards the writable copy is dropped back
     * to a memory-mapped view unless the probe says the machine has RAM to
     * keep it resident (headroom rule: index fits in a quarter of total RAM).
     */
    async flushPending(): Promise<void> {
        if (this.flushing) return this.flushing;
        this.flushing = this.doFlush().finally(() => { this.flushing = null; });
        return this.flushing;
    }

    private async doFlush(): Promise<void> {
        const pending = this.pendingAll();
        if (pending.length === 0) return;
        const fileMB = fs.existsSync(this.file) ? fs.statSync(this.file).size / 1e6 : 0;
        if (!this.writable) {
            const t0 = performance.now();
            const idx = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos', connectivity: 16, expansion_add: 128, expansion_search: 64 });
            if (fs.existsSync(this.file)) idx.load(this.file);
            this.writable = idx;
            console.log(`[VECTOR] ${this.opts.name}: loaded writable index for ${pending.length} pending writes (${fileMB.toFixed(0)}MB transient RAM, load ${(performance.now() - t0).toFixed(0)}ms)`);
        }
        const insert = this.opts.sqlite.prepare(`INSERT OR REPLACE INTO "${this.opts.name}" (u64, id, owner_id) VALUES (?, ?, ?)`);
        const delMap = this.opts.sqlite.prepare(`DELETE FROM "${this.opts.name}" WHERE u64 = ?`);
        const delPending = this.opts.sqlite.prepare(`DELETE FROM "${this.opts.name}__pending" WHERE u64 = ?`);
        const idRows = this.opts.sqlite.prepare(`SELECT id FROM "${this.opts.name}"`).all() as { id: string }[];
        const ids = idRows.map(r => r.id);
        const vec = new Float32Array(this.dimensions);
        // Phase 1: apply every intent to the writable index and the key map.
        // The durable pending rows are NOT touched here: they are the only
        // recovery record if the process dies before the index hits the disk.
        for (const w of pending) {
            const key = BigInt(w.u64);
            this.writable.remove(key);
            if (w.op === 'add' && w.vector) {
                const arr = JSON.parse(w.vector) as number[];
                for (let i = 0; i < this.dimensions; i++) vec[i] = arr[i];
                this.writable.add(key, vec);
                insert.run(w.u64, w.id, w.owner_id);
                if (!ids.includes(w.id)) ids.push(w.id);
            } else {
                delMap.run(w.u64);
                const at = ids.indexOf(w.id);
                if (at >= 0) ids.splice(at, 1);
            }
        }
        this.metaSet('idsDigest', idsDigest(ids));
        this.fault('after-apply-before-save');
        // Phase 2: persist the index. Pending rows survive a crash here, and
        // replay is idempotent (remove+add under the same u64 key).
        this.saveNow();
        this.fault('after-save-before-commit');
        // Phase 3: atomic commit - only once a committed index generation
        // exists on disk do the journal intents go away, and the generation
        // bump travels in the same sqlite transaction as the purge.
        const commit = this.opts.sqlite.transaction(() => {
            for (const w of pending) delPending.run(w.u64);
            this.metaSet('generation', String(this.generation() + 1));
        });
        commit();
        this.fault('after-commit');
        this.stale = false;
        const ramMB = this.opts.probe?.ramTotalMB ?? 0;
        const keepResident = ramMB > 0 && fileMB * 4 < ramMB;
        if (keepResident) {
            this.readable = this.writable;
        } else {
            // Drop the writable copy: RAM returns to the page cache. Reads continue on the mmap view.
            const idx = new this.opts.Index({ dimensions: this.dimensions, metric: 'cos' });
            idx.view(this.file);
            this.readable = idx;
            this.writable = null;
            console.log(`[VECTOR] ${this.opts.name}: writable copy dropped (index ${fileMB.toFixed(0)}MB vs ${ramMB}MB RAM); reads back on memory-mapped view`);
        }
    }

    private saveNow(): void {
        if (!this.writable) return;
        this.writable.save(this.file);
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        const ms = this.opts.flushMs ?? 30000;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flushPending().catch((e) => {
                this.markStale(`flush failed: ${(e as Error).message}`);
            });
        }, ms);
        this.flushTimer.unref?.();
    }

    /**
     * Search: ANN candidates (escalating fetch until the owner-scope filter is
     * satisfied or the whole index was considered - no starvation) MERGED with
     * an exact scan of the small durable pending log, so just-written memories
     * always appear. Returns {id, score} best-first.
     */
    search(vector: ArrayLike<number>, limit: number, ownerScope?: string): { id: string; score: number }[] {
        const vec = new Float32Array(this.dimensions);
        for (let i = 0; i < this.dimensions; i++) vec[i] = Number(vector[i]);
        const byId = new Map<string, number>();

        if (this.readable && this.readable.size() > 0) {
            const mapRow = this.opts.sqlite.prepare(`SELECT id, owner_id FROM "${this.opts.name}" WHERE u64 = ?`);
            let want = Math.min(this.readable.size(), ownerScope ? Math.max(limit * 5, 64) : limit);
            for (;;) {
                const result = this.readable.search(vec, want);
                const keys: bigint[] = Array.from(result.keys as BigUint64Array);
                const dists: number[] = Array.from(result.distances as Float32Array);
                for (let i = 0; i < keys.length; i++) {
                    const row = mapRow.get(keys[i].toString()) as { id: string; owner_id: string } | undefined;
                    if (!row) continue;
                    if (ownerScope && row.owner_id !== ownerScope && row.owner_id !== 'system') continue;
                    byId.set(row.id, 1 - dists[i]);
                }
                if (byId.size >= limit || want >= this.readable.size()) break;
                want = Math.min(this.readable.size(), want * 10);
            }
        }

        // Exact pass over the durable pending log (small: bounded by flush cadence).
        for (const w of this.pendingAll()) {
            if (w.op === 'del') { byId.delete(w.id); continue; }
            if (ownerScope && w.owner_id !== ownerScope && w.owner_id !== 'system') continue;
            const arr = JSON.parse(w.vector || '[]') as number[];
            let dot = 0, na = 0, nb = 0;
            for (let i = 0; i < this.dimensions; i++) { dot += arr[i] * vec[i]; na += arr[i] * arr[i]; nb += vec[i] * vec[i]; }
            if (na > 0 && nb > 0) byId.set(w.id, dot / (Math.sqrt(na) * Math.sqrt(nb)));
        }

        return [...byId.entries()]
            .map(([id, score]) => ({ id, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
}
