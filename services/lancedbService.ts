import { preserveOriginal } from './lifecycle/preserveOriginal';
import { lanceOwner } from './lifecycle/preparationBindings';
import type { Scope, Operation } from './lifecycle/host';
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

    constructor(private readonly databasePath = DB_PATH, private readonly ownership: Scope, operation: Operation) {
        ownership.validateConstruction(operation);
        ownership.onSeal(() => {
            if (this.optimizeTimer) clearInterval(this.optimizeTimer);
            this.optimizeTimer = null;
        });
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
        return this.ownership.invoke('original-ensure-knowledge', operation => this.ensureKnowledgeTableOriginal(operation));
    }
    private async ensureKnowledgeTableOriginal(operation: Operation): Promise<void> {
        if (this.knowledgeTableEnsured) return;
        if (!this.db) await this.init();
        if (!this.db) {
            console.error('[LANCEDB] ensureKnowledgeTable: db unavailable — table NOT created (explicit, no silent skip)');
            return;
        }
        try {
            const names = await this.db.tableNames();
            const connection = this.db;
            const permit = this.ownership.reserveResource(operation, 'knowledge-ensure-table');
            if (names.includes('universal_knowledge')) {
                try { this.knowledgeTable = await connection.openTable('universal_knowledge'); }
                catch (original) {
                    preserveOriginal(this.ownership, 'knowledge-open-failed', () => this.ownership.releaseUnused(permit)); throw original;
                }
                this.retainLanceHandle(permit, this.knowledgeTable, 'knowledge-ensure-open', [connection]);
            } else {
                try { this.knowledgeTable = await connection.createEmptyTable('universal_knowledge', knowledgeSchema()); }
                catch (original) {
                    preserveOriginal(this.ownership, 'knowledge-empty-create-failed', () => this.ownership.releaseUnused(permit)); throw original;
                }
                this.retainLanceHandle(permit, this.knowledgeTable, 'knowledge-ensure-empty-created', [connection]);
                console.log(`[LANCEDB] Created EMPTY 'universal_knowledge' table with explicit schema (vector dim ${KNOWLEDGE_VECTOR_DIM}).`);
            }
            this.knowledgeTableEnsured = true;
        } catch (e) {
            this.ownership.failure('knowledge-ensure:ORIGINAL_SELECTED_FAILURE', e);
            console.error('[LANCEDB] ensureKnowledgeTable failed:', e);
        }
    }

    public async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        await this.init();
    }

    private async ensureInitializedOriginal(operation: Operation): Promise<void> {
        if (this.initialized) return;
        await this.init(3, 1000, operation);
    }

    private init(retries = 3, delayMs = 1000, admittedOperation?: Operation): Promise<void> {
        if (this.initialized) return Promise.resolve();
        if (!this.initPromise) {
            this.initPromise = (admittedOperation ? this.initOnce(admittedOperation, retries, delayMs)
                : this.ownership.invoke('original-init', operation => this.initOnce(operation, retries, delayMs)))
                .finally(() => { this.initPromise = null; });
        }
        return this.initPromise;
    }

    private retainLanceHandle(permit: import('./lifecycle/host').ResourceReservation,
        handle: lancedb.Connection | lancedb.Table, source: string, dependencies: readonly object[] = []): void {
        // The SDK exposes synchronous close/isOpen for these exact handles.
        // Each returned handle is retained, even when a later retry replaces fields.
        this.ownership.acquire(permit, handle, () => handle.close(),
            () => ({ source: 'lance:' + source, disposition: handle.isOpen() ? 'INCOMPLETE' : 'CLOSED',
                ...(handle.isOpen() ? { reason: 'LANCE_HANDLE_STILL_OPEN' } : {}) }), dependencies);
    }
    private async initOnce(operation: Operation, retries = 3, delayMs = 1000) {
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
                const permit = this.ownership.reserveResource(operation, 'connection-candidate');
                let connection: lancedb.Connection;
                try { connection = await (await loadLanceRuntime()).connect(this.databasePath); }
                catch (original) {
                    preserveOriginal(this.ownership, 'connection-allocation-failed', () => this.ownership.releaseUnused(permit));
                    throw original;
                }
                this.db = connection;
                this.retainLanceHandle(permit, connection, 'connection-candidate');
                const tableNames = await this.db.tableNames();

                // 1. Memory Table
                if (tableNames.includes('memory')) {
                    const tablePermit = this.ownership.reserveResource(operation, 'init-table:memory');
                    try { this.legacyTable = await connection.openTable('memory'); }
                    catch (original) {
                        preserveOriginal(this.ownership, 'table-allocation-failed', () => this.ownership.releaseUnused(tablePermit));
                        throw original;
                    }
                    this.retainLanceHandle(tablePermit, this.legacyTable, 'init-table:memory', [connection]);
                } else {
                    console.log("[LANCEDB] Table 'memory' not found. It will be created on first insert.");
                }

                // 2. Universal Knowledge Table
                if (tableNames.includes('universal_knowledge')) {
                    const tablePermit = this.ownership.reserveResource(operation, 'init-table:universal_knowledge');
                    try { this.knowledgeTable = await connection.openTable('universal_knowledge'); }
                    catch (original) {
                        preserveOriginal(this.ownership, 'table-allocation-failed', () => this.ownership.releaseUnused(tablePermit));
                        throw original;
                    }
                    this.retainLanceHandle(tablePermit, this.knowledgeTable, 'init-table:universal_knowledge', [connection]);
                } else {
                    console.log("[LANCEDB] Table 'universal_knowledge' not found. Will be created on ingest.");
                }

                if (tableNames.includes('memory_records_v2')) {
                    const tablePermit = this.ownership.reserveResource(operation, 'init-table:memory_records_v2');
                    try { this.table = await connection.openTable('memory_records_v2'); }
                    catch (original) {
                        preserveOriginal(this.ownership, 'table-allocation-failed', () => this.ownership.releaseUnused(tablePermit));
                        throw original;
                    }
                    this.retainLanceHandle(tablePermit, this.table, 'init-table:memory_records_v2', [connection]);
                }
                this.initialized = true;
                this.startOptimizeLoop();
                console.log("[LANCEDB] Connected.");
                return;

            } catch (e: any) {
                this.ownership.failure('init:ORIGINAL_ATTEMPT_FAILED', e);
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
        return this.ownership.invoke('original-queued-store', admitted => {
            const operation = this.writeQueue.then(() => this.writeAndVerify(admitted, node, vector));
            this.writeQueue = operation.then(() => undefined, () => undefined);
            return operation;
        });
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
        return this.ownership.invoke('original-queued-store-many', admitted => {
            const operation = this.writeQueue.then(() => this.writeManyAndVerify(admitted, nodes));
            this.writeQueue = operation.then(() => undefined, () => undefined);
            return operation;
        });
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

    private async reopenTable(tableName: 'memory_records_v2' | 'memory', admitted?: Operation): Promise<void> {
        if (!admitted) return this.ownership.invoke('original-reopen-table', operation => this.reopenTable(tableName, operation));
        const connection = this.db!;
        const permit = this.ownership.reserveResource(admitted, 'reopen-table:' + tableName);
        let fresh: lancedb.Table;
        try { fresh = await connection.openTable(tableName); }
        catch (original) {
            preserveOriginal(this.ownership, 'reopen-table-allocation-failed', () => this.ownership.releaseUnused(permit)); throw original;
        }
        this.retainLanceHandle(permit, fresh, 'reopen-table:' + tableName, [connection]);
        if (tableName === 'memory_records_v2') { this.table = fresh; this.ftsReady.delete('v2'); }
        else { this.legacyTable = fresh; this.ftsReady.delete('legacy'); }
    }

    private static isStaleHandleError(error: unknown): boolean {
        const message = String(error);
        return message.includes('LanceError(IO)') && /not found/i.test(message);
    }

    private async withCurrentTable<T>(tableName: 'memory_records_v2' | 'memory', operation: () => Promise<T>, admitted?: Operation): Promise<T> {
        if (!admitted) return this.ownership.invoke('original-current-table-operation', owner => this.withCurrentTable(tableName, operation, owner));
        try {
            return await operation();
        } catch (error) {
            if (!this.db || !LanceDbService.isStaleHandleError(error)) throw error;
            console.warn(`[LANCEDB] Cached handle for '${tableName}' references pruned fragments; reopening and retrying once.`);
            this.ownership.failure('table:ORIGINAL_STALE_HANDLE_RETRY', error);
            await this.reopenTable(tableName, admitted);
            return await operation();
        }
    }

    private async writeManyAndVerify(operation: Operation, nodes: MemoryNode[]): Promise<{ ok: true; count: number }> {
        await this.ensureInitializedOriginal(operation);
        if (!this.db) throw new Error('LanceDB is unavailable');
        if (nodes.length === 0) return { ok: true, count: 0 };
        const records = nodes.map(n => this.toRecord(n));
        if (!this.table) {
            const names = await this.db.tableNames();
            const connection = this.db;
            const permit = this.ownership.reserveResource(operation, 'queued-canonical-table');
            try { this.table = names.includes('memory_records_v2')
                ? await connection.openTable('memory_records_v2')
                : await connection.createTable('memory_records_v2', records); }
            catch (original) {
                preserveOriginal(this.ownership, 'queued-canonical-table-allocation-failed', () => this.ownership.releaseUnused(permit)); throw original;
            }
            this.retainLanceHandle(permit, this.table, 'queued-canonical-table', [connection]);
        } else {
            // Same atomic merge as store(): update on id match, insert otherwise.
            await this.withCurrentTable('memory_records_v2', () => this.table!.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute(records), operation);
        }
        this.ftsReady.delete('v2');
        // Read-back spot check on the batch edges (first + last). Full per-row
        // read-back is exactly what makes bulk seeding slow; store() keeps it
        // for single writes.
        for (const edge of [nodes[0], nodes[nodes.length - 1]]) {
            const stored = await this.getNodeByIdOriginal(operation, edge.id);
            if (!stored) throw new Error(`LanceDB bulk read-back verification failed for ${edge.id}`);
        }
        return { ok: true, count: nodes.length };
    }

    private async writeAndVerify(operation: Operation, node: MemoryNode, vector?: number[]): Promise<{ ok: true; id: string; checksum: string; version: number }> {
        await this.ensureInitializedOriginal(operation);
        if (!this.db) throw new Error('LanceDB is unavailable');
        const json = JSON.stringify(node);
        const checksum = createHash('sha256').update(json).digest('hex');
        const record = this.toRecord(node, json);
        if (!this.table) {
            const names = await this.db.tableNames();
            const connection = this.db;
            const permit = this.ownership.reserveResource(operation, 'queued-canonical-table');
            try { this.table = names.includes('memory_records_v2')
                ? await connection.openTable('memory_records_v2')
                : await connection.createTable('memory_records_v2', [record]); }
            catch (original) {
                preserveOriginal(this.ownership, 'queued-canonical-table-allocation-failed', () => this.ownership.releaseUnused(permit)); throw original;
            }
            this.retainLanceHandle(permit, this.table, 'queued-canonical-table', [connection]);
        } else {
            // Atomic merge rather than delete + add, which loses the old row on add failure.
            await this.withCurrentTable('memory_records_v2', () => this.table!.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute([record]), operation);
        }
        this.ftsReady.delete('v2');
        // Unknown legacy vectors are never guessed into a model collection.
        if (vector && node.embeddingIdentity && validEmbedding(vector, node.embeddingIdentity)) {
            try { await this.projectEmbeddingOriginal(operation, node, vector, node.embeddingIdentity); }
            catch (error) {
                this.ownership.failure('canonical-write:ORIGINAL_PROJECTION_PENDING', error);
                console.warn('[LANCEDB] Vector projection pending; canonical memory preserved', error);
            }
        }
        const stored = await this.getNodeByIdOriginal(operation, node.id);
        if (!stored || createHash('sha256').update(JSON.stringify(stored)).digest('hex') !== checksum) {
            throw new Error(`LanceDB read-back verification failed for ${node.id}`);
        }
        return { ok: true, id: node.id, checksum, version: node.timestamp };
    }

    public async getNodeById(id: string): Promise<MemoryNode | null> {
        return this.ownership.invoke('original-getNodeById', operation => this.getNodeByIdOriginal(operation, id));
    }
    private async getNodeByIdOriginal(operation: Operation, id: string): Promise<MemoryNode | null> {
        await this.ensureInitializedOriginal(operation);
        const safeId = id.replace(/'/g, "''");
        for (const tableName of ['memory_records_v2', 'memory'] as const) {
            const rows = await this.withCurrentTable(tableName, async () => {
                const current = (tableName === 'memory_records_v2' ? this.table : this.legacyTable);
                if (!current) return [];
                return current.query().where(`id = '${safeId}'`).limit(2).toArray();
            }, operation);
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
    private async getNodesByIds(operation: Operation, ids: string[]): Promise<Map<string, MemoryNode>> {
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
            }, operation);
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
        if (this.optimizeTimer || !this.ownership.open) return;
        const raw = process.env.LANCEDB_OPTIMIZE_INTERVAL_MINUTES;
        const minutes = raw === undefined ? 360 : Number(raw);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            console.log('[LANCEDB] Periodic optimize disabled (LANCEDB_OPTIMIZE_INTERVAL_MINUTES).');
            return;
        }
        this.optimizeTimer = setInterval(() => {
            if (!this.ownership.open) return;
            void this.runOptimizeOnce();
        }, minutes * 60_000);
        this.optimizeTimer.unref?.();
        console.log(`[LANCEDB] Periodic optimize every ${minutes} minutes (compact only, no version prune).`);
    }

    public runOptimizeOnce(): Promise<void> {
        return this.ownership.invoke('original-optimize', operation => this.runOptimizeOriginal(operation));
    }
    private async runOptimizeOriginal(operation: Operation): Promise<void> {
        if (this.optimizeRunning || !this.db) return;
        this.optimizeRunning = true;
        try {
            const names = await this.db.tableNames();
            for (const n of names.filter(x => x === 'memory_records_v2' || x.startsWith('memory_vectors_'))) {
                const connection = this.db;
                const tablePermit = this.ownership.reserveResource(operation, 'optimize-table:' + n);
                let t: lancedb.Table;
                try { t = await connection.openTable(n); }
                catch (original) {
                    preserveOriginal(this.ownership, 'optimize-table-allocation-failed', () => this.ownership.releaseUnused(tablePermit));
                    throw original;
                }
                this.retainLanceHandle(tablePermit, t, 'optimize-table:' + n, [connection]);
                await t.optimize({ cleanupOlderThan: LanceDbService.OPTIMIZE_NEVER_PRUNE_BEFORE, deleteUnverified: false });
                console.log(`[LANCEDB] Optimize completed for ${n} (compact only, no version prune).`);
            }
        } catch (e) {
            this.ownership.failure('optimize:SELECTED_ATTEMPT_FAILED', e);
            console.warn('[LANCEDB] Optimize failed; will retry on next interval.', e);
        } finally {
            this.optimizeRunning = false;
        }
    }

    private vectorTableName(identity: EmbeddingIdentity): string {
        return 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
    }
    public async projectEmbedding(node: MemoryNode, vector: number[], identity: EmbeddingIdentity): Promise<void> {
        return this.ownership.invoke('original-project-embedding', operation => this.projectEmbeddingOriginal(operation, node, vector, identity));
    }
    private async projectEmbeddingOriginal(operation: Operation, node: MemoryNode, vector: number[], identity: EmbeddingIdentity): Promise<void> {
        if (!validEmbedding(vector, identity)) throw new Error('Invalid or incompatible embedding');
        await this.ensureInitializedOriginal(operation);
        if (!this.db) throw new Error('LanceDB is unavailable');
        const name = this.vectorTableName(identity);
        const record = { id: node.id, vector, ownerId: node.ownerId || 'system', json_data: JSON.stringify(node) };
        const names = await this.db.tableNames();
        const connection = this.db;
        const permit = this.ownership.reserveResource(operation, 'vector-projection-table');
        let table: lancedb.Table;
        try { table = names.includes(name) ? await connection.openTable(name) : await connection.createTable(name, [record]); }
        catch (original) {
            preserveOriginal(this.ownership, 'vector-projection-table-allocation-failed', () => this.ownership.releaseUnused(permit)); throw original;
        }
        this.retainLanceHandle(permit, table, 'vector-projection-table', [connection]);
        // Intent-first: the durable ANN pending row is written BEFORE the
        // canonical projection, so a crash between the two is replayed on the
        // next open (pending flush) instead of silently desyncing the index.
        let ann: AnnIndex | null = null;
        if (this.ensureAnnEngine()) {
            try {
                ann = await this.annIndexFor(name, identity.dimension, () => this.projectionRows(table), await table.countRows(), table);
                ann.queueUpsert(node.id, node.ownerId || 'system', vector);
            } catch (e) {
                this.ownership.failure('vector-projection:ORIGINAL_ANN_QUEUE_FAILED', e);
                console.error(`[VECTOR] ANN queue failed for ${node.id} (${(e as Error).message}); exact scan covers this memory until rebuild`);
                ann?.markStale(`queueUpsert failed: ${(e as Error).message}`);
            }
        }
        await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([record]);
        if (this.table) await this.withCurrentTable('memory_records_v2', () => this.table!.update({ where: `id = '${node.id.replace(/'/g, "''")}'`, values: { embedding_state: 'READY' } }), operation);
    }
    public async pendingEmbeddings(limit = 100): Promise<MemoryNode[]> {
        return this.ownership.invoke('original-pendingEmbeddings', operation => this.pendingEmbeddingsOriginal(operation, limit));
    }
    private async pendingEmbeddingsOriginal(operation: Operation, limit: number): Promise<MemoryNode[]> {
        await this.ensureInitializedOriginal(operation);
        if (!this.table) return [];
        const rows = await this.withCurrentTable('memory_records_v2', () => this.table!.query().where("embedding_state = 'EMBEDDING_PENDING'").limit(limit).toArray(), operation);
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
        return this.ownership.invoke('original-vector-search', operation => this.searchOriginal(operation, queryVector, limit, filter, identity));
    }
    private async searchOriginal(operation: Operation, queryVector: number[], limit: number, filter: string | undefined, identity: EmbeddingIdentity | undefined): Promise<MemoryNode[]> {
        if (!identity || !validEmbedding(queryVector, identity)) return [];
        await this.ensureInitializedOriginal(operation);
        if (!this.db) return [];
        const name = this.vectorTableName(identity);
        if (!(await this.db.tableNames()).includes(name)) return [];
        const connection = this.db;
        const permit = this.ownership.reserveResource(operation, 'vector-search-table');
        let table: lancedb.Table;
        try { table = await connection.openTable(name); }
        catch (original) {
            preserveOriginal(this.ownership, 'vector-search-table-allocation-failed', () => this.ownership.releaseUnused(permit)); throw original;
        }
        this.retainLanceHandle(permit, table, 'vector-search-table', [connection]);
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
                    const byId = await this.getNodesByIds(operation, hits.map(h => h.id));
                    return hits.map(h => byId.get(h.id)).filter((n): n is MemoryNode => n !== null);
                }
            } catch (e) {
                this.ownership.failure('vector-search:ORIGINAL_ANN_FALLBACK', e);
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
        const byId = await this.getNodesByIds(operation, top.map(r => r.id));
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
        return this.ownership.invoke('original-searchByContent', operation => this.searchByContentOriginal(operation, textQuery, limit, scope));
    }
    private async searchByContentOriginal(operation: Operation, textQuery: string, limit: number, scope: MemoryScope): Promise<MemoryNode[]> {
        if (!textQuery.trim()) return [];
        await this.ensureInitializedOriginal(operation);
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
                            this.ownership.failure('fts:ORIGINAL_COMMIT_CONFLICT_RETRY', e);
                            console.warn(`[LANCEDB] FTS createIndex conflict on '${tableName}' (attempt ${attempt}/${maxAttempts}); rebasing on fresh handle.`);
                            await this.reopenTable(tableName, operation);
                        }
                    }
                }
                return current.query().where(scopeSql(scope)).fullTextSearch(textQuery).limit(limit * 3).toArray();
            }, operation);
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
        return this.ownership.invoke('original-recent-observations', operation => this.getRecentObservationsOriginal(operation, tag, limit, excludedIds));
    }
    private async getRecentObservationsOriginal(operation: Operation, tag: string|string[], limit: number, excludedIds: string[]): Promise<MemoryNode[]> {
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
        const db=this.db??await (this.observationConnection??=this.openObservationConnectionOriginal(operation));
        const names=await db.tableNames();
        const tables=[];
        for(const name of ['memory','memory_records_v2']){
            if(names.includes(name)){
                const permit = this.ownership.reserveResource(operation, 'observation-table:' + name);
                let table: lancedb.Table;
                try { table = await db.openTable(name); }
                catch (original) {
                    preserveOriginal(this.ownership, 'observation-table-open-failed', () => this.ownership.releaseUnused(permit)); throw original;
                }
                this.retainLanceHandle(permit, table, 'observation-table:' + name, [db]);
                tables.push({name,table,version:await table.version()});
            }
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

    private openObservationConnectionOriginal(operation: Operation): Promise<lancedb.Connection> {
        const permit = this.ownership.reserveResource(operation, 'observation-connection');
        let acquired = false;
        // Same lazy runtime->connect chain and original reset-on-error path.
        // Retain the actual candidate before publishing fulfillment to sharers.
        return loadLanceRuntime().then(runtime => runtime.connect(this.databasePath)).then(connection => {
            acquired = true;
            try { this.retainLanceHandle(permit, connection, 'observation-connection'); }
            catch (bookkeeping) {
                this.ownership.unknown('observation-connection:ACTUAL_CANDIDATE_RETENTION_UNVERIFIED', true);
                throw bookkeeping;
            }
            return connection;
        }).catch(original => {
            this.observationConnection = null;
            if (!acquired) preserveOriginal(this.ownership, 'observation-connection-allocation-failed', () => this.ownership.releaseUnused(permit));
            throw original;
        });
    }

    public async getLatestObservation(tag:string,excludedIds:string[]=[]):Promise<MemoryNode|null>{
        return (await this.getRecentObservations(tag,1,excludedIds))[0]??null;
    }

    public async getAllNodes(): Promise<MemoryNode[]> {
        return this.ownership.invoke('original-getAllNodes', operation => this.getAllNodesOriginal(operation));
    }
    private async getAllNodesOriginal(operation: Operation): Promise<MemoryNode[]> {
        if (!this.table) await this.init(3, 1000, operation);
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
                }, operation);
                for (const row of rows) { const node = JSON.parse(row.json_data); unique.set(node.id, node); }
            }
            return [...unique.values()];
        } catch (e) {
            this.ownership.failure('get-all-nodes:ORIGINAL_SELECTED_FAILURE', e);
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
        return this.ownership.invoke('original-store-knowledge', operation => this.storeKnowledgeOriginal(operation, item));
    }
    private async storeKnowledgeOriginal(operation: Operation, item: any): Promise<void> {
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
        await this.ensureKnowledgeTableOriginal(operation);

        try {
            if (!this.knowledgeTable) {
                const tableNames = await this.db.tableNames();
                const connection = this.db;
                const permit = this.ownership.reserveResource(operation, 'knowledge-store-table');
                if (tableNames.includes('universal_knowledge')) {
                    try { this.knowledgeTable = await connection.openTable('universal_knowledge'); }
                    catch (original) {
                        preserveOriginal(this.ownership, 'knowledge-store-open-failed', () => this.ownership.releaseUnused(permit)); throw original;
                    }
                    this.retainLanceHandle(permit, this.knowledgeTable, 'knowledge-store-open', [connection]);
                } else {
                    // Original fallback create and early return remain selected.
                    try { this.knowledgeTable = await connection.createTable('universal_knowledge', [item]); }
                    catch (original) {
                        preserveOriginal(this.ownership, 'knowledge-store-create-failed', () => this.ownership.releaseUnused(permit)); throw original;
                    }
                    this.retainLanceHandle(permit, this.knowledgeTable, 'knowledge-store-created', [connection]);
                    console.log("[LANCEDB] Created 'universal_knowledge' table.");
                    return;
                }
            }

            // Upsert
            try {
                const safeId = String(item.id).replace(/'/g, "''");
                await this.knowledgeTable.delete(`id = '${safeId}'`);
            } catch (e) {
                this.ownership.failure('knowledge-store:ORIGINAL_DELETE_IGNORED', e);
                console.error("[LANCEDB] Knowledge Upsert deletion ignored:", e);
            }

            await this.knowledgeTable.add([item]);
            // console.log(`[LANCEDB] Stored Knowledge: ${item.path}`);

        } catch (error) {
            this.ownership.failure('knowledge-store:ORIGINAL_SELECTED_FAILURE', error);
            console.error(`[LANCEDB] Failed to store knowledge: ${item.path}`, error);
        }
    }

    public async searchKnowledge(queryVector: number[], limit: number = 5): Promise<any[]> {
        return this.ownership.invoke('original-search-knowledge', operation => this.searchKnowledgeOriginal(operation, queryVector, limit));
    }
    private async searchKnowledgeOriginal(operation: Operation, queryVector: number[], limit: number): Promise<any[]> {
        if (!this.knowledgeTable) {
            // Try to init if missing
            if (this.db) {
                const tableNames = await this.db.tableNames();
                if (tableNames.includes('universal_knowledge')) {
                    const connection = this.db;
                    const permit = this.ownership.reserveResource(operation, 'knowledge-search-table');
                    try { this.knowledgeTable = await connection.openTable('universal_knowledge'); }
                    catch (original) {
                        preserveOriginal(this.ownership, 'knowledge-search-open-failed', () => this.ownership.releaseUnused(permit)); throw original;
                    }
                    this.retainLanceHandle(permit, this.knowledgeTable, 'knowledge-search-open', [connection]);
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
            this.ownership.failure('knowledge-search:ORIGINAL_SELECTED_FAILURE', e);
            console.error("[LANCEDB] Knowledge Search Failed", e);
            return [];
        }
    }
}


/** Exact class factory: no caller-supplied construction function. */
export function createOwnedLanceDbService(databasePath: string | undefined, ownership: Scope): LanceDbService {
    const operation = ownership.beginConstruction();
    try {
        const instance = new LanceDbService(databasePath, ownership, operation);
        ownership.constructed(operation, instance); return instance;
    } catch (original) {
        preserveOriginal(ownership, 'construction-failure', () => ownership.constructionFailed(operation, original)); throw original;
    }
}
export const lancedbService = createOwnedLanceDbService(undefined, lanceOwner());
