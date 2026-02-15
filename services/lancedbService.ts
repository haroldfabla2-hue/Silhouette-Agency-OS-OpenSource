import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import { MemoryNode, MemoryTier } from '../types';

const DB_PATH = path.resolve(process.cwd(), 'db', 'silhouette.lancedb');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

export class LanceDbService {
    private db: lancedb.Connection | null = null;
    private table: lancedb.Table | null = null; // Memory Table
    private knowledgeTable: lancedb.Table | null = null; // Universal Knowledge Table
    private initialized = false;

    constructor() {
        // [MOD] Manual init for better control
        // this.init(); 
    }

    private async init() {
        try {
            console.log(`[LANCEDB DEBUG] Connecting to: ${DB_PATH}`);
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
        } catch (e) {
            console.error("[LANCEDB] Initialization Failed", e);
        }
    }

    public async deleteNode(id: string): Promise<boolean> {
        if (!this.table) await this.init();
        if (!this.table) return false;
        try {
            await this.table.delete(`id = '${id}'`);
            // console.debug(`[LANCEDB] Deleted node ${nodeId}`);
            return true;
        } catch (e) {
            console.error(`[LANCEDB] Failed to delete node ${id}`, e);
            return false;
        }
    }

    public async store(node: MemoryNode, vector?: number[]): Promise<void> {
        if (!this.db) await this.init();
        if (!this.db) return;

        // [ROBUSTNESS] Hard Guard: Never store empty/undefined memory nodes.
        if (!node || !node.content || node.content === 'undefined' || node.content.trim().length === 0) {
            console.warn(`[LANCEDB] 🛡️ BLOCKED Corrupt Node Write. ID: ${node.id}`);
            return;
        }

        const record = {
            id: node.id,
            vector: vector || Array(768).fill(0), // Placeholder if no vector provided yet
            content: node.content,
            originalContent: node.originalContent || '',
            tags: node.tags,
            importance: node.importance,
            timestamp: node.timestamp,
            tier: node.tier,
            ownerId: node.ownerId || 'system',
            accessCount: node.accessCount,
            lastAccess: node.lastAccess,
            stabilityScore: node.stabilityScore || 0,
            json_data: JSON.stringify(node) // Store full object for reconstruction
        };

        try {
            if (!this.table) {
                const tableNames = await this.db.tableNames();
                if (tableNames.includes('memory')) {
                    this.table = await this.db.openTable('memory');
                } else {
                    this.table = await this.db.createTable('memory', [record]);
                    return; // Created and inserted
                }
            }

            // Upsert logic: Delete existing record with same ID to prevent duplicates
            try {
                await this.table.delete(`id = '${node.id}'`);
                // console.log(`[LANCEDB] Deleted old version of ${node.id}`);
            } catch (delError) {
                // Ignore delete error (e.g. if table doesn't support delete or record not found)
                console.warn("[LANCEDB] Delete failed (might be new record)", delError);
            }

            await this.table.add([record]);
        } catch (e) {
            console.error("[LANCEDB] Store Failed", e);
        }
    }

    public async search(queryVector: number[], limit: number = 10, filter?: string): Promise<MemoryNode[]> {
        if (!this.table) return [];

        try {
            let query = this.table.search(queryVector).limit(limit);
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
            const sourceRecord = await this.table.query()
                .where(`id = '${nodeId}'`)
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

                    // Dot product
                    let dotProduct = 0;
                    let targetNorm = 0;
                    for (let i = 0; i < sourceVector.length && i < targetVector.length; i++) {
                        dotProduct += sourceVector[i] * targetVector[i];
                        targetNorm += targetVector[i] * targetVector[i];
                    }
                    targetNorm = Math.sqrt(targetNorm);

                    // Cosine similarity: ranges from -1 to 1 (1 = identical, 0 = orthogonal, -1 = opposite)
                    const cosineSim = (sourceNorm > 0 && targetNorm > 0)
                        ? dotProduct / (sourceNorm * targetNorm)
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
        if (!this.table) await this.init();
        if (!this.table) return [];
        try {
            // Use SQL-like filter for efficiency if supported, or fetch and filter
            // LanceDB JS 'where' string syntax: "tier = 'MEDIUM'"
            const results = await this.table.query()
                .where(`tier = '${tier}'`)
                .limit(Math.max(limit * 5, 1000)) // Fetch more to allow effective in-memory sorting
                .toArray();

            return results
                .map((r: any) => JSON.parse(r.json_data))
                .sort((a: MemoryNode, b: MemoryNode) => (b.timestamp || 0) - (a.timestamp || 0)) // Recency Bias
                .slice(0, limit);
        } catch (e) {
            console.error(`[LANCEDB] getNodesByTier(${tier}) Failed`, e);
            return [];
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
                await this.knowledgeTable.delete(`id = '${item.id}'`);
            } catch (e) { } // Ignore if not found

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
            const results = await this.knowledgeTable.search(queryVector)
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
