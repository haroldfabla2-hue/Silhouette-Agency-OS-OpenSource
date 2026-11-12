import type * as lancedb from '@lancedb/lancedb';
const loadLanceRuntime = () => import('@lancedb/lancedb');
import path from 'path';
import fs from 'fs';
import { createHash } from 'node:crypto';
import { MemoryNode, MemoryTier } from '../types';

// Vitest workers must not mutate the same LanceDB directory concurrently.
const DB_PATH = process.env.SILHOUETTE_LANCEDB_PATH || path.resolve(process.cwd(), 'db', process.env.VITEST_WORKER_ID
    ? `silhouette-test-worker-${process.env.VITEST_WORKER_ID}.lancedb`
    : 'silhouette.lancedb');
const DEFAULT_DIMENSIONS = 768; // Hardcoded default to match the original schema
// Identified reads keep projection + canonical JSON in memory together. The
// general 25k scan page is too large for that join (real 256MiB canary OOM).
// This is a batch bound, not a corpus/result ceiling; every page is read.
const CANONICAL_VECTOR_PAGE_ROWS = 256;

import { validEmbedding, scopeSql, inScope, type EmbeddingIdentity, type MemoryScope } from './memoryRetrieval';
import { cosineSimilarity, rankByCosine, toNumericArray, scanPageRows } from './vectorScan';
import { selectVectorEngine, probeVectorEnvironment, AnnIndex, type UsearchModule, loadUsearchNative } from './vectorEngine';
import Database from 'better-sqlite3';
import { Schema, Field, FixedSizeList, Float32, Utf8, Float64 } from 'apache-arrow';

function adjustVectorDimension(vector: number[], targetDim: number = DEFAULT_DIMENSIONS): number[] {
    if (!validEmbedding(vector, { model: 'knowledge', version: '1', dimension: targetDim })) {
        throw new Error('Invalid embedding: dimension, finite values and nonzero magnitude required');
    }
    return vector;
}


/**
 * [Ticket W7] universal_knowledge table — canonical vector dimension.
 * LEGACY_EMBEDDING.dimension is 768 (memoryRetrieval.ts); every knowledge
 * write must carry a valid embedding of this size. The table is created
 * EMPTY with an explicit Arrow schema (never inferred from a first record —
 * the old lazy path would have let an empty vector poison the schema).
 */
export const KNOWLEDGE_VECTOR_DIM = 768;

function knowledgeSchema(): Schema {
    return new Schema([
        new Field('id', new Utf8()),
        new Field('content', new Utf8()),
        new Field('category', new Utf8(), true),
        new Field('source', new Utf8(), true),
        new Field('path', new Utf8(), true),
        new Field('timestamp', new Float64(), true),
        new Field('vector', new FixedSizeList(KNOWLEDGE_VECTOR_DIM, new Field('item', new Float32()))),
    ]);
}

export class LanceDbService {
    private annStatus: ReturnType<typeof selectVectorEngine> | null = null;
    private annModule: UsearchModule | null = null;
    private annSqlite: any = null;
    private annIndexes = new Map<string, AnnIndex>();
    private annInitLogged = false;

    private observationConnection:Promise<lancedb.Connection>|null=null;
    private observationCache=new Map<string,{version:string;node:MemoryNode|null}>();
    private db: lancedb.Connection | null = null;
    private table: lancedb.Table | null = null; // Memory Table
    private legacyTable: lancedb.Table | null = null;
    private ftsReady = new Set<string>();
    private knowledgeTable: lancedb.Table | null = null; // Universal Knowledge Table
    private initialized = false;
    private writeQueue: Promise<void> = Promise.resolve();
    private initPromise: Promise<void> | null = null;

    constructor(private readonly databasePath = DB_PATH) {
        // Lazy initialization - called explicitly from dbLoader or on first use
    }

    /** Explicit initialization (called from dbLoader at startup) */
    private knowledgeTableEnsured = false;

    /**
     * [Ticket W7] Create universal_knowledge EMPTY with an explicit schema,
     * once, with an explicit log line. Root cause of the months-long "table
     * not ready": the only production writer was never wired (dead init) and
     * the lazy create-from-first-record path would have poisoned the schema
     * with an empty vector. Explicit and logged per Alberto's rule; creates
     * nothing if the table already exists.
     */
    public async ensureKnowledgeTable(): Promise<void> {
        if (this.knowledgeTableEnsured) return;
        if (!this.db) await this.init();
        if (!this.db) {
            console.error('[LANCEDB] ensureKnowledgeTable: db unavailable — table NOT created (explicit, no silent skip)');
            return;
        }
        try {
            const names = await this.db.tableNames();
            if (names.includes('universal_knowledge')) {
                this.knowledgeTable = await this.db.openTable('universal_knowledge');
            } else {
                this.knowledgeTable = await this.db.createEmptyTable('universal_knowledge', knowledgeSchema());
                console.log(`[LANCEDB] Created EMPTY 'universal_knowledge' table with explicit schema (vector dim ${KNOWLEDGE_VECTOR_DIM}).`);
            }
            this.knowledgeTableEnsured = true;
        } catch (e) {
            console.error('[LANCEDB] ensureKnowledgeTable failed:', e);
        }
    }

