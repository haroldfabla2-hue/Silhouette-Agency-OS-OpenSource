import { ResourceScope } from '../server/runtime/resourceScope';
import { acquireOwnedQdrant, type OwnedQdrantLease } from './runtime/ownedQdrant';
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
    private readonly operations = new ResourceScope('vector-memory');
    private currentLease: OwnedQdrantLease | null = null;
    private readonly retiredLeases = new Set<OwnedQdrantLease>();
    private activeOperations = 0;

    private operation<T>(name: string, work: () => Promise<T>): Promise<T> {
        return this.operations.run(name, async () => {
            this.activeOperations++;
            try { return await work(); }
            finally {
                this.activeOperations--;
                // Do not retire a client's dispatcher while an accepted method may
                // still retry a request using that client's local reference.
                if (this.activeOperations === 0) await this.drainRetired();
            }
        });
    }
    private async drainRetired(): Promise<void> {
        const leases = [...this.retiredLeases];
        this.retiredLeases.clear();
        const reports = await Promise.allSettled(leases.map(lease => Promise.resolve().then(() => lease.close())));
        for (const result of reports) {
            if (result.status === 'rejected') { this.operations.recordFailure('retired-qdrant-close-rejected', result.reason); continue; }
            const report = result.value;
            for (const diagnostic of report.diagnostics) this.operations.recordDiagnostic(`retired-qdrant:${diagnostic.resource}`, diagnostic.error, diagnostic.disposition, diagnostic.originalCapability);
            for (const failure of report.failures) this.operations.recordFailure(`retired-qdrant:${failure.resource}`, failure.error);
        }
        // Work receipt is already settled semantically. Cleanup is a SEPARATE
        // retained terminal receipt, never a rejection that invites duplicate writes.
    }
    private retireCurrent(): void {
        if (this.currentLease) this.retiredLeases.add(this.currentLease);
        this.currentLease = null;
        this.client = undefined;
    }
    public shutdown() { return this.operations.close(); }
    public getLifecycleDiagnostics() { return this.operations.getDiagnostics(); }
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

    private newClient(): Promise<OwnedQdrantLease> {
        return acquireOwnedQdrant(this.operations, { url: this.url, timeout: 1000, maxConnections: 2, checkCompatibility: false });
    }

    // Preserve the existing createCollection/storeMemory 768/Cosine contract.
    // The legacy constants embeddingSize=384 mismatch is not relabeled here.
    private async validate(client: any): Promise<void> {
        const collection = await client.getCollection(this.collectionName);
        const vectors = collection.config?.params?.vectors;
        if (!vectors || vectors.size !== 768 || vectors.distance !== 'Cosine') {
            throw new Error('incompatible_collection');
        }
        if (collection.status === 'red' || collection.optimizer_status !== 'ok') throw new Error('collection_not_ready');
    }

    private unavailable(reason: string): VectorConnection {
        this.retireCurrent();
        this.isConnected = false;
        this.state = { state: 'unavailable', reason };
        return this.getConnectionState();
    }

    public connect(): Promise<VectorConnection> {
        if (this.pendingConnection) return this.pendingConnection;
        this.pendingConnection = this.operation('connect', () => this.connectOnce()).finally(() => { this.pendingConnection = null; });
        return this.pendingConnection;
    }

    private async connectOnce(): Promise<VectorConnection> {
        if (typeof window !== 'undefined') return this.unavailable('browser_only');
        let candidate: OwnedQdrantLease | null = null;
        try {
            if (!await this.enabled()) {
                this.retireCurrent();
                this.isConnected = false;
                this.state = { state: 'disabled' };
                return this.getConnectionState();
            }
            candidate = await this.newClient();
            await this.validate(candidate.client);
            this.operations.assertAccepting();
            this.retireCurrent();
            this.currentLease = candidate;
            this.client = candidate.client;
            candidate = null;
            this.isConnected = true;
            this.state = { state: 'ready' };
            return this.getConnectionState();
        } catch (error) {
            this.operations.recordDiagnostic('qdrant-connect', error, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
            // Cleanup is owned before validation; failed candidates are not discarded.
            if (candidate) this.retiredLeases.add(candidate);
            // Do not log raw exceptions: URLs and provider payloads can contain secrets.
            return this.unavailable('connection_or_collection_check_failed');
        }
    }

    /** Observation only: no connect, collection creation, embedding or writes. */
    public async getHealth(): Promise<{ status: 'up' | 'down'; backend: 'qdrant' | 'disabled'; note?: string; latencyMs?: number }> {
        return this.operation('getHealth', async () => {
        const start = Date.now();
        let probe: OwnedQdrantLease | null = null;
        try {
            if (!await this.enabled()) return { status: 'up', backend: 'disabled', note: 'Vector database disabled by config; no Qdrant availability claimed.' };
            probe = await this.newClient();
            await this.validate(probe.client);
            return { status: 'up', backend: 'qdrant', latencyMs: Date.now() - start };
        } catch (error) {
            this.operations.recordDiagnostic('qdrant-health', error, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
            this.unavailable('connection_or_collection_check_failed');
            return { status: 'down', backend: 'qdrant', note: 'Qdrant or its expected collection is unavailable or incompatible', latencyMs: Date.now() - start };
        } finally {
            if (probe) this.retiredLeases.add(probe);
        }
    
        });
    }

    private async requireClient(): Promise<any> {
        const state = await this.connect();
        if (state.state !== 'ready' || !this.client) throw new VectorMemoryUnavailableError();
        return this.client;
    }

    public async storeMemory(id: string, vector: number[], payload: any) {
        return this.operation('storeMemory', async () => {
        if (!vector || vector.length !== 768 || !vector.every(Number.isFinite) || !vector.some(v => v !== 0)) throw new Error('Invalid Qdrant vector');
        const client = await this.requireClient();

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
                await client.upsert(this.collectionName, {
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
            this.unavailable('operation_failed');
            throw new VectorMemoryUnavailableError();
        }
    
        });
    }

    public async searchMemory(vector: number[], limit: number = 5, filter?: any) {
        return this.operation('searchMemory', async () => {
        const client = await this.requireClient();
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

                return await client.search(this.collectionName, {
                    vector,
                    limit,
                    filter: qdrantFilter,
                    with_payload: true
                });
            });
        } catch (e) {
            this.unavailable('operation_failed');
            throw new VectorMemoryUnavailableError();
        }
    
        });
    }

    private async retry<T>(operation: () => Promise<T>, retries: number = 5, delay: number = 500): Promise<T> {
        try {
            return await operation();
        } catch (e: any) {
            const receipt = this.operations.recordDiagnostic('qdrant-retry-attempt', e, 'OPERATION_REJECTED', 'UNAVAILABLE');
            if (retries > 0) {
                // Exponential Backoff with Cap (Max 5s)
                const nextDelay = Math.min(delay * 2, 5000);
                // console.warn(`[VECTOR_MEM] Operation failed, retrying in ${delay}ms... (${retries} left)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                const result = await this.retry(operation, retries - 1, nextDelay);
                receipt.disposition = 'RECOVERED_RETRY';
                receipt.originalCapability = 'RESTORED';
                return result;
            }
            this.unavailable('operation_failed');
            throw e;
        }
    }

    public async getRecentMemories(limit: number = 20): Promise<any[]> {
        return this.operation('getRecentMemories', async () => {
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
    
        });
    }

    public async getAllNodes(limit: number = 200): Promise<any[]> {
        return this.operation('getAllNodes', async () => {
        if (!this.isConnected || !this.client) return [];
        return this.getRecentMemories(limit);
    
        });
    }

    public async getStats(): Promise<{ count: number; vectorsCount: number }> {
        return this.operation('getStats', async () => {
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
    
        });
    }

    public async searchByContent(query: string, limit: number = 20, ownerId?: string): Promise<any[]> {
        return this.operation('searchByContent', async () => {
        if (!this.isConnected || !this.client) return [];
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
                return matches.slice(0, limit);
            });

        } catch (e) {
            console.error("Failed to search vector memory by content", e);
            return [];
        }
    
        });
    }

    // --- BISOCIATION SUPPORT (GOLDILOCKS ZONE) ---
    public async searchDistantMemories(vector: number[], minScore: number = 0.35, maxScore: number = 0.65, limit: number = 5): Promise<any[]> {
        return this.operation('searchDistantMemories', async () => {
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
    
        });
    }

    // --- REAL BRAND TWIN METHODS ---

    public async getBrandTwin(brandId: string): Promise<BrandDigitalTwin | null> {
        return this.operation('getBrandTwin', async () => {
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
    
        });
    }

    public async queryBrandRules(brandId: string, query: string): Promise<string> {
        return this.operation('queryBrandRules', async () => {
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
    
        });
    }

    public async updateManifesto(brandId: string, feedback: string): Promise<boolean> {
        return this.operation('updateManifesto', async () => {
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
    
        });
    }
}

export const vectorMemory = new VectorMemoryService();
