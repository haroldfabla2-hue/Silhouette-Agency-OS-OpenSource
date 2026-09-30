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

function adjustVectorDimension(vector: number[], targetDim: number = DEFAULT_DIMENSIONS): number[] {
    if (!validEmbedding(vector, { model: 'knowledge', version: '1', dimension: targetDim })) {
        throw new Error('Invalid embedding: dimension, finite values and nonzero magnitude required');
    }
    return vector;
}

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

export class LanceDbService {
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

    private async writeAndVerify(node: MemoryNode, vector?: number[]): Promise<{ ok: true; id: string; checksum: string; version: number }> {
        await this.ensureInitialized();
        if (!this.db) throw new Error('LanceDB is unavailable');
        const json = JSON.stringify(node);
        const checksum = createHash('sha256').update(json).digest('hex');
        const record = {
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
            json_data: json
        };
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
        await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([record]);
        if (this.table) await this.table.update({ where: `id = '${node.id.replace(/'/g, "''")}'`, values: { embedding_state: 'READY' } });
    }
    public async pendingEmbeddings(limit = 100): Promise<MemoryNode[]> {
        await this.ensureInitialized();
        if (!this.table) return [];
        const rows = await this.table.query().where("embedding_state = 'EMBEDDING_PENDING'").limit(limit).toArray();
        return rows.map(r => JSON.parse(r.json_data));
    }
    public async search(queryVector: number[], limit = 10, filter?: string, identity?: EmbeddingIdentity): Promise<MemoryNode[]> {
        if (!identity || !validEmbedding(queryVector, identity)) return [];
        await this.ensureInitialized();
        if (!this.db) return [];
        const name = this.vectorTableName(identity);
        if (!(await this.db.tableNames()).includes(name)) return [];
        const table = await this.db.openTable(name);
        let query = table.search(queryVector).distanceType('cosine').limit(limit);
        if (filter) query = query.where(filter);
        const rows = await query.toArray();
        const current = await Promise.all(rows.map(r => this.getNodeById(r.id)));
        return current.filter((n): n is MemoryNode => n !== null);
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
        if (!this.db) return;

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
            const results = await this.knowledgeTable.search(adjustedVector)
                .limit(limit)
                .toArray();
            return results;
        } catch (e) {
            console.error("[LANCEDB] Knowledge Search Failed", e);
            return [];
        }
    }
}

export const lancedbService = new LanceDbService();