    public async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        await this.init();
    }

    private init(retries = 3, delayMs = 1000): Promise<void> {
        if (this.initialized) return Promise.resolve();
        if (!this.initPromise) {
            this.initPromise = this.initOnce(retries, delayMs).finally(() => { this.initPromise = null; });
        }
        return this.initPromise;
    }

    private async initOnce(retries = 3, delayMs = 1000) {
        if (this.initialized) return;

        let attempt = 0;
        while (attempt < retries) {
            try {
                if (attempt > 0) {
                    console.log(`[LANCEDB] 🔄 Retry attempt ${attempt + 1}/${retries}...`);
                    await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
                } else {
                    console.log(`[LANCEDB] Connecting to: ${DB_PATH}`);
                }

                fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
                this.db = await (await loadLanceRuntime()).connect(this.databasePath);
                const tableNames = await this.db.tableNames();

                // 1. Memory Table
                if (tableNames.includes('memory')) {
                    this.legacyTable = await this.db.openTable('memory');
                } else {
                    console.log("[LANCEDB] Table 'memory' not found. It will be created on first insert.");
                }

                // 2. Universal Knowledge Table
                if (tableNames.includes('universal_knowledge')) {
                    this.knowledgeTable = await this.db.openTable('universal_knowledge');
                } else {
                    console.log("[LANCEDB] Table 'universal_knowledge' not found. Will be created on ingest.");
                }

                if (tableNames.includes('memory_records_v2')) this.table = await this.db.openTable('memory_records_v2');
                this.initialized = true;
                this.startOptimizeLoop();
                console.log("[LANCEDB] Connected.");
                return;

            } catch (e: any) {
                console.error(`[LANCEDB] Initialization Failed (Attempt ${attempt + 1}/${retries}):`, e.message);
                attempt++;
            }
        }

        // Exhausted retries
        console.error("[LANCEDB] 🚨 FATAL: LanceDB connection completely failed after retries.");
        try {
            const { systemBus } = await import('./systemBus');
            systemBus.emit('PROTOCOL_SYSTEM_ALERT' as any, {
                component: 'LanceDB',
                error: 'Connection Exhaustion',
                severity: 'CRITICAL',
                message: 'LanceDB vector database failed to initialize. Storage may be locked or corrupted.',
                timestamp: Date.now()
            }, 'system-kernel');
        } catch (e) {
            console.error("[LANCEDB] Could not emit SYSTEM_ALERT:", e);
        }
    }

    public async deleteNode(id: string): Promise<boolean> {
        if (!this.table) await this.init();
        if (!this.table && !this.legacyTable) return false;
        try {
            // [FIX 2026-02] Sanitize ID to prevent SQL injection
            const safeId = id.replace(/'/g, "''");
            for (const table of [this.table, this.legacyTable]) { if (table) await table.delete(`id = '${safeId}'`); }
            for (const ann of this.annIndexes.values()) {
                try { ann.queueRemove(id); } catch (e) { console.error(`[VECTOR] ANN remove failed for ${id}`, e); ann.markStale(`queueRemove failed: ${(e as Error).message}`); }
            }
            return true;
        } catch (e) {
            console.error(`[LANCEDB] Failed to delete node ${id}`, e);
            return false;
        }
    }

    /** A successful write is confirmed by a read of the same ID and payload. */
    public async store(node: MemoryNode, vector?: number[]): Promise<{ ok: true; id: string; checksum: string; version: number }> {
        if (!node?.id || !node.content?.trim() || node.content === 'undefined') {
            throw new Error('Invalid memory node: refusing persistent write');
        }
        // Serialize writes through first-table creation and upserts in this process.
        const operation = this.writeQueue.then(() => this.writeAndVerify(node, vector));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    private toRecord(node: MemoryNode, json?: string) {
        const jsonData = json ?? JSON.stringify(node);
        return {
            id: node.id,
            embedding_state: 'EMBEDDING_PENDING',
            content: node.content,
            originalContent: node.originalContent || '',
            tags: node.tags.length ? node.tags : [''],
            importance: node.importance,
            timestamp: node.timestamp,
            tier: node.tier,
            ownerId: node.ownerId || 'system',
            accessCount: node.accessCount,
            lastAccess: node.lastAccess,
            stabilityScore: node.stabilityScore || 0,
            json_data: jsonData
        };
    }

    /**
     * Bulk store for seed/import paths: ONE merge transaction for the whole
     * batch instead of a merge + read-back per node. Sequential store() per
     * filler row made the P1 retrieval test exceed its 120s cap on
     * constrained/shared machines (verified 2026-10-15 on an 8GB shared box:
     * 502 stores = 502 merge transactions + 502 read-back queries). Same
     * refusal rules and writeQueue serialization as store().
     */
    public async storeMany(nodes: MemoryNode[]): Promise<{ ok: true; count: number }> {
        for (const node of nodes) {
            if (!node?.id || !node.content?.trim() || node.content === 'undefined') {
                throw new Error('Invalid memory node: refusing persistent write');
            }
        }
        const operation = this.writeQueue.then(() => this.writeManyAndVerify(nodes));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    /**
     * A cached Table handle pins the Lance version it was opened at. The
     * periodic optimizer rewrites fragments during compaction, so a handle
     * opened before a compaction can reference data files that no longer
     * exist; every read or merge through it then fails with
     * LanceError(IO) "Not found" until the process restarts (prod incident
     * 2026-10-23). Reopening binds the current version, so on that exact
     * signature the cached handle is replaced once and the operation retried
     * once. Operation closures must read this.table/this.legacyTable at call
     * time so the retry uses the fresh handle.
     */
    /** Lance commit conflicts (e.g. CreateIndex preempted by a concurrent
     *  compaction Rewrite) are explicitly retryable: re-open the table to
     *  rebase onto the latest version and try again. */
    private static isRetryableCommitConflict(error: unknown): boolean {
        const message = (error as Error)?.message ?? String(error);
        return message.includes('Retryable commit conflict');
    }

    private async reopenTable(tableName: 'memory_records_v2' | 'memory'): Promise<void> {
        const fresh = await this.db!.openTable(tableName);
        if (tableName === 'memory_records_v2') { this.table = fresh; this.ftsReady.delete('v2'); }
        else { this.legacyTable = fresh; this.ftsReady.delete('legacy'); }
    }

    private static isStaleHandleError(error: unknown): boolean {
        const message = String(error);
        return message.includes('LanceError(IO)') && /not found/i.test(message);
    }

    private async withCurrentTable<T>(tableName: 'memory_records_v2' | 'memory', operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (!this.db || !LanceDbService.isStaleHandleError(error)) throw error;
            console.warn(`[LANCEDB] Cached handle for '${tableName}' references pruned fragments; reopening and retrying once.`);
            await this.reopenTable(tableName);
            return await operation();
        }
    }

    private async writeManyAndVerify(nodes: MemoryNode[]): Promise<{ ok: true; count: number }> {
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB is unavailable');
        if (nodes.length === 0) return { ok: true, count: 0 };
        const records = nodes.map(n => this.toRecord(n));
        if (!this.table) {
            const names = await this.db.tableNames();
            this.table = names.includes('memory_records_v2')
                ? await this.db.openTable('memory_records_v2')
                : await this.db.createTable('memory_records_v2', records);
        } else {
            // Same atomic merge as store(): update on id match, insert otherwise.
            await this.withCurrentTable('memory_records_v2', () => this.table!.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute(records));
        }
        this.ftsReady.delete('v2');
        // Read-back spot check on the batch edges (first + last). Full per-row
        // read-back is exactly what makes bulk seeding slow; store() keeps it
        // for single writes.
        for (const edge of [nodes[0], nodes[nodes.length - 1]]) {
            const stored = await this.getNodeById(edge.id);
            if (!stored) throw new Error(`LanceDB bulk read-back verification failed for ${edge.id}`);
        }
        return { ok: true, count: nodes.length };
    }

    private async writeAndVerify(node: MemoryNode, vector?: number[]): Promise<{ ok: true; id: string; checksum: string; version: number }> {
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB is unavailable');
        const json = JSON.stringify(node);
        const checksum = createHash('sha256').update(json).digest('hex');
        const record = this.toRecord(node, json);
        if (!this.table) {
            const names = await this.db.tableNames();
            this.table = names.includes('memory_records_v2')
                ? await this.db.openTable('memory_records_v2')
                : await this.db.createTable('memory_records_v2', [record]);
        } else {
            // Atomic merge rather than delete + add, which loses the old row on add failure.
            await this.withCurrentTable('memory_records_v2', () => this.table!.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute([record]));
        }
        this.ftsReady.delete('v2');
        // Unknown legacy vectors are never guessed into a model collection.
        if (vector && node.embeddingIdentity && validEmbedding(vector, node.embeddingIdentity)) {
            try { await this.projectEmbedding(node, vector, node.embeddingIdentity); }
            catch (error) { console.warn('[LANCEDB] Vector projection pending; canonical memory preserved', error); }
        }
        const stored = await this.getNodeById(node.id);
        if (!stored || createHash('sha256').update(JSON.stringify(stored)).digest('hex') !== checksum) {
            throw new Error(`LanceDB read-back verification failed for ${node.id}`);
        }
        return { ok: true, id: node.id, checksum, version: node.timestamp };
    }

    public async getNodeById(id: string): Promise<MemoryNode | null> {
        await this.ensureInitialized();
        const safeId = id.replace(/'/g, "''");
        for (const tableName of ['memory_records_v2', 'memory'] as const) {
            const rows = await this.withCurrentTable(tableName, async () => {
                const current = (tableName === 'memory_records_v2' ? this.table : this.legacyTable);
                if (!current) return [];
                return current.query().where(`id = '${safeId}'`).limit(2).toArray();
            });
            if (rows.length > 1) throw new Error(`Duplicate memory ID in LanceDB: ${id}`);
            if (rows.length) return JSON.parse(rows[0].json_data) as MemoryNode;
        }
        return null;
    }

    /**
     * Batched canonical hydration before vector ranking.
     * One hydration query (+ one scope query when filtered) per table/batch,
     * instead of one full scan per id:
     * Lance has no secondary index on `id`, so N point lookups cost N full
     * table scans (the 2026-10-18 production meltdown: 50 lookups/search x
     * queued searches pinned the tokio threads at ~300% CPU).
     */
    private async getNodesByIds(ids: string[], filter?: string): Promise<Map<string, MemoryNode>> {
        const found = new Map<string, MemoryNode>();
        if (!ids.length || !this.db) return found;
        const names = await this.db.tableNames();
        const resolved = new Set<string>();
        for (const tableName of ['memory_records_v2', 'memory'] as const) {
            const missing = [...new Set(ids)].filter(id => !resolved.has(id));
            if (!missing.length) continue;
            const quoted = missing.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
            if (!names.includes(tableName)) continue;
            // A cached writer handle may predate another process's canonical
            // update. Open the current table for each batch, without mutation.
            const current = await this.db.openTable(tableName);
            const rows = await current.query().select(['id', 'json_data']).where(`id IN (${quoted})`).limit(missing.length * 2).toArray();
            // Evaluate arbitrary SQL filters on canonical columns as well as
            // projection columns. Resolve IDs even if filtered or malformed so
            // an older legacy row cannot replace a newer excluded v2 record.
            const eligible = filter ? new Set((await current.query().select(['id'])
                .where(`id IN (${quoted}) AND (${filter})`).limit(missing.length * 2).toArray())
                .map(row => row.id)) : null;
            const seen = new Set<string>();
            for (const row of rows) {
                if (seen.has(row.id)) throw new Error(`Duplicate memory ID in LanceDB: ${row.id}`);
                seen.add(row.id);
                resolved.add(row.id);
                if (eligible && !eligible.has(row.id)) continue;
                try {
                    const node = JSON.parse(row.json_data) as MemoryNode;
                    if (node && node.id === row.id) found.set(row.id, node);
                } catch { /* Malformed canonical payload is not vector evidence. */ }
            }
        }
        return found;
    }

    /**
     * Periodic compaction WITHOUT version pruning. Inserts and merge-inserts
     * append one fragment each; with no compaction the canonical table had
     * accumulated 4157 fragments and every query opened thousands of files.
     * Data and history are preserved: old versions are never deleted here
     * (Alberto's rule: backup and ask before deleting anything).
     * Set LANCEDB_OPTIMIZE_INTERVAL_MINUTES=0 to disable; default 360 (6h).
     */
    private optimizeTimer: ReturnType<typeof setInterval> | null = null;
    private optimizeRunning = false;
    /**
     * Compaction WITHOUT version pruning (Alberto's approved design for this
     * loop: "compact only, no version prune"; his standing rule is backup and
     * ask before deleting anything). `cleanupOlderThan` is a DELETE threshold:
     * versions committed before that instant are removed, and the binding's
     * default (7 days) still prunes history. The epoch instant removes only
     * "versions older than 1970", i.e. nothing - compaction runs, no version
     * or fragment is ever deleted automatically. The old '2999-01-01' value
     * had the semantics inverted and deleted every unreferenced file at each
     * compaction, breaking every cached handle (prod incident 2026-10-23).
     * Any future retention policy is Alberto's explicit decision, not a code
     * default. Disk growth is bounded by table size and reviewed in audits.
     */
    private static readonly OPTIMIZE_NEVER_PRUNE_BEFORE = new Date(0);

    private startOptimizeLoop(): void {
        if (this.optimizeTimer) return;
        const raw = process.env.LANCEDB_OPTIMIZE_INTERVAL_MINUTES;
        const minutes = raw === undefined ? 360 : Number(raw);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            console.log('[LANCEDB] Periodic optimize disabled (LANCEDB_OPTIMIZE_INTERVAL_MINUTES).');
            return;
        }
        this.optimizeTimer = setInterval(() => { void this.runOptimizeOnce(); }, minutes * 60_000);
        this.optimizeTimer.unref?.();
        console.log(`[LANCEDB] Periodic optimize every ${minutes} minutes (compact only, no version prune).`);
    }

    public async runOptimizeOnce(): Promise<void> {
        if (this.optimizeRunning || !this.db) return;
        this.optimizeRunning = true;
        try {
            const names = await this.db.tableNames();
            for (const n of names.filter(x => x === 'memory_records_v2' || x.startsWith('memory_vectors_'))) {
                const t = await this.db.openTable(n);
                await t.optimize({ cleanupOlderThan: LanceDbService.OPTIMIZE_NEVER_PRUNE_BEFORE, deleteUnverified: false });
                console.log(`[LANCEDB] Optimize completed for ${n} (compact only, no version prune).`);
            }
        } catch (e) {
            console.warn('[LANCEDB] Optimize failed; will retry on next interval.', e);
        } finally {
            this.optimizeRunning = false;
        }
    }

    private vectorTableName(identity: EmbeddingIdentity): string {
        return 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
    }
    public async projectEmbedding(node: MemoryNode, vector: number[], identity: EmbeddingIdentity): Promise<void> {
        if (!validEmbedding(vector, identity)) throw new Error('Invalid or incompatible embedding');
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB is unavailable');
        const name = this.vectorTableName(identity);
        const record = { id: node.id, vector, ownerId: node.ownerId || 'system', json_data: JSON.stringify(node) };
        const names = await this.db.tableNames();
        const table = names.includes(name) ? await this.db.openTable(name) : await this.db.createTable(name, [record]);
        // Intent-first: the durable ANN pending row is written BEFORE the
        // canonical projection, so a crash between the two is replayed on the
        // next open (pending flush) instead of silently desyncing the index.
        let ann: AnnIndex | null = null;
        if (this.ensureAnnEngine()) {
            try {
                ann = await this.annIndexFor(name, identity.dimension, () => this.projectionRows(table), await table.countRows(), table);
                ann.queueUpsert(node.id, node.ownerId || 'system', vector);
            } catch (e) {
                console.error(`[VECTOR] ANN queue failed for ${node.id} (${(e as Error).message}); exact scan covers this memory until rebuild`);
                ann?.markStale(`queueUpsert failed: ${(e as Error).message}`);
            }
        }
        await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([record]);
        if (this.table) await this.withCurrentTable('memory_records_v2', () => this.table!.update({ where: `id = '${node.id.replace(/'/g, "''")}'`, values: { embedding_state: 'READY' } }));
    }
    public async pendingEmbeddings(limit = 100): Promise<MemoryNode[]> {
        await this.ensureInitialized();
        if (!this.table) return [];
        const rows = await this.withCurrentTable('memory_records_v2', () => this.table!.query().where("embedding_state = 'EMBEDDING_PENDING'").limit(limit).toArray());
        return rows.map(r => JSON.parse(r.json_data));
    }
    /** Engine selection happens once and is logged loudly: which engine, why, and what this machine offers. */
    private ensureAnnEngine(): boolean {
        if (this.annStatus) return this.annStatus.kind === 'usearch-native';
        const probe = probeVectorEnvironment('/proc/cpuinfo', path.dirname(this.databasePath));
        this.annModule = loadUsearchNative();
        this.annStatus = selectVectorEngine(process.env, () => this.annModule, probe);
        console.log(`[VECTOR] engine=${this.annStatus.kind} - ${this.annStatus.reason} | cpu="${probe.cpuModel}" ram=${probe.ramTotalMB}MB diskFree=${probe.diskFreeMB ?? '?'}MB`);
        if (this.annStatus.kind === 'usearch-native' && this.annModule) {
            const annDir = path.join(DB_PATH, 'ann');
            fs.mkdirSync(annDir, { recursive: true });
            this.annSqlite = new Database(path.join(annDir, 'ann-keys.sqlite'));
            this.annSqlite.pragma('journal_mode = WAL');
        }
        return this.annStatus.kind === 'usearch-native';
    }

    /** Extract the owner scope from a scopeSql() filter; null when the filter is not a scope filter (falls back to exact scan). */
    private static ownerScopeFromFilter(filter?: string): string | null | undefined {
        if (!filter) return undefined;
        if (filter.trim() === 'true') return undefined;
        const m = /^\(`ownerId` = '((?:[^']|'')+)' OR `ownerId` = 'system'\)$/.exec(filter.trim());
        return m ? m[1].replace(/''/g, "'") : null;
    }

    private async annIndexFor(name: string, dimensions: number, rowProvider: () => Promise<{ id: string; vector: number[]; ownerId: string }[]>, projectedCount: number, table: any): Promise<AnnIndex> {
        let idx = this.annIndexes.get(name);
        if (!idx) {
            idx = new AnnIndex({ dir: path.join(DB_PATH, 'ann'), name, dimensions, Index: this.annModule!.Index, sqlite: this.annSqlite, probe: this.annStatus?.probe });
            this.annIndexes.set(name, idx);
            const idsProvider = async () => (await table.query().select(['id']).toArray()).map((r: any) => r.id as string);
            await idx.open(projectedCount, rowProvider, idsProvider);
        }
        return idx;
    }

    /** Bounded top-k merge: keeps at most `limit` entries, so the exact fallback never holds more than one page plus k winners in memory. */
    private static mergeTopK(top: { id: string; _score: number }[], page: { id: string; _score: number }[], limit: number): { id: string; _score: number }[] {
        const merged = top.concat(page);
        merged.sort((a, b) => b._score - a._score);
        return merged.slice(0, limit);
    }

    /** Projection rows for (re)building an identity's ANN index from the source of truth. */
    private async projectionRows(table: any): Promise<{ id: string; vector: number[]; ownerId: string }[]> {
        const rows = await table.query().toArray();
        const out: { id: string; vector: number[]; ownerId: string }[] = [];
        for (const r of rows as any[]) {
            const vector = toNumericArray(r.vector);
            if (vector) out.push({ id: r.id, vector, ownerId: r.ownerId || 'system' });
        }
        return out;
    }

    public async search(queryVector: number[], limit = 10, filter?: string, identity?: EmbeddingIdentity): Promise<MemoryNode[]> {
        if (!identity || !validEmbedding(queryVector, identity) || !Number.isInteger(limit) || limit < 1) return [];
        await this.ensureInitialized();
        if (!this.db) return [];
        const name = this.vectorTableName(identity);
        if (!(await this.db.tableNames()).includes(name)) return [];
        const table = await this.db.openTable(name);
        const rowCount = await table.countRows();
        // ANN IDs alone cannot prove that the projected payload still matches
        // canonical content/identity. Use the paged exact read until that path
        // can validate candidates before top-k without losing later valid hits.
        // This is read-time payload validation, not a generation/ABA guarantee.
        const pageRows = Math.min(scanPageRows(), CANONICAL_VECTOR_PAGE_ROWS);
        type Candidate = { id: string; ownerId: string; json_data: string; score: number };
        // Stable ID tie-break, independent of scan delivery order. Old tied
        // scores had unspecified scan order; no historical tie-order claim.
        const before = (a: Candidate, b: Candidate) => b.score - a.score || a.id.localeCompare(b.id);
        const candidates = (rows: any[]): Candidate[] => rows.flatMap(row => {
            const vector = toNumericArray(row.vector);
            const score = vector && cosineSimilarity(vector, queryVector);
            return score === null ? [] : [{ id: row.id, ownerId: row.ownerId,
                json_data: row.json_data, score }];
        });
        const validate = async (rows: Candidate[]) => {
            const byId = await this.getNodesByIds(rows.map(row => row.id), filter);
            // Acceptance belongs to this exact projection row, never just its
            // ID: historical projections may contain duplicate IDs.
            const valid = new Map<Candidate, MemoryNode>();
            for (const row of rows) {
                const current = byId.get(row.id);
                if (!current) continue;
                let projected: MemoryNode;
                try { projected = JSON.parse(row.json_data); } catch { continue; }
                const matchesIdentity = (node: MemoryNode) =>
                    node.embeddingIdentity?.model === identity.model &&
                    node.embeddingIdentity?.version === identity.version &&
                    node.embeddingIdentity?.dimension === identity.dimension;
                if (projected?.id === row.id && current.id === row.id &&
                    matchesIdentity(projected) && matchesIdentity(current) &&
                    typeof projected.content === 'string' && typeof current.content === 'string' &&
                    projected.content === current.content &&
                    (projected.ownerId || 'system') === (current.ownerId || 'system') &&
                    row.ownerId === (current.ownerId || 'system') &&
                    Array.isArray(projected.tags) && Array.isArray(current.tags) &&
                    JSON.stringify(projected.tags) === JSON.stringify(current.tags)) valid.set(row, current);
            }
            return valid;
        };
        const readPage = async (offset: number) => {
            let scan = table.query().limit(pageRows).offset(offset);
            if (filter) scan = scan.where(filter);
            return candidates(await scan.toArray());
        };
        const distinct = (rows: Candidate[]): Candidate[] => {
            const seen = new Set<string>();
            return rows.filter(row => {
                if (seen.has(row.id)) return false;
                seen.add(row.id);
                return true;
            });
        };
        const firstWindow = async (): Promise<MemoryNode[] | null> => {
            // Rank a bounded candidate window, not final top-k. A full
            // projection sweep proves rows outside this window cannot outrank
            // it. Only return when validation fills k; stale rows never cause
            // a premature partial result.
            let window: Candidate[] = [];
            for (let offset = 0; offset < rowCount; offset += pageRows) {
                window = window.concat(await readPage(offset)).sort(before).slice(0, CANONICAL_VECTOR_PAGE_ROWS);
            }
            const current = await validate(window);
            const accepted = distinct(window.filter(row => current.has(row)));
            return accepted.length >= limit ? accepted.slice(0, limit).map(row => current.get(row)!) : null;
        };
        // k larger than one window cannot benefit from the fast path.
        if (limit <= CANONICAL_VECTOR_PAGE_ROWS) {
            const selected = await firstWindow();
            if (selected) return selected;
        }
        // One-window miss: exhaustive validated paged scan, NOT repeated
        // candidate sweeps. This bounds stale-heavy overhead to one extra
        // projection sweep + one canonical batch above the previous exact path.
        // Revalidate rather than reusing stale canonical snapshots from above.
        let top: Candidate[] = [];
        const winners = new Map<string, MemoryNode>();
        for (let offset = 0; offset < rowCount; offset += pageRows) {
            const page = await readPage(offset);
            const current = await validate(page);
            top = distinct(top.concat(page.filter(row => current.has(row))).sort(before)).slice(0, limit);
            for (const row of top) if (current.has(row)) winners.set(row.id, current.get(row)!);
            const retained = new Set(top.map(row => row.id));
            for (const id of winners.keys()) if (!retained.has(id)) winners.delete(id);
        }
        // No later unvalidated hydration. Same-content ABA and a concurrent
        // global snapshot remain outside this read contract.
        return top.map(row => winners.get(row.id)!);
    }

    /**
     * Finds semantically similar nodes to the given existing node ID.
     */
    public async findSimilarNodes(nodeId: string, limit: number = 5): Promise<(MemoryNode & { similarity?: number })[]> {
        const node = await this.getNodeById(nodeId);
        if (!node?.embeddingIdentity || !node.embeddingVector) return [];
        const neighbors = await this.search(Array.from(node.embeddingVector), limit + 1, undefined, node.embeddingIdentity);
        return neighbors.filter(n => n.id !== nodeId).slice(0, limit);
    }

    public async searchByContent(textQuery: string, limit = 20, scope: MemoryScope = {}): Promise<MemoryNode[]> {
        if (!textQuery.trim()) return [];
        await this.ensureInitialized();
        const nodes = new Map<string, MemoryNode>();
        for (const [name, table] of [['legacy', this.legacyTable], ['v2', this.table]] as const) {
            if (!table) continue;
            const tableName = name === 'v2' ? 'memory_records_v2' : 'memory';
            const rows = await this.withCurrentTable(tableName, async () => {
                let current = (name === 'v2' ? this.table : this.legacyTable)!;
                if (!this.ftsReady.has(name)) {
                    // [FIX] FTS index builds conflict with the periodic
                    // compaction Rewrite (retryable commit conflict): rebase
                    // onto a fresh handle and retry, bounded. Without this,
                    // one conflict left the index unbuilt and EVERY content
                    // search retried - and failed - forever (prod 2026-10-23).
                    const maxAttempts = 3;
                    for (let attempt = 1; ; attempt++) {
                        try {
                            // Re-read the handle each attempt: a conflict
                            // rebase replaces this.table/legacyTable.
                            current = (name === 'v2' ? this.table : this.legacyTable)!;
                            await current.createIndex('content', { config: (await loadLanceRuntime()).Index.fts(), replace: true });
                            this.ftsReady.add(name);
                            break;
                        } catch (e) {
                            if (!LanceDbService.isRetryableCommitConflict(e) || attempt >= maxAttempts) throw e;
                            console.warn(`[LANCEDB] FTS createIndex conflict on '${tableName}' (attempt ${attempt}/${maxAttempts}); rebasing on fresh handle.`);
                            await this.reopenTable(tableName);
                        }
                    }
                }
                return current.query().where(scopeSql(scope)).fullTextSearch(textQuery).limit(limit * 3).toArray();
            });
            for (const row of rows) {
                const node = JSON.parse(row.json_data) as MemoryNode;
                if (inScope(node, scope)) nodes.set(node.id, node);
            }
        }
        return [...nodes.values()].slice(0, limit);
    }

    /** Observation-only path: no initialization, optimization, FTS creation,
     * embedding, provider call, access update or corpus truncation. Caller-bounded results. Reads
     * existing canonical tables; legacy then v2, with v2 winning duplicate IDs. */
    public async getRecentObservations(tag:string|string[],limit:number,excludedIds:string[]=[]):Promise<MemoryNode[]>{
        const tags=Array.isArray(tag)?tag:[tag];
        if(!tags.length || !tags.every(t=>typeof t==='string' && t.length>0) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Observation tags and bounded limit required');
        // Absence is an empty corpus; an unreadable or non-directory storage
        // path is not. This is a shape check, not protection against TOCTOU.
        let storage: fs.Stats;
        try { storage = fs.statSync(this.databasePath); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        if (!storage.isDirectory()) throw new Error('Observation storage path must be a directory');
        const db=this.db??await (this.observationConnection??=loadLanceRuntime().then(runtime=>runtime.connect(this.databasePath)).catch(error=>{this.observationConnection=null;throw error;}));
        const names=await db.tableNames();
        const tables=[];
        for(const name of ['memory','memory_records_v2']){
            if(names.includes(name)){const table=await db.openTable(name);tables.push({name,table,version:await table.version()});}
        }
        const version=JSON.stringify(tables.map(t=>[t.name,t.version]));
        const key=JSON.stringify([tag,[...excludedIds].sort()]);
        const cached=this.observationCache.get(key);
        if(limit===1 && cached?.version===version)return cached.node ? [cached.node] : [];
        const excluded=new Set(excludedIds);
        const candidates=new Map<string,MemoryNode>();
        for(const {table} of tables){
            const total=await table.countRows();
            const page=scanPageRows();
            for(let offset=0;offset<total;offset+=page){
                const rows=await table.query().limit(page).offset(offset).toArray();
                for(const row of rows){
                    const node=JSON.parse(row.json_data) as MemoryNode;
                    // Include all IDs before selecting tag so a v2 update can
                    // remove a tag present in the legacy row.
                    if(!excluded.has(node.id)&&tags.every(t=>node.tags.includes(t)))candidates.set(node.id,node);
                    else candidates.delete(node.id);
                }
            }
        }
        const selected=[...candidates.values()]
            .sort((a,b)=>b.timestamp-a.timestamp||a.id.localeCompare(b.id)).slice(0,limit);
        this.observationCache.clear(); // cache only latest query, never grow with requests
        if(limit===1)this.observationCache.set(key,{version,node:selected[0]??null});
        return selected;
    }

    public async getLatestObservation(tag:string,excludedIds:string[]=[]):Promise<MemoryNode|null>{
        return (await this.getRecentObservations(tag,1,excludedIds))[0]??null;
    }

    public async getAllNodes(): Promise<MemoryNode[]> {
        if (!this.table) await this.init();
        if (!this.table && !this.legacyTable) {
            console.warn("[LANCEDB] getAllNodes: Table not initialized.");
            return [];
        }
        try {
            const unique = new Map<string, MemoryNode>();
            for (const tableName of ['memory', 'memory_records_v2'] as const) {
                const rows = await this.withCurrentTable(tableName, async () => {
                    const current = (tableName === 'memory_records_v2' ? this.table : this.legacyTable);
                    if (!current) return [];
                    return current.query().limit(await current.countRows()).toArray();
                });
                for (const row of rows) { const node = JSON.parse(row.json_data); unique.set(node.id, node); }
            }
            return [...unique.values()];
        } catch (e) {
            console.error("[LANCEDB] getAllNodes Failed", e);
            return [];
        }
    }

    public async getNodesByTier(tier: MemoryTier, limit: number = 1000): Promise<MemoryNode[]> {
        await this.ensureInitialized();
        return (await this.getAllNodes()).filter(n => n.tier === tier)
            .sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    }

    // Helper to delete/cleanup if needed
    public async drop() {
        if (this.db) {
            await this.db.dropTable('memory');
            this.table = null;
        }
    }

    // --- UNIVERSAL KNOWLEDGE METHODS ---

    public async storeKnowledge(item: any): Promise<void> {
        if (!this.db) await this.init();
        if (!this.db) {
            console.error(`[LANCEDB] storeKnowledge REFUSED (db unavailable) for item ${item?.id ?? '?'} — explicit, not silent`);
            return;
        }
        // [Ticket W7] Every knowledge write MUST carry a valid embedding.
        // An empty/invalid vector was the latent schema poison: the first
        // record defines nothing now (explicit schema), but an invalid vector
        // would still violate the FixedSizeList(768) column on insert.
        const vec = item?.vector;
        if (!Array.isArray(vec) || vec.length !== KNOWLEDGE_VECTOR_DIM || !vec.every((n: any) => Number.isFinite(n))) {
            console.error(`[LANCEDB] storeKnowledge REFUSED for item ${item?.id ?? '?'}: vector must be ${KNOWLEDGE_VECTOR_DIM} finite numbers (got ${Array.isArray(vec) ? vec.length : 'non-array'})`);
            return;
        }
        await this.ensureKnowledgeTable();

        try {
            if (!this.knowledgeTable) {
                const tableNames = await this.db.tableNames();
                if (tableNames.includes('universal_knowledge')) {
                    this.knowledgeTable = await this.db.openTable('universal_knowledge');
                } else {
                    // Create Table
                    this.knowledgeTable = await this.db.createTable('universal_knowledge', [item]);
                    console.log("[LANCEDB] Created 'universal_knowledge' table.");
                    return;
                }
            }

            // Upsert
            try {
                const safeId = String(item.id).replace(/'/g, "''");
                await this.knowledgeTable.delete(`id = '${safeId}'`);
            } catch (e) {
                console.error("[LANCEDB] Knowledge Upsert deletion ignored:", e);
            }

            await this.knowledgeTable.add([item]);
            // console.log(`[LANCEDB] Stored Knowledge: ${item.path}`);

        } catch (error) {
            console.error(`[LANCEDB] Failed to store knowledge: ${item.path}`, error);
        }
    }

    public async searchKnowledge(queryVector: number[], limit: number = 5): Promise<any[]> {
        if (!this.knowledgeTable) {
            // Try to init if missing
            if (this.db) {
                const tableNames = await this.db.tableNames();
                if (tableNames.includes('universal_knowledge')) {
                    this.knowledgeTable = await this.db.openTable('universal_knowledge');
                }
            }
            if (!this.knowledgeTable) {
                console.warn("[LANCEDB] Knowledge table not ready.");
                return [];
            }
        }

        try {
            const adjustedVector = adjustVectorDimension(queryVector);
            const rowCount = await this.knowledgeTable.countRows();
            const pageRows = scanPageRows();
            let top: any[] = [];
            for (let offset = 0; offset < rowCount; offset += pageRows) {
                const page = await this.knowledgeTable.query().limit(pageRows).offset(offset).toArray();
                const pageRanked = rankByCosine(page as { vector: unknown }[], adjustedVector, limit);
                top = LanceDbService.mergeTopK(top, pageRanked as any, limit);
            }
            return top.map(({ _score, ...row }: any) => ({ ...row, _distance: 1 - _score }));
        } catch (e) {
            console.error("[LANCEDB] Knowledge Search Failed", e);
            return [];
        }
    }
}

export const lancedbService = new LanceDbService();
