import { createHash } from 'node:crypto';
import { lexicalMatches } from './lexicalMatch';
import { QDRANT_CONFIG } from '../constants';
import { BrandDigitalTwin } from '../types';

export type VectorConnection = { state: 'ready' | 'disabled' | 'unavailable'; reason?: string };
export class VectorMemoryUnavailableError extends Error {
    readonly code = 'VECTOR_MEMORY_UNAVAILABLE';
    constructor() { super('Qdrant is unavailable or its collection is incompatible'); }
}

/** Explicit dependency state. Normal boot and health never provision storage. */
export class VectorMemoryService {
    private client: any;
    private isConnected = false;
    private pendingConnection: Promise<VectorConnection> | null = null;
    private state: VectorConnection = { state: 'unavailable', reason: 'not_checked' };
    private readonly collectionName: string;
    private readonly url: string;
    private readonly enabled: () => Promise<boolean>;

    constructor(options: { url?: string; collectionName?: string; enabled?: () => Promise<boolean> } = {}) {
        this.url = options.url || QDRANT_CONFIG.url;
        this.collectionName = options.collectionName || QDRANT_CONFIG.collectionName;
        this.enabled = options.enabled || (async () => {
            const { configLoader } = await import('../server/config/configLoader');
            return configLoader.getConfig().modules.vectorDB !== false;
        });
    }

    public isReady(): boolean { return this.isConnected; }
    public getConnectionState(): VectorConnection { return { ...this.state }; }

    private async newClient() {
        const { QdrantClient } = await import('@qdrant/js-client-rest');
        return new QdrantClient({ url: this.url, timeout: 1000, maxConnections: 2, checkCompatibility: false });
    }

    private async validate(client: any): Promise<void> {
        const collection = await client.getCollection(this.collectionName);
        const vectors = collection.config?.params?.vectors;
        if (!vectors || vectors.size !== QDRANT_CONFIG.embeddingSize || vectors.distance !== 'Cosine') {
            throw new Error('incompatible_collection');
        }
        if (collection.status === 'red' || collection.optimizer_status !== 'ok') throw new Error('collection_not_ready');
    }

    private unavailable(reason: string): VectorConnection {
        this.client = undefined;
        this.isConnected = false;
        this.state = { state: 'unavailable', reason };
        return this.getConnectionState();
    }

    public connect(): Promise<VectorConnection> {
        if (this.pendingConnection) return this.pendingConnection;
        this.pendingConnection = this.connectOnce().finally(() => { this.pendingConnection = null; });
        return this.pendingConnection;
    }

    private async connectOnce(): Promise<VectorConnection> {
        if (typeof window !== 'undefined') return this.unavailable('browser_only');
        try {
            if (!await this.enabled()) {
                this.client = undefined;
                this.isConnected = false;
                this.state = { state: 'disabled' };
                return this.getConnectionState();
            }
            const candidate = await this.newClient();
            await this.validate(candidate);
            this.client = candidate;
            this.isConnected = true;
            this.state = { state: 'ready' };
            return this.getConnectionState();
        } catch {
            // Do not log raw exceptions: URLs and provider payloads can contain secrets.
            return this.unavailable('connection_or_collection_check_failed');
        }
    }

