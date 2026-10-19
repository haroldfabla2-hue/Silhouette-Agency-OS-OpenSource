import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import { createHash } from 'node:crypto';
import { MemoryNode, MemoryTier } from '../types';

// Vitest workers must not mutate the same LanceDB directory concurrently.
const DB_PATH = path.resolve(process.cwd(), 'db', process.env.VITEST_WORKER_ID
    ? `silhouette-test-worker-${process.env.VITEST_WORKER_ID}.lancedb`
    : 'silhouette.lancedb');
const DB_DIR = path.dirname(DB_PATH);
const DEFAULT_DIMENSIONS = 768; // Hardcoded default to match the original schema

import { validEmbedding, scopeSql, inScope, type EmbeddingIdentity, type MemoryScope } from './memoryRetrieval';
import { rankByCosine, toNumericArray, scanPageRows } from './vectorScan';
import { selectVectorEngine, probeVectorEnvironment, AnnIndex, type UsearchModule, loadUsearchNative } from './vectorEngine';
import Database from 'better-sqlite3';
import { Schema, Field, FixedSizeList, Float32, Utf8, Float64 } from 'apache-arrow';

function adjustVectorDimension(vector: number[], targetDim: number = DEFAULT_DIMENSIONS): number[] {
    if (!validEmbedding(vector, { model: 'knowledge', version: '1', dimension: targetDim })) {
        throw new Error('Invalid embedding: dimension, finite values and nonzero magnitude required');
    }
    return vector;
}

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
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

                this.db = await lancedb.connect(this.databasePath);
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
            await this.table.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute(records);
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
            await this.table.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute([record]);
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
        for (const table of [this.table, this.legacyTable]) {
            if (!table) continue;
            const rows = await table.query().where(`id = '${safeId}'`).limit(2).toArray();
            if (rows.length > 1) throw new Error(`Duplicate memory ID in LanceDB: ${id}`);
            if (rows.length) return JSON.parse(rows[0].json_data) as MemoryNode;
        }
        return null;
    }

    /**
     * Batched hydration of ranked ids from the canonical tables.
     * One filtered query per table instead of one full scan per id:
     * Lance has no secondary index on `id`, so N point lookups cost N full
     * table scans (the 2026-10-18 production meltdown: 50 lookups/search x
     * queued searches pinned the tokio threads at ~300% CPU).
     */
    private async getNodesByIds(ids: string[]): Promise<Map<string, MemoryNode>> {
        const found = new Map<string, MemoryNode>();
        if (!ids.length) return found;
        for (const table of [this.table, this.legacyTable]) {
            const missing = ids.filter(id => !found.has(id));
            if (!table || !missing.length) continue;
            const quoted = missing.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
            const rows = await table.query().where(`id IN (${quoted})`).limit(missing.length * 2).toArray();
            const seen = new Set<string>();
            for (const row of rows) {
                if (seen.has(row.id)) throw new Error(`Duplicate memory ID in LanceDB: ${row.id}`);
                seen.add(row.id);
                if (!found.has(row.id)) found.set(row.id, JSON.parse(row.json_data) as MemoryNode);
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
    private static readonly OPTIMIZE_NO_PRUNE_DATE = new Date('2999-01-01');

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
                await t.optimize({ cleanupOlderThan: LanceDbService.OPTIMIZE_NO_PRUNE_DATE, deleteUnverified: false });
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
        if (this.table) await this.table.update({ where: `id = '${node.id.replace(/'/g, "''")}'`, values: { embedding_state: 'READY' } });
    }
    public async pendingEmbeddings(limit = 100): Promise<MemoryNode[]> {
        await this.ensureInitialized();
        if (!this.table) return [];
        const rows = await this.table.query().where("embedding_state = 'EMBEDDING_PENDING'").limit(limit).toArray();
        return rows.map(r => JSON.parse(r.json_data));
    }
    /** Engine selection happens once and is logged loudly: which engine, why, and what this machine offers. */
    private ensureAnnEngine(): boolean {
        if (this.annStatus) return this.annStatus.kind === 'usearch-native';
        const probe = probeVectorEnvironment('/proc/cpuinfo', DB_DIR);
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
        if (!identity || !validEmbedding(queryVector, identity)) return [];
        await this.ensureInitialized();
        if (!this.db) return [];
        const name = this.vectorTableName(identity);
        if (!(await this.db.tableNames()).includes(name)) return [];
        const table = await this.db.openTable(name);
        const rowCount = await table.countRows();
        const ownerScope = LanceDbService.ownerScopeFromFilter(filter);
        // Unknown (non-scope) filters go to the exact path BEFORE the ANN:
        // the ANN key map only understands owner scope, so routing anything
        // else there would silently bypass the filter (isolation risk).
        if (ownerScope !== null && this.ensureAnnEngine()) {
            try {
                const ann = await this.annIndexFor(name, identity.dimension, () => this.projectionRows(table), rowCount, table);
                if (!ann.isStale()) {
                    const hits = ann.search(queryVector, limit, ownerScope);
                    // Batched hydration (#193): one IN query, never N full scans.
                    const byId = await this.getNodesByIds(hits.map(h => h.id));
                    return hits.map(h => byId.get(h.id)).filter((n): n is MemoryNode => n !== null);
                }
            } catch (e) {
                console.error(`[VECTOR] ANN search failed for ${name} (${(e as Error).message}); falling back to exact partitioned scan`);
            }
        }
        if (ownerScope === null && filter) {
            console.warn(`[VECTOR] filter "${filter}" is not a scope filter; exact partitioned scan handles it`);
        }
        // Exact fallback, STREAMING top-k over pages: RAM stays bounded (one
        // page + k winners) and NO row is ever dropped, at any table size
        // (eternal memory: a cap must never hide data).
        const pageRows = scanPageRows();
        let top: { id: string; _score: number }[] = [];
        if (rowCount <= pageRows) {
            // Single page (every realistic table today): unpaged query, same
            // shape the scan has always used.
            let scan = table.query();
            if (filter) scan = scan.where(filter);
            const rows = await scan.toArray();
            top = rankByCosine(rows as { vector: unknown; id: string }[], queryVector, limit);
        } else {
            console.warn(`[VECTOR] ${name}: exact scan of ${rowCount} rows in pages of ${pageRows} - correct at any size, slower at large scale`);
            for (let offset = 0; offset < rowCount; offset += pageRows) {
                let scan = table.query().limit(pageRows).offset(offset);
                if (filter) scan = scan.where(filter);
                const rows = await scan.toArray();
                const pageRanked = rankByCosine(rows as { vector: unknown; id: string }[], queryVector, limit);
                top = LanceDbService.mergeTopK(top, pageRanked, limit);
            }
        }
        // Batched hydration (#193): one IN query, never N full scans.
        const byId = await this.getNodesByIds(top.map(r => r.id));
        return top.map(r => byId.get(r.id)).filter((n): n is MemoryNode => n !== null);
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
            if (!this.ftsReady.has(name)) {
                await table.createIndex('content', { config: lancedb.Index.fts(), replace: true });
                this.ftsReady.add(name);
            }
            const rows = await table.query().where(scopeSql(scope)).fullTextSearch(textQuery).limit(limit * 3).toArray();
            for (const row of rows) {
                const node = JSON.parse(row.json_data) as MemoryNode;
                if (inScope(node, scope)) nodes.set(node.id, node);
            }
        }
        return [...nodes.values()].slice(0, limit);
    }

    public async getAllNodes(): Promise<MemoryNode[]> {
        if (!this.table) await this.init();
        if (!this.table && !this.legacyTable) {
            console.warn("[LANCEDB] getAllNodes: Table not initialized.");
            return [];
        }
        try {
            const unique = new Map<string, MemoryNode>();
            for (const table of [this.legacyTable, this.table]) {
                if (!table) continue;
                const rows = await table.query().limit(await table.countRows()).toArray();
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
