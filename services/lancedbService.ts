import { lexicalScore } from './lexicalMatch';
import { VectorProjectionJournal, canonicalChecksum } from './vectorProjectionJournal';
import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import { createHash } from 'node:crypto';
import { MemoryNode, MemoryTier } from '../types';

// Vitest workers must not mutate the same LanceDB directory concurrently.
const DB_PATH = process.env.SILHOUETTE_LANCEDB_PATH || path.resolve(process.cwd(), 'db', process.env.VITEST_WORKER_ID
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
    private projectionJournal: VectorProjectionJournal | null = null;
    private projectionReplay: Promise<{ completed: number; pending: number }> | null = null;
    private journal(): VectorProjectionJournal {
        return this.projectionJournal ||= new VectorProjectionJournal(path.join(this.databasePath, 'vector-projection-intents.sqlite'));
    }

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
    private static readonly databaseWrites = new Map<string, Promise<void>>();
    private get writeQueue(): Promise<void> { return LanceDbService.databaseWrites.get(path.resolve(this.databasePath)) || Promise.resolve(); }
    private set writeQueue(value: Promise<void>) { LanceDbService.databaseWrites.set(path.resolve(this.databasePath), value); }
    private initPromise: Promise<void> | null = null;

    constructor(private readonly databasePath = DB_PATH, private readonly projectionTarget?: Pick<typeof import('./vectorMemoryService').vectorMemory, 'connect' | 'storeMemory'>,
        private readonly projectionCheckpoint?: (phase: 'source_verified', id: string) => Promise<void>) {
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
                    console.log(`[LANCEDB] Connecting to: ${this.databasePath}`);
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

    public deleteNode(id: string): Promise<boolean> {
        const operation = this.writeQueue.then(() => this.deleteNodeSerialized(id));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    private async deleteNodeSerialized(id: string): Promise<boolean> {
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

    private async ensureProjectionEventColumn(): Promise<void> {
        if (!this.db || !(await this.db.tableNames()).includes('memory_records_v2')) return;
        const current = await this.db.openTable('memory_records_v2');
        if (!(await current.schema()).fields.some(field => field.name === 'projection_event_key')) {
            await current.addColumns([{ name: 'projection_event_key', valueSql: "cast('' as string)" }]);
        }
        this.table = await this.db.openTable('memory_records_v2');
    }

    private async canonicalProjectionEventKey(id: string): Promise<string | null> {
        if (!this.db || !(await this.db.tableNames()).includes('memory_records_v2')) return null;
        const current = await this.db.openTable('memory_records_v2');
        await current.checkoutLatest();
        if (!(await current.schema()).fields.some(field => field.name === 'projection_event_key')) return null;
        const rows = await current.query().where(`id = '${id.replace(/'/g, "''")}'`).select(['projection_event_key']).limit(2).toArray();
        if (rows.length !== 1) return null;
        return rows[0].projection_event_key || null;
    }

    private toRecord(node: MemoryNode, json?: string, projectionEventKey = '') {
        const jsonData = json ?? JSON.stringify(node);
        return {
            id: node.id,
            embedding_state: 'EMBEDDING_PENDING',
            projection_event_key: projectionEventKey,
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
        await this.ensureProjectionEventColumn();
        const prepared: { node: MemoryNode; vector?: number[]; intent: ReturnType<VectorProjectionJournal['prepare']> | null }[] = [];
        // Validate the whole bulk before any canonical change. Vector-bearing
        // replacements use active-intent vectors, never a possibly stale local row.
        for (const node of nodes) {
            const vector = await this.vectorForUnchangedContent(node);
            if (!vector && await this.canonicalProjectionEventKey(node.id)) {
                throw new Error('Bulk replacement cannot discard an active vector generation; use identified store with an explicit vector');
            }
            const intent = vector && node.embeddingIdentity ? this.journal().prepare(node, vector, node.embeddingIdentity) : null;
            prepared.push({ node, vector, intent });
        }
        const records = prepared.map(({ node, intent }) => this.toRecord(node, undefined, intent?.key));
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
        for (const { node, vector, intent } of prepared) {
            if (!intent || !vector || !node.embeddingIdentity) continue;
            const stored = await this.getNodeById(node.id);
            if (!stored || canonicalChecksum(stored) !== intent.checksum) throw new Error('Bulk vector canonical read-back failed');
            this.journal().canonicalVerified(intent.key);
            try { await this.projectEmbeddingSerialized(node, vector, node.embeddingIdentity); }
            catch { console.warn('[LANCEDB] Bulk canonical retained; local vector repair pending'); }
        }
        return { ok: true, count: nodes.length };
    }

    /** A payload-only update can reuse only a proven projection of the SAME
     * content and identity. Never generate or infer a vector for this path. */
    private async vectorForUnchangedContent(node: MemoryNode): Promise<number[] | undefined> {
        if (!node.embeddingIdentity || !this.db) return undefined;
        const name = this.vectorTableName(node.embeddingIdentity);
        const activeEvent = await this.canonicalProjectionEventKey(node.id);
        if (activeEvent) {
            const intent = this.journal().get(activeEvent);
            const current = await this.getNodeById(node.id);
            if (!intent || !current || intent.checksum !== canonicalChecksum(current)) {
                throw new Error('Active canonical vector receipt is unverifiable; refusing stale reuse');
            }
            if (intent.node.content !== node.content || canonicalChecksum(intent.identity) !== canonicalChecksum(node.embeddingIdentity)) return undefined;
            return validEmbedding(intent.vector, intent.identity) ? intent.vector : undefined;
        }
        if (!(await this.db.tableNames()).includes(name)) return undefined;
        const table = await this.db.openTable(name);
        const rows = await table.query().where(`id = '${node.id.replace(/'/g, "''")}'`).limit(2).toArray();
        if (rows.length !== 1) return undefined;
        const source = JSON.parse(rows[0].json_data);
        if (source.content !== node.content || JSON.stringify(source.embeddingIdentity) !== JSON.stringify(node.embeddingIdentity)) return undefined;
        const vector = toNumericArray(rows[0].vector);
        return vector && validEmbedding(vector, node.embeddingIdentity) ? vector : undefined;
    }

    private async writeAndVerify(node: MemoryNode, vector?: number[]): Promise<{ ok: true; id: string; checksum: string; version: number }> {
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB is unavailable');
        vector ||= await this.vectorForUnchangedContent(node);
        const intent = vector && node.embeddingIdentity && validEmbedding(vector, node.embeddingIdentity)
            ? this.journal().prepare(node, vector, node.embeddingIdentity) : null;
        const json = JSON.stringify(node);
        const checksum = createHash('sha256').update(json).digest('hex');
        await this.ensureProjectionEventColumn();
        const record = this.toRecord(node, json, intent?.key);
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
            try { await this.projectEmbeddingSerialized(node, vector, node.embeddingIdentity); }
            catch (error) { console.warn('[LANCEDB] Vector projection pending; canonical memory preserved', error); }
        }
        const stored = await this.getNodeById(node.id);
        if (!stored || createHash('sha256').update(JSON.stringify(stored)).digest('hex') !== checksum) {
            throw new Error(`LanceDB read-back verification failed for ${node.id}`);
        }
        // The intent is already durable. Projection delivery is separate from
        // the caller's canonical success and never re-runs the source operation.
        if (intent) {
            try { this.journal().canonicalVerified(intent.key); }
            catch { console.warn('[LANCEDB] Canonical receipt retained; prepared projection will verify on replay'); }
        }
        // Replay is an explicit loader/timer task. Do not race a consumer's
        // local projection receipt with a second asynchronous merge here.
        return { ok: true, id: node.id, checksum, version: node.timestamp };
    }

    private projectionTimer: ReturnType<typeof setInterval> | null = null;
    /** Called explicitly by the app loader. No model calls, no provisioning. */
    public startVectorProjectionReplay(): Promise<{ completed: number; pending: number }> {
        if (this.projectionTimer) return this.replayVectorProjections(50);
        this.projectionTimer = setInterval(() => {
            void this.replayVectorProjections(50).catch(() => {
                console.warn('[LANCEDB] Qdrant projection retry unavailable; intent retained');
            });
        }, 60_000);
        this.projectionTimer.unref?.();
        return this.replayVectorProjections(50);
    }
    public stopVectorProjectionReplay(): void {
        if (this.projectionTimer) clearInterval(this.projectionTimer);
        this.projectionTimer = null;
    }
    public getVectorProjectionStatus(): Record<string, number> { return this.projectionJournal?.stats() || {}; }

    /** Finite replay with source verification. No fabricated legacy identity. */
    public replayVectorProjections(limit = 50): Promise<{ completed: number; pending: number }> {
        if (this.projectionReplay) return this.projectionReplay;
        const operation = this.writeQueue.then(() => this.replayProjectionBatch(limit));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        this.projectionReplay = operation.finally(() => { this.projectionReplay = null; });
        return this.projectionReplay;
    }
    private async replayProjectionBatch(limit: number): Promise<{ completed: number; pending: number }> {
        const journal = this.journal();
        const vectorMemory = this.projectionTarget || (await import('./vectorMemoryService')).vectorMemory;
        let completed = 0;
        const batch = journal.pending(limit);
        // Repair the LOCAL projection first, even when Qdrant is disabled or
        // unavailable. The journal covers both projections, not only the mirror.
        let mirrorReady: boolean | undefined;
        for (const intent of batch) {
            const current = await this.getNodeById(intent.id);
            if (!current) continue;
            if (canonicalChecksum(current) !== intent.checksum) {
                if (intent.phase !== 'prepared') journal.superseded(intent.key);
                continue;
            }
            // A node checksum alone cannot distinguish V1 -> V2 with identical
            // node JSON. The event key is committed atomically beside that JSON
            // and names the immutable journal vector/digest for this write.
            const activeEvent = await this.canonicalProjectionEventKey(intent.id);
            if (activeEvent && activeEvent !== intent.key) { journal.superseded(intent.key); continue; }
            journal.canonicalVerified(intent.key);
            await this.projectionCheckpoint?.('source_verified', intent.id);
            try {
                await this.projectEmbeddingSerialized(current, intent.vector, intent.identity);
                if (intent.identity.dimension !== 768) { journal.retainedUnsupported(intent.key); continue; }
                mirrorReady ??= (await vectorMemory.connect()).state === 'ready';
                if (!mirrorReady) continue;
                await vectorMemory.storeMemory(intent.id, intent.vector, { ...current, type: (current as any).type || 'MEMORY_NODE',
                    _embeddingModel: intent.identity.model, _embeddingVersion: intent.identity.version,
                    _embeddingDimension: intent.identity.dimension });
                journal.completed(intent.key);
                completed++;
            } catch { journal.failed(intent.key); }
        }
        return { completed, pending: journal.pendingCount() };
    }

    public async getNodeById(id: string): Promise<MemoryNode | null> {
        await this.ensureInitialized();
        const safeId = id.replace(/'/g, "''");
        for (const tableName of ['memory_records_v2', 'memory'] as const) {
            if (!this.db || !(await this.db.tableNames()).includes(tableName)) continue;
            const current = await this.db.openTable(tableName);
            await current.checkoutLatest();
            const rows = await current.query().where(`id = '${safeId}'`).limit(2).toArray();
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
        for (const tableName of ['memory_records_v2', 'memory'] as const) {
            const missing = ids.filter(id => !found.has(id));
            if (!missing.length) continue;
            const quoted = missing.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
            const rows = await this.withCurrentTable(tableName, async () => {
                const current = (tableName === 'memory_records_v2' ? this.table : this.legacyTable);
                if (!current) return [];
                return current.query().where(`id IN (${quoted})`).limit(missing.length * 2).toArray();
            });
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
    private async markLocalEmbeddingReady(id: string): Promise<void> {
        if (!this.table) return;
        const where = `id = '${id.replace(/'/g, "''")}'`;
        const rows = await this.withCurrentTable('memory_records_v2', () => this.table!.query().where(where).select(['embedding_state']).limit(1).toArray());
        if (rows[0]?.embedding_state !== 'READY') {
            await this.withCurrentTable('memory_records_v2', () => this.table!.update({ where, values: { embedding_state: 'READY' } }));
        }
    }

    /** External projection callers use the same source-verified queue as consumers.
     * Internal store/replay callers already hold it and use the private method. */
    public projectEmbedding(node: MemoryNode, vector: number[], identity: EmbeddingIdentity): Promise<void> {
        if (!validEmbedding(vector, identity)) return Promise.reject(new Error('Invalid or incompatible embedding'));
        return this.ensureLocalVectorProjection(node, vector, identity);
    }

    private async projectEmbeddingSerialized(node: MemoryNode, vector: number[], identity: EmbeddingIdentity): Promise<void> {
        if (!validEmbedding(vector, identity)) throw new Error('Invalid or incompatible embedding');
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB is unavailable');
        const name = this.vectorTableName(identity);
        const record = { id: node.id, vector, ownerId: node.ownerId || 'system', json_data: JSON.stringify(node) };
        const names = await this.db.tableNames();
        const table = names.includes(name) ? await this.db.openTable(name) : await this.db.createTable(name, [record]);
        const previous = await table.query().where(`id = '${node.id.replace(/'/g, "''")}'`).limit(2).toArray();
        const storedVector = previous.length === 1 ? toNumericArray(previous[0].vector) : null;
        const normalized = Array.from(Float32Array.from(vector));
        if (previous.length === 1 && previous[0].json_data === record.json_data && storedVector
            && storedVector.length === normalized.length && storedVector.every((v, index) => v === normalized[index])) {
            // Persisted projection itself is the verifiable local receipt.
            // A down optional mirror must not append identical Lance versions.
            await this.markLocalEmbeddingReady(node.id);
            return;
        }
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
        await this.markLocalEmbeddingReady(node.id);
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
        const probe = probeVectorEnvironment('/proc/cpuinfo', DB_DIR);
        this.annModule = loadUsearchNative();
        this.annStatus = selectVectorEngine(process.env, () => this.annModule, probe);
        console.log(`[VECTOR] engine=${this.annStatus.kind} - ${this.annStatus.reason} | cpu="${probe.cpuModel}" ram=${probe.ramTotalMB}MB diskFree=${probe.diskFreeMB ?? '?'}MB`);
        if (this.annStatus.kind === 'usearch-native' && this.annModule) {
            const annDir = path.join(this.databasePath, 'ann');
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
            idx = new AnnIndex({ dir: path.join(this.databasePath, 'ann'), name, dimensions, Index: this.annModule!.Index, sqlite: this.annSqlite, probe: this.annStatus?.probe });
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
                    return hits.flatMap(h => { const node = byId.get(h.id); return node ? [{ ...node, similarity: h.score }] : []; });
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
        return top.flatMap(r => { const node = byId.get(r.id); return node ? [{ ...node, similarity: r._score }] : []; });
    }

    public ensureLocalVectorProjection(node: MemoryNode, vector: number[], identity: EmbeddingIdentity): Promise<void> {
        const operation = this.writeQueue.then(async () => {
            const current = await this.getNodeById(node.id);
            if (!current || canonicalChecksum(current) !== canonicalChecksum(node)) {
                throw new Error('Canonical version changed; stale local projection receipt refused');
            }
            const activeEvent = await this.canonicalProjectionEventKey(node.id);
            if (activeEvent) {
                const intent = this.journal().get(activeEvent);
                if (!intent || canonicalChecksum(intent.identity) !== canonicalChecksum(identity)
                    || canonicalChecksum(Array.from(Float32Array.from(intent.vector))) !== canonicalChecksum(Array.from(Float32Array.from(vector)))) {
                    throw new Error('Canonical vector generation changed; stale projection receipt refused');
                }
            }
            await this.projectEmbeddingSerialized(node, vector, identity);
            const table = await this.db!.openTable(this.vectorTableName(identity));
            const rows = await table.query().where(`id = '${node.id.replace(/'/g, "''")}'`).limit(2).toArray();
            if (rows.length !== 1 || JSON.parse(rows[0].json_data).content !== node.content) {
                throw new Error('Canonical memory retained; local vector projection is pending');
            }
        });
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    /** Complete identity-partitioned application query, with payload and score.
     * Filters and score bands apply BEFORE top-k, so no top-50 cutoff can hide
     * a valid distant memory. Canonical hydration prevents stale mirror payloads.
     */
    public async searchVectorPoints(vector: number[], identity: EmbeddingIdentity, limit = 5,
        filter?: Record<string, any>, band?: { min: number; max: number }): Promise<any[]> {
        if (!validEmbedding(vector, identity)) throw new Error('Invalid identified query');
        if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid query limit');
        if (band && (!Number.isFinite(band.min) || !Number.isFinite(band.max) || band.min > band.max)) throw new Error('Invalid score band');
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB unavailable');
        const name = this.vectorTableName(identity);
        if (!(await this.db.tableNames()).includes(name)) return [];
        const table = await this.db.openTable(name);
        // Independent handles pinned once for the whole query. Do not checkout
        // the shared mutable writer handles. All pages and activation markers
        // observe the same canonical version, not a per-page moving target.
        const snapshots: lancedb.Table[] = [];
        const names = await this.db.tableNames();
        for (const canonicalName of ['memory_records_v2', 'memory']) {
            if (!names.includes(canonicalName)) continue;
            const snapshot = await this.db.openTable(canonicalName);
            await snapshot.checkout(await snapshot.version());
            snapshots.push(snapshot);
        }
        await table.checkout(await table.version());
        const readSnapshot = async (ids: string[]) => {
            const found = new Map<string, MemoryNode>();
            if (!ids.length) return found;
            const quoted = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
            for (const snapshot of snapshots) {
                const rows = await snapshot.query().where(`id IN (${quoted})`).toArray();
                for (const row of rows) if (!found.has(row.id)) found.set(row.id, JSON.parse(row.json_data));
            }
            return found;
        };
        const count = await table.countRows();
        const pageSize = scanPageRows();
        let best: any[] = [];
        for (let offset = 0; offset < count; offset += pageSize) {
            const rows = await table.query().limit(pageSize).offset(offset).toArray();
            const byId = await readSnapshot(rows.map((r: any) => r.id));
            const fileIds = [...new Set([...byId.values()].filter((node: any) => node.type === 'CODE_CHUNK' && node.fileId).map((node: any) => `code_file_version:${node.fileId}`))];
            const codeVersions = await readSnapshot(fileIds);
            const eligible = rows.filter((row: any) => {
                const node = byId.get(row.id);
                if (!node || JSON.stringify(node.embeddingIdentity) !== JSON.stringify(identity)) return false;
                if ((node as any).type === 'CODE_CHUNK') {
                    const active = codeVersions.get(`code_file_version:${(node as any).fileId}`) as any;
                    if (!active || active.hash !== (node as any).hash) return false;
                }
                const projected = JSON.parse(row.json_data);
                if (projected.content !== node.content) return false; // Stale embedding is not current evidence.
                return !filter || Object.entries(filter).every(([key, value]) => {
                    if (key === '$excludeTypes') return !value.includes((node as any).type);
                    if (key === '$excludeTags') return !(node.tags || []).some(tag => value.includes(tag));
                    if (key === '$tagIncludes') return (node.tags || []).some(tag => tag.includes(value));
                    const actual = key === 'ownerId' ? (node.ownerId || 'system') : (node as any)[key];
                    return Array.isArray(value) ? value.includes(actual) : Array.isArray(actual) ? actual.includes(value) : actual === value;
                });
            });
            const scored = rankByCosine(eligible as any, vector, eligible.length)
                .filter(hit => !band || (hit._score >= band.min && hit._score <= band.max))
                .map(hit => ({ id: hit.id, score: hit._score, payload: byId.get(hit.id) }));
            best = best.concat(scored).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
        }
        return best;
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

    /** Bounded exhaustive lexical context query. Unlike legacy FTS candidate
     * truncation, context/owner/type/tag filters precede top-k, with v2 canonical
     * hydration overriding any old matching legacy payload. No model call. */
    public async searchContextByContent(query: string, limit = 20, scope: MemoryScope = {}): Promise<MemoryNode[]> {
        if (!query.trim()) return [];
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB unavailable');
        const names = await this.db.tableNames();
        const tables: lancedb.Table[] = [];
        for (const name of ['memory_records_v2', 'memory']) {
            if (!names.includes(name)) continue;
            const table = await this.db.openTable(name);
            await table.checkout(await table.version());
            tables.push(table);
        }
        const canonicalRows = async (ids: string[]) => {
            const result = new Map<string, MemoryNode>();
            if (!ids.length) return result;
            const quoted = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
            for (const table of tables) {
                for (const row of await table.query().where(`id IN (${quoted})`).toArray()) {
                    if (!result.has(row.id)) result.set(row.id, JSON.parse(row.json_data));
                }
            }
            return result;
        };
        let top: { node: MemoryNode; score: number }[] = [];
        for (const table of tables) {
            const count = await table.countRows();
            for (let offset = 0; offset < count; offset += scanPageRows()) {
                const rows = await table.query().limit(scanPageRows()).offset(offset).toArray();
                const current = await canonicalRows(rows.map(row => row.id));
                const best = new Map(top.map(hit => [hit.node.id, hit]));
                for (const node of current.values()) {
                    if (['CODE_CHUNK','CODE_FILE_VERSION'].includes((node as any).type) || !inScope(node, scope)) continue;
                    const score = lexicalScore(node.content, query);
                    if (score > 0) best.set(node.id, { node, score });
                }
                top = [...best.values()].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, limit);
            }
        }
        return top.map(hit => hit.node);
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
                            await current.createIndex('content', { config: lancedb.Index.fts(), replace: true });
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
        if(!fs.existsSync(this.databasePath))return [];
        const db=this.db??await (this.observationConnection??=lancedb.connect(this.databasePath).catch(error=>{this.observationConnection=null;throw error;}));
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
