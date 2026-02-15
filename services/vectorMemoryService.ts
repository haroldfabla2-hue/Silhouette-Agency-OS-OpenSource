import { QDRANT_CONFIG } from '../constants';
import { BrandDigitalTwin } from '../types';

// Browser-safe Qdrant Client Wrapper
class VectorMemoryService {
    private client: any;
    private isConnected: boolean = false;
    private collectionName = QDRANT_CONFIG.collectionName;

    constructor() {
        // Lazy init
    }

    public async connect() {
        if (typeof window !== 'undefined') return; // Browser safety

        // [PA-058] Lite Mode Check
        const { configLoader } = await import('../server/config/configLoader');
        const config = configLoader.getConfig();
        if (config.modules.vectorDB === false) {
            console.log("[VECTOR_MEM] 🚫 VectorDB module disabled in config (Lite Mode). Using LanceDB only.");
            return;
        }

        if (!this.client) {
            try {
                // Dynamic import to prevent bundling
                const { QdrantClient } = await import('@qdrant/js-client-rest');

                console.log(`[VECTOR_MEM] Connecting to Qdrant at ${QDRANT_CONFIG.url} (Collection: ${this.collectionName})`);
                this.client = new QdrantClient({
                    url: QDRANT_CONFIG.url,
                    checkCompatibility: false
                });

                // Check connectivity
                const collections = await this.client.getCollections();
                console.log('✅ Qdrant Connected (Eternal Memory Active)', collections);
                this.isConnected = true;

                // Ensure collection exists
                await this.ensureCollection();
            } catch (e) {
                console.error("❌ Failed to initialize Qdrant client", e);
            }
        }
    }

    private async ensureCollection() {
        if (!this.isConnected) return;
        try {
            const result = await this.client.getCollections();
            const exists = result.collections.some((c: any) => c.name === this.collectionName);

            if (!exists) {
                console.log(`[QDRANT] Creating collection: ${this.collectionName}`);
                await this.client.createCollection(this.collectionName, {
                    vectors: {
                        size: 768, // Default for many embedding models (e.g. Gemini/Vertex)
                        distance: 'Cosine',
                    },
                });
            }
        } catch (e) {
            console.error("Failed to ensure Qdrant collection", e);
        }
    }

    public async storeMemory(id: string, vector: number[], payload: any) {
        if (!this.isConnected || !this.client) return;

        // [ROBUSTNESS] Hard Guard: Never store empty/undefined thoughts.
        if (!payload || !payload.content || payload.content === 'undefined' || payload.content.trim().length === 0) {
            console.warn(`[VECTOR_MEM] 🛡️ BLOCKED Corrupt Node Write (Empty Content). ID: ${id}`);
            return;
        }

        try {
            // FRACTAL INDEXING (L7)
            // Inject Time Grid for O(1) Temporal Retrieval
            const date = new Date(payload.timestamp || Date.now());
            const timeGrid = {
                year: date.getFullYear(),
                month: date.getMonth() + 1, // 1-12
                day: date.getDate(),
                hour: date.getHours(),
                weekday: date.getDay()
            };

            await this.retry(async () => {
                await this.client.upsert(this.collectionName, {
                    wait: true,
                    points: [
                        {
                            id,
                            vector,
                            payload: {
                                ...payload,
                                ...timeGrid // Flatten grid into top-level payload for filtering
                            }
                        }
                    ]
                });
            });
        } catch (e) {
            console.error("Failed to store vector memory", e);
        }
    }

    public async searchMemory(vector: number[], limit: number = 5, filter?: any) {
        if (!this.isConnected || !this.client) return [];
        try {
            return await this.retry(async () => {
                let qdrantFilter = undefined;

                // Transform simple key-value filter to Qdrant 'must' clause
                if (filter) {
                    const must = Object.entries(filter).map(([key, value]) => ({
                        key,
                        match: { value }
                    }));
                    if (must.length > 0) {
                        qdrantFilter = { must };
                    }
                }

                return await this.client.search(this.collectionName, {
                    vector,
                    limit,
                    filter: qdrantFilter,
                    with_payload: true
                });
            });
        } catch (e) {
            console.error("Failed to search vector memory", e);
            return [];
        }
    }

    private async retry<T>(operation: () => Promise<T>, retries: number = 5, delay: number = 500): Promise<T> {
        try {
            return await operation();
        } catch (e: any) {
            if (retries > 0) {
                // Exponential Backoff with Cap (Max 5s)
                const nextDelay = Math.min(delay * 2, 5000);
                // console.warn(`[VECTOR_MEM] Operation failed, retrying in ${delay}ms... (${retries} left)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.retry(operation, retries - 1, nextDelay);
            }
            throw e;
        }
    }

    public async getRecentMemories(limit: number = 20): Promise<any[]> {
        if (!this.isConnected || !this.client) {
            return [];
        }
        try {
            return await this.retry(async () => {
                // FETCH FIX: Scroll returns arbitrary order (by ID).
                // We must fetch a larger pool and sort client-side to emulate "Recent".
                const fetchSize = Math.max(limit * 5, 200);

                const result = await this.client.scroll(this.collectionName, {
                    limit: fetchSize,
                    with_payload: true,
                    with_vector: false
                });

                // Sort by Timestamp Descending (Newest First)
                return result.points
                    .sort((a: any, b: any) => (b.payload?.timestamp || 0) - (a.payload?.timestamp || 0))
                    .slice(0, limit);
            });
        } catch (e) {
            // CRITICAL FIX: Do not crash the server if Qdrant is down.
            // console.error("[VECTOR_MEM] Failed to get recent memories (Qdrant might be offline)", e);
            return [];
        }
    }