    /** Observation only: no connect, collection creation, embedding or writes. */
    public async getHealth(): Promise<{ status: 'up' | 'down'; backend: 'qdrant' | 'disabled'; note?: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            if (!await this.enabled()) return { status: 'up', backend: 'disabled', note: 'Vector database disabled by config; no Qdrant availability claimed.' };
            await this.validate(await this.newClient());
            return { status: 'up', backend: 'qdrant', latencyMs: Date.now() - start };
        } catch {
            this.unavailable('connection_or_collection_check_failed');
            return { status: 'down', backend: 'qdrant', note: 'Qdrant or its expected collection is unavailable or incompatible', latencyMs: Date.now() - start };
        }
    }

    private async requireClient(): Promise<any> {
        const state = await this.connect();
        if (state.state !== 'ready' || !this.client) throw new VectorMemoryUnavailableError();
        return this.client;
    }

    private pointId(id: string): string {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
        const h = createHash('sha256').update(id).digest('hex');
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
    }

    private appPoint(point: any) {
        return { ...point, id: point.payload?._silhouetteId || point.id };
    }

    public async storeMemory(id: string, vector: number[], payload: any) {
        if (!vector || vector.length !== QDRANT_CONFIG.embeddingSize || !vector.every(Number.isFinite) || !vector.some(v => v !== 0)) throw new Error('Invalid Qdrant vector');
        await this.requireClient();

        // [ROBUSTNESS] Hard Guard: Never store empty/undefined thoughts.
        if (!payload || !payload.content || payload.content === 'undefined' || payload.content.trim().length === 0) {
            throw new Error('Empty Qdrant payload rejected; memory was not stored');
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
                            id: this.pointId(id),
                            vector,
                            payload: {
                                ...payload,
                                _silhouetteId: id,
                                ...timeGrid // Flatten grid into top-level payload for filtering
                            }
                        }
                    ]
                });
            });
        } catch (e) {
            this.unavailable('write_failed');
            throw new VectorMemoryUnavailableError();
        }
    }

    public async searchMemory(vector: number[], limit: number = 5, filter?: any) {
        await this.requireClient();
        try {
            const points = await this.retry(async () => {
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
                    with_payload: true,
                    params: { exact: true }
                });
            });
            return points.map((point: any) => this.appPoint(point));
        } catch (e) {
            this.unavailable('query_failed');
            throw new VectorMemoryUnavailableError();
        }
    }

    private async retry<T>(operation: () => Promise<T>, retries: number = 1, delay: number = 500): Promise<T> {
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
        await this.requireClient();
        try {
            return await this.retry(async () => {
                // Qdrant scroll order is point-id order, not recency. Keep a
                // bounded top-k across ALL pages instead of calling 200 arbitrary
                // points "the latest memories".
                let offset: string | number | undefined;
                let top: any[] = [];
                do {
                    const result = await this.client.scroll(this.collectionName, {
                        limit: 256, offset, with_payload: true, with_vector: false
                    });
                    top = top.concat(result.points).sort((a: any, b: any) =>
                        (b.payload?.timestamp || 0) - (a.payload?.timestamp || 0)
                    ).slice(0, limit);
                    offset = result.next_page_offset;
                } while (offset !== undefined && offset !== null);
                return top.map(point => this.appPoint(point));
            });
        } catch (e) {
            this.unavailable('query_failed');
            throw new VectorMemoryUnavailableError();
        }
    }

    public async getAllNodes(limit: number = 200): Promise<any[]> {
        if (!this.isReady()) return [];
        return this.getRecentMemories(limit);
    }

    public async getStats(): Promise<{ count: number; vectorsCount: number }> {
        if (!this.isConnected || !this.client) return { count: -1, vectorsCount: -1 };
        try {
            return await this.retry(async () => {
                const collectionInfo = await this.client.getCollection(this.collectionName);
                return {
                    count: collectionInfo.points_count || 0,
                    vectorsCount: collectionInfo.vectors_count || 0
                };
            });
        } catch (e) {
            this.unavailable('stats_failed');
            return { count: -1, vectorsCount: -1 };
        }
    }

    public async searchByContent(query: string, limit: number = 20, ownerId?: string): Promise<any[]> {
        await this.requireClient();
        try {
            // Scroll through recent memories and filter by content
            // NOTE: Ideally we should use Qdrant Full Text Search, but for now this is robust enough for <10k items
            return await this.retry(async () => {
                const matches: any[] = [];
                let offset: string | number | undefined;
                do {
                    const result = await this.client.scroll(this.collectionName, {
                        limit: 256, offset, with_payload: true, with_vector: false,
                        filter: ownerId ? { must: [{ key: 'ownerId', match: { value: ownerId } }] } : undefined
                    });
                    matches.push(...(result.points || []).filter((p: any) =>
                        lexicalMatches(p.payload?.content || '', query)
                        && !(p.payload?.tags || []).includes('HYPOTHESIS')));
                    offset = result.next_page_offset;
                } while (offset !== undefined && offset !== null && matches.length < limit);
                return matches.slice(0, limit).map((point: any) => this.appPoint(point));
            });

        } catch (e) {
            this.unavailable('query_failed');
            throw new VectorMemoryUnavailableError();
        }
    }

    // --- BISOCIATION SUPPORT (GOLDILOCKS ZONE) ---
    public async searchDistantMemories(vector: number[], minScore: number = 0.35, maxScore: number = 0.65, limit: number = 5): Promise<any[]> {
        await this.requireClient();
        try {
            // Qdrant doesn't support "Range Score" natively in simple search.
            // Strategy: Search slightly deeper (top 50) and filter client-side for the score range.
            return await this.retry(async () => {
                const results = await this.client.search(this.collectionName, {
                    vector,
                    limit: 50, // Get a larger candidate pool
                    with_payload: true,
                    params: { exact: true },
                    score_threshold: minScore // Minimum cutoff
                });

                // Filter for "Not Too Close" (Goldilocks)
                return results
                    .filter((res: any) => res.score <= maxScore)
                    .slice(0, limit).map((point: any) => this.appPoint(point));
            });
        } catch (e) {
            this.unavailable('query_failed');
            throw new VectorMemoryUnavailableError();
        }
    }

    // --- REAL BRAND TWIN METHODS ---

    public async getBrandTwin(brandId: string): Promise<BrandDigitalTwin | null> {
        await this.requireClient();
        try {
            // 1. Try direct retrieval if ID is UUID
            try {
                const points = await this.client.retrieve(this.collectionName, { ids: [this.pointId(brandId)] });
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
            this.unavailable('query_failed');
            throw new VectorMemoryUnavailableError();
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
        await this.requireClient();
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
            this.unavailable('write_failed');
            throw new VectorMemoryUnavailableError();
        }
    }
}

export const vectorMemory = new VectorMemoryService();
