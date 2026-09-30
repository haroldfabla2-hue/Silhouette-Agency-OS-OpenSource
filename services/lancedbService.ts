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

// Helper: Dynamically padding vectors to match the database schema
function adjustVectorDimension(vector: number[], targetDim: number = DEFAULT_DIMENSIONS): number[] {
    if (!vector || vector.length === 0) return Array(targetDim).fill(0);
    if (vector.length === targetDim) return vector;
    if (vector.length > targetDim) return vector.slice(0, targetDim); // Truncate

    // Pad with zeros to match target dimensions
    const padded = new Array(targetDim).fill(0);
    for (let i = 0; i < vector.length; i++) {
        padded[i] = vector[i];
    }
    return padded;
}

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

export class LanceDbService {
    private db: lancedb.Connection | null = null;
    private table: lancedb.Table | null = null; // Memory Table
    private knowledgeTable: lancedb.Table | null = null; // Universal Knowledge Table
    private initialized = false;
    private writeQueue: Promise<void> = Promise.resolve();
    private initPromise: Promise<void> | null = null;

    constructor() {
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

                this.db = await lancedb.connect(DB_PATH);
                const tableNames = await this.db.tableNames();

                // 1. Memory Table
                if (tableNames.includes('memory')) {
                    this.table = await this.db.openTable('memory');
                } else {
                    console.log("[LANCEDB] Table 'memory' not found. It will be created on first insert.");
                }

                // 2. Universal Knowledge Table
                if (tableNames.includes('universal_knowledge')) {
                    this.knowledgeTable = await this.db.openTable('universal_knowledge');
                } else {
                    console.log("[LANCEDB] Table 'universal_knowledge' not found. Will be created on ingest.");
                }

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
        if (!this.table) return false;
        try {
            // [FIX 2026-02] Sanitize ID to prevent SQL injection
            const safeId = id.replace(/'/g, "''");
            await this.table.delete(`id = '${safeId}'`);
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
            vector: adjustVectorDimension(vector || []),
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
            this.table = names.includes('memory')
                ? await this.db.openTable('memory')
                : await this.db.createTable('memory', [record]);
        } else {
            // Atomic merge rather than delete + add, which loses the old row on add failure.
            await this.table.mergeInsert('id')
                .whenMatchedUpdateAll()
                .whenNotMatchedInsertAll()
                .execute([record]);
        }
        const stored = await this.getNodeById(node.id);
        if (!stored || createHash('sha256').update(JSON.stringify(stored)).digest('hex') !== checksum) {
            throw new Error(`LanceDB read-back verification failed for ${node.id}`);
        }
        return { ok: true, id: node.id, checksum, version: node.timestamp };
    }

    public async getNodeById(id: string): Promise<MemoryNode | null> {
        await this.ensureInitialized();
        if (!this.table) return null;
        const safeId = id.replace(/'/g, "''");
        const rows = await this.table.query().where(`id = '${safeId}'`).limit(2).toArray();
        if (rows.length > 1) throw new Error(`Duplicate memory ID in LanceDB: ${id}`);
        return rows.length ? JSON.parse(rows[0].json_data) as MemoryNode : null;
    }

    public async search(queryVector: number[], limit: number = 10, filter?: string): Promise<MemoryNode[]> {
        if (!this.table) return [];

        try {
            const adjustedVector = adjustVectorDimension(queryVector);
            let query = this.table.search(adjustedVector).limit(limit);
            if (filter) {
                query = query.where(filter);
            }
            const results = await query.toArray();

            return results.map((r: any) => {
                const node = JSON.parse(r.json_data);
                return node;
            });
        } catch (e) {
            console.error("[LANCEDB] Search Failed", e);
            return [];
        }
    }

    /**
     * Finds semantically similar nodes to the given existing node ID.
     */
    public async findSimilarNodes(nodeId: string, limit: number = 5): Promise<(MemoryNode & { similarity?: number })[]> {
        if (!this.table) await this.init();
        if (!this.table) return [];

        try {
            // 1. Get the vector of the source node
            const safeNodeId = nodeId.replace(/'/g, "''");
            const sourceRecord = await this.table.query()
                .where(`id = '${safeNodeId}'`)
                .limit(1)
                .toArray();

            if (sourceRecord.length === 0) return [];

            const rawVector = sourceRecord[0].vector;
            if (!rawVector) return [];

            // Convert to native array (might be Float32Array or similar from LanceDB)
            const sourceVector: number[] = Array.isArray(rawVector) ? rawVector : Array.from(rawVector);

            // 2. Search for neighbors using L2 distance (default)
            // Note: LanceDB JS doesn't support distanceType, so we compute cosine similarity manually
            const results = await this.table.search(rawVector) // Use raw for search
                .limit(limit + 1) // Fetch +1 because it will find itself
                .toArray();

            // 3. Calculate TRUE COSINE SIMILARITY manually
            // Cosine(A,B) = (A·B) / (||A|| × ||B||)
            // This is the mathematically correct semantic similarity measure
            const sourceNorm = Math.sqrt(sourceVector.reduce((sum: number, v: number) => sum + v * v, 0));

            return results
                .map((r: any) => {
                    const rawTarget = r.vector || [];
                    // Also convert target vector to native array
                    const targetVector: number[] = Array.isArray(rawTarget) ? rawTarget : Array.from(rawTarget);

                    // Align vectors to min_len (like silhouette-brain) for cosine sim
                    const min_len = Math.min(sourceVector.length, targetVector.length);
                    const sourceAlign = sourceVector.slice(0, min_len);
                    const targetAlign = targetVector.slice(0, min_len);

                    // Dot product
                    let dotProduct = 0;
                    let sourceNormAligned = 0;
                    let targetNormAligned = 0;
                    for (let i = 0; i < min_len; i++) {
                        dotProduct += sourceAlign[i] * targetAlign[i];
                        sourceNormAligned += sourceAlign[i] * sourceAlign[i];
                        targetNormAligned += targetAlign[i] * targetAlign[i];
                    }
                    sourceNormAligned = Math.sqrt(sourceNormAligned);
                    targetNormAligned = Math.sqrt(targetNormAligned);

                    // Cosine similarity: ranges from -1 to 1 (1 = identical, 0 = orthogonal, -1 = opposite)
                    const cosineSim = (sourceNormAligned > 0 && targetNormAligned > 0)
                        ? dotProduct / (sourceNormAligned * targetNormAligned)
                        : 0;

                    // Normalize to 0-1 scale: (cosineSim + 1) / 2
                    const similarity = (cosineSim + 1) / 2;

                    return {
                        ...JSON.parse(r.json_data),
                        similarity
                    };
                })
                .filter((n: any) => n.id !== nodeId)
                .slice(0, limit);

        } catch (e) {
            console.error(`[LANCEDB] findSimilarNodes(${nodeId}) Failed`, e);
            return [];
        }
    }

    public async searchByContent(textQuery: string, limit: number = 20): Promise<MemoryNode[]> {
        if (!this.table) await this.init();
        if (!this.table) return [];

        try {
            // LanceDB SQL/Filtering is limited in JS. 
            // We'll use a filter if possible, otherwise we might need to rely on vector search 
            // OR if we can't do 'LIKE', we might have to fetch more and filter, 
            // but we want to avoid fetching ALL.
            // Since we don't have a vector here, we can't use .search(vector).
            // We can use .query().where().limit()

            // NOTE: LanceDB JS 'where' supports SQL-like syntax.
            // Let's try to use a simple LIKE if supported, or just fetch recent and filter in memory 
            // but with a LIMIT to avoid the RAM spike of loading 10k rows.

            // Strategy: Fetch last 1000 items (sorted by timestamp desc if possible) and filter those.
            // This is better than fetching ALL.
            // However, LanceDB doesn't strictly guarantee order without an index or sort.
            // Let's try to filter by content if possible.

            // If 'LIKE' is not supported, we fall back to a safer limit.
            // const results = await this.table.query().where(`content LIKE '%${textQuery}%'`).limit(limit).toArray();

            // Safer approach for now: Fetch recent 500 and filter in memory. 
            // This caps the RAM usage significantly compared to 10k+.
            const results = await this.table.query().limit(500).toArray();

            return results
                .map((r: any) => JSON.parse(r.json_data))
                .filter((n: MemoryNode) => n.content.toLowerCase().includes(textQuery.toLowerCase()))
                .slice(0, limit);

        } catch (e) {
            console.error("[LANCEDB] SearchByContent Failed", e);
            return [];
        }
    }

    public async getAllNodes(): Promise<MemoryNode[]> {
        if (!this.table) await this.init();
        if (!this.table) {
            console.warn("[LANCEDB] getAllNodes: Table not initialized.");
            return [];
        }
        try {
            const results = await this.table.query().limit(10000).toArray();
            return results.map((r: any) => JSON.parse(r.json_data));
        } catch (e) {
            console.error("[LANCEDB] getAllNodes Failed", e);
            return [];
        }
    }

    public async getNodesByTier(tier: MemoryTier, limit: number = 1000): Promise<MemoryNode[]> {
        await this.ensureInitialized();
        if (!this.table) return [];
        try {
            // [FIX 2026-02] Sanitize tier to prevent SQL injection
            const safeTier = String(tier).replace(/'/g, "''");
            const results = await this.table.query()
                .where(`tier = '${safeTier}'`)
                .limit(Math.max(limit * 5, 1000))
                .toArray();

            return results
                .map((r: any) => JSON.parse(r.json_data))
                .sort((a: MemoryNode, b: MemoryNode) => (b.timestamp || 0) - (a.timestamp || 0)) // Recency Bias
                .slice(0, limit);
        } catch (e) {
            console.error(`[LANCEDB] getNodesByTier(${tier}) Failed`, e);
            throw e;
        }
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