    public async getAllNodes(limit: number = 200): Promise<any[]> {
        if (!this.isConnected || !this.client) return [];
        return this.getRecentMemories(limit);
    }

    public async getStats(): Promise<{ count: number; vectorsCount: number }> {
        if (!this.isConnected || !this.client) return { count: 0, vectorsCount: 0 };
        try {
            return await this.retry(async () => {
                const collectionInfo = await this.client.getCollection(this.collectionName);
                return {
                    count: collectionInfo.points_count || 0,
                    vectorsCount: collectionInfo.vectors_count || 0
                };
            });
        } catch (e) {
            console.error("Failed to get vector stats", e);
            return { count: -1, vectorsCount: -1 };
        }
    }

    public async searchByContent(query: string, limit: number = 20): Promise<any[]> {
        if (!this.isConnected || !this.client) return [];
        try {
            // Scroll through recent memories and filter by content
            // NOTE: Ideally we should use Qdrant Full Text Search, but for now this is robust enough for <10k items
            return await this.retry(async () => {
                const result = await this.client.scroll(this.collectionName, {
                    limit: 500, // Fetch broader context
                    with_payload: true,
                    with_vector: false
                });

                const queryLower = query.toLowerCase();
                const points = result.points || [];

                return points
                    .filter((p: any) => (p.payload?.content || "").toLowerCase().includes(queryLower))
                    .slice(0, limit);
            });
        } catch (e) {
            console.error("Failed to search vector memory by content", e);
            return [];
        }
    }

    // --- BISOCIATION SUPPORT (GOLDILOCKS ZONE) ---
    public async searchDistantMemories(vector: number[], minScore: number = 0.35, maxScore: number = 0.65, limit: number = 5): Promise<any[]> {
        if (!this.isConnected || !this.client) return [];
        try {
            // Qdrant doesn't support "Range Score" natively in simple search.
            // Strategy: Search slightly deeper (top 50) and filter client-side for the score range.
            return await this.retry(async () => {
                const results = await this.client.search(this.collectionName, {
                    vector,
                    limit: 50, // Get a larger candidate pool
                    with_payload: true,
                    score_threshold: minScore // Minimum cutoff
                });

                // Filter for "Not Too Close" (Goldilocks)
                return results
                    .filter((res: any) => res.score <= maxScore)
                    .slice(0, limit);
            });
        } catch (e) {
            console.error("Bisociation Search Failed:", e);
            return [];
        }
    }

    // --- REAL BRAND TWIN METHODS ---

    public async getBrandTwin(brandId: string): Promise<BrandDigitalTwin | null> {
        if (!this.isConnected || !this.client) return null;
        try {
            // 1. Try direct retrieval if ID is UUID
            try {
                const points = await this.client.retrieve(this.collectionName, { ids: [brandId] });
                if (points.length > 0) return points[0].payload as BrandDigitalTwin;
            } catch (e) {
                // Ignore invalid UUID error, proceed to filter
            }

            // 2. Search by payload 'id' field
            const result = await this.client.scroll(this.collectionName, {
                filter: {
                    must: [{ key: "id", match: { value: brandId } }]
                },
                limit: 1,
                with_payload: true
            });

            if (result.points.length > 0) {
                return result.points[0].payload as BrandDigitalTwin;
            }
            return null;
        } catch (e) {
            console.error("Failed to get brand twin", e);
            return null;
        }
    }

    public async queryBrandRules(brandId: string, query: string): Promise<string> {
        // In a full RAG system, we would embed the query and search the brand's knowledge base.
        // For now, we retrieve the Brand Twin and return its core manifesto rules.
        const brand = await this.getBrandTwin(brandId);
        if (!brand) return "Brand rules not found.";

        // Return the Design System Rules from the Manifesto
        const rules = [
            `Tone of Voice: ${brand.manifesto.toneOfVoice.join(', ')}`,
            `Typography Rules: ${brand.designSystem.typography.usageRules}`,
            `Logo Clearance: ${brand.designSystem.logoRules.clearance}`
        ];
        return rules.join('\n');
    }

    public async updateManifesto(brandId: string, feedback: string): Promise<boolean> {
        if (!this.isConnected || !this.client) return false;
        try {
            const brand = await this.getBrandTwin(brandId);
            if (!brand) return false;

            // Append feedback to the brand's evolution log (simplified)
            // In reality, we would use an LLM to synthesize the feedback into the manifesto.
            const updatedBrand = {
                ...brand,
                lastUpdated: Date.now(),
                evolutionLog: [...(brand.evolutionLog || []), { date: Date.now(), feedback }]
            };

            // Upsert back to Qdrant (requires existing vector, or we generate a new one? 
            // For now, we assume we keep the existing vector or use a zero vector if just updating payload)
            // We need the point ID.

            // Find the point ID first
            const result = await this.client.scroll(this.collectionName, {
                filter: {
                    must: [{ key: "id", match: { value: brandId } }]
                },
                limit: 1
            });

            if (result.points.length > 0) {
                const pointId = result.points[0].id;
                await this.client.setPayload(this.collectionName, {
                    payload: updatedBrand,
                    points: [pointId]
                });
                return true;
            }
            return false;
        } catch (e) {
            console.error("Failed to update manifesto", e);
            return false;
        }
    }
}

export const vectorMemory = new VectorMemoryService();
