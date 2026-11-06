import { QDRANT_CONFIG } from '../constants';
import { BrandDigitalTwin, MemoryNode, MemoryTier } from '../types';
import type { IDatabaseAdapter, MemoryNodeCounts } from './database/databaseAdapter';

type LegacyVectorResult = {
    id: string;
    payload: Record<string, any>;
    content?: string;
    timestamp?: number;
    tier?: MemoryTier;
    importance?: number;
    tags?: string[];
    accessCount?: number;
    lastAccess?: number;
    source?: string;
    category?: string;
    score?: number;
};

class VectorMemoryService {
    private client: any;
    private adapter: IDatabaseAdapter | null = null;
    private isConnected = false;
    private collectionName = QDRANT_CONFIG.collectionName;
    private connecting = false;
    private backend: 'pgvector' | 'qdrant' | null = null;

    public isReady(): boolean {
        return this.isConnected;
    }

    public getBackend(): 'pgvector' | 'qdrant' | null {
        return this.backend;
    }

    private shouldUsePostgres(): boolean {
        return !!process.env.DATABASE_URL;
    }

    private async ensureConnected(): Promise<boolean> {
        if (!this.isConnected) {
            await this.connect();
        }
        return this.isConnected;
    }

    public async connect() {
        if (typeof window !== 'undefined') return;
        if (this.isConnected || this.connecting) return;

        this.connecting = true;
        try {
            try {
                const { configLoader } = await import('../server/config/configLoader');
                const config = configLoader.getConfig();
                if (config.modules.vectorDB === false) {
                    console.log('[VECTOR_MEM] VectorDB module disabled in config (Lite Mode). Using LanceDB only.');
                    return;
                }
            } catch {
                // Config not available yet, proceed with default behavior.
            }

            if (this.shouldUsePostgres()) {
                const { getDatabaseAdapter } = await import('./database/adapterFactory');
                this.adapter = await getDatabaseAdapter();
                this.backend = 'pgvector';
                this.isConnected = true;
                console.log('[VECTOR_MEM] Connected to PostgreSQL + pgvector');
                return;
            }

            await this.connectQdrant();
        } catch (e) {
            console.error('[VECTOR_MEM] Failed to initialize vector backend:', e);
        } finally {
            this.connecting = false;
        }
    }

    private async connectQdrant() {
        if (this.client) return;

        const { QdrantClient } = await import('@qdrant/js-client-rest');

        console.log(`[VECTOR_MEM] Connecting to Qdrant at ${QDRANT_CONFIG.url} (Collection: ${this.collectionName})`);
        this.client = new QdrantClient({
            url: QDRANT_CONFIG.url,
            checkCompatibility: false
        });

        const collections = await this.client.getCollections();
        console.log('✅ Qdrant Connected (Eternal Memory Active)', collections);
        this.backend = 'qdrant';
        this.isConnected = true;

        await this.ensureCollection();
    }

    private async ensureCollection() {
        if (!this.isConnected || !this.client) return;
        try {
            const result = await this.client.getCollections();
            const exists = result.collections.some((c: any) => c.name === this.collectionName);

            if (!exists) {
                console.log(`[QDRANT] Creating collection: ${this.collectionName}`);
                await this.client.createCollection(this.collectionName, {
                    vectors: {
                        size: 768,
                        distance: 'Cosine',
                    },
                });
            }
        } catch (e) {
            console.error('Failed to ensure Qdrant collection', e);
        }
    }

    private escapeSqlValue(value: unknown): string {
        return String(value).replace(/'/g, "''");
    }

    private buildSqlFilter(filter?: Record<string, unknown>): string | undefined {
        if (!filter) return undefined;

        const topLevelColumns = new Set(['id', 'content', 'tier', 'source', 'category']);
        const clauses: string[] = [];

        for (const [rawKey, rawValue] of Object.entries(filter)) {
            if (rawValue === undefined || rawValue === null) continue;

            const key = rawKey.replace(/[^a-zA-Z0-9_]/g, '');
            if (!key) continue;

            const value = this.escapeSqlValue(rawValue);
            if (topLevelColumns.has(key)) {
                clauses.push(`${key} = '${value}'`);
            } else {
                clauses.push(`metadata->>'${key}' = '${value}'`);
            }
        }

        return clauses.length > 0 ? clauses.join(' AND ') : undefined;
    }

    private payloadToMemoryNode(id: string, payload: Record<string, any>): MemoryNode {
        const timestamp = payload.timestamp || Date.now();
        return {
            id,
            content: payload.content || '',
            originalContent: payload.originalContent,
            timestamp,
            tier: payload.tier || MemoryTier.DEEP,
            importance: payload.importance ?? 0.5,
            tags: payload.tags || [],
            accessCount: payload.accessCount || 0,
            lastAccess: payload.lastAccess || timestamp,
            decayHealth: payload.decayHealth,
            compressionLevel: payload.compressionLevel,
            ownerId: payload.ownerId,
            nestingLevel: payload.nestingLevel,
            stabilityScore: payload.stabilityScore,
            raptorLevel: payload.raptorLevel,
            timeGrid: payload.timeGrid,
            ...(payload.source ? { source: payload.source } : {}),
            ...(payload.category || payload.type ? { category: payload.category || payload.type } : {}),
            metadata: payload
        } as MemoryNode;
    }

    private buildLegacyResult(id: string, payload: Record<string, any>, score?: number): LegacyVectorResult {
        const normalizedPayload: Record<string, any> = {
            ...payload,
            id: payload.id || id,
            content: payload.content || '',
            timestamp: payload.timestamp || Date.now(),
            tier: payload.tier || MemoryTier.DEEP,
            importance: payload.importance ?? 0.5,
            tags: payload.tags || [],
            accessCount: payload.accessCount ?? 0,
            lastAccess: payload.lastAccess ?? payload.timestamp ?? Date.now()
        };

        return {
            id,
            payload: normalizedPayload,
            content: normalizedPayload.content,
            timestamp: normalizedPayload.timestamp,
            tier: normalizedPayload.tier,
            importance: normalizedPayload.importance,
            tags: normalizedPayload.tags,
            accessCount: normalizedPayload.accessCount,
            lastAccess: normalizedPayload.lastAccess,
            ...(normalizedPayload.source ? { source: normalizedPayload.source } : {}),
            ...(normalizedPayload.category || normalizedPayload.type ? { category: normalizedPayload.category || normalizedPayload.type } : {}),
            ...(typeof score === 'number' ? { score } : {})
        };
    }

    private adapterNodeToLegacyResult(node: any): LegacyVectorResult {
        const metadata = node?.metadata || {};
        return this.buildLegacyResult(node.id, {
            ...metadata,
            id: metadata.id || node.id,
            content: node.content || metadata.content || '',
            timestamp: node.timestamp || metadata.timestamp || Date.now(),
            tier: node.tier || metadata.tier || MemoryTier.DEEP,
            importance: node.importance ?? metadata.importance ?? 0.5,
            tags: node.tags || metadata.tags || [],
            accessCount: node.accessCount ?? metadata.accessCount ?? 0,
            lastAccess: node.lastAccess ?? metadata.lastAccess ?? Date.now(),
            ...(node.source || metadata.source ? { source: node.source || metadata.source } : {}),
            ...(node.category || metadata.category || metadata.type ? { category: node.category || metadata.category || metadata.type } : {})
        }, typeof node.similarity === 'number' ? node.similarity : undefined);
    }

    private normalizeQdrantResult(point: any): LegacyVectorResult {
        return this.buildLegacyResult(String(point.id), point.payload || {}, typeof point.score === 'number' ? point.score : undefined);
    }

    private mapAdapterResults(nodes: any[]): LegacyVectorResult[] {
        return nodes.map(node => this.adapterNodeToLegacyResult(node));
    }

    private async findBrandPoint(brandId: string): Promise<LegacyVectorResult | null> {
        const points = await this.getAllNodes(1000);
        return points.find((point: any) => point.id === brandId || point.payload?.id === brandId) || null;
    }

    public async storeMemory(id: string, vector: number[], payload: any) {
        if (!(await this.ensureConnected())) return;

        if (!payload || !payload.content || payload.content === 'undefined' || payload.content.trim().length === 0) {
            console.warn(`[VECTOR_MEM] BLOCKED Corrupt Node Write (Empty Content). ID: ${id}`);
            return;
        }

        if (this.shouldUsePostgres()) {
            try {
                const node = this.payloadToMemoryNode(id, payload);
                await this.adapter!.storeVector(node, vector);
            } catch (e) {
                console.error('Failed to store vector memory in pgvector', e);
            }
            return;
        }

        try {
            const date = new Date(payload.timestamp || Date.now());
            const timeGrid = {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
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
                                ...timeGrid
                            }
                        }
                    ]
                });
            });
        } catch (e) {
            console.error('Failed to store vector memory', e);
        }
    }

    public async searchMemory(vector: number[], limit: number = 5, filter?: any): Promise<LegacyVectorResult[]> {
        if (!(await this.ensureConnected())) return [];

        if (this.shouldUsePostgres()) {
            try {
                const sqlFilter = this.buildSqlFilter(filter);
                const candidateLimit = sqlFilter ? Math.max(limit * 5, 25) : limit;
                const results = await this.adapter!.searchVectors(vector, candidateLimit, sqlFilter);
                return this.mapAdapterResults(results).slice(0, limit);
            } catch (e) {
                console.error('Failed to search pgvector memory', e);
                return [];
            }
        }

        try {
            return await this.retry(async () => {
                let qdrantFilter = undefined;

                if (filter) {
                    const must = Object.entries(filter).map(([key, value]) => ({
                        key,
                        match: { value }
                    }));
                    if (must.length > 0) {
                        qdrantFilter = { must };
                    }
                }

                const results = await this.client.search(this.collectionName, {
                    vector,
                    limit,
                    filter: qdrantFilter,
                    with_payload: true
                });
                return results.map((result: any) => this.normalizeQdrantResult(result));
            });
        } catch (e) {
            console.error('Failed to search vector memory', e);
            return [];
        }
    }

    private async retry<T>(operation: () => Promise<T>, retries: number = 5, delay: number = 500): Promise<T> {
        try {
            return await operation();
        } catch (e: any) {
            if (retries > 0) {
                const nextDelay = Math.min(delay * 2, 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.retry(operation, retries - 1, nextDelay);
            }
            throw e;
        }
    }

    public async getRecentMemories(limit: number = 20): Promise<LegacyVectorResult[]> {
        return this.getAllNodes(limit);
    }

    public async getAllNodes(limit: number = 200): Promise<LegacyVectorResult[]> {
        if (!(await this.ensureConnected())) return [];

        if (this.shouldUsePostgres()) {
            try {
                const nodes = await this.adapter!.getRecentNodes(limit);
                return this.mapAdapterResults(nodes)
                    .sort((a, b) => (b.payload?.timestamp || 0) - (a.payload?.timestamp || 0));
            } catch (e) {
                console.error('Failed to read pgvector nodes', e);
                return [];
            }
        }

        try {
            return await this.retry(async () => {
                const fetchSize = Math.max(limit * 5, 200);
                const result = await this.client.scroll(this.collectionName, {
                    limit: fetchSize,
                    with_payload: true,
                    with_vector: false
                });

                return result.points
                    .sort((a: any, b: any) => (b.payload?.timestamp || 0) - (a.payload?.timestamp || 0))
                    .slice(0, limit)
                    .map((point: any) => this.normalizeQdrantResult(point));
            });
        } catch {
            return [];
        }
    }

    public async getNodeCounts(): Promise<MemoryNodeCounts> {
        if (!(await this.ensureConnected())) return { total: 0 };

        if (this.shouldUsePostgres()) {
            try {
                return await this.adapter!.getNodeCounts();
            } catch (e) {
                console.error('Failed to get pgvector node counts', e);
                return { total: -1 };
            }
        }

        try {
            return await this.retry(async () => {
                const collectionInfo = await this.client.getCollection(this.collectionName);
                const count = collectionInfo.points_count || 0;
                return {
                    [MemoryTier.DEEP]: count,
                    total: count
                };
            });
        } catch (e) {
            console.error('Failed to get vector node counts', e);
            return { total: -1 };
        }
    }

    public async getStats(): Promise<{ count: number; vectorsCount: number }> {
        if (!(await this.ensureConnected())) return { count: 0, vectorsCount: 0 };

        try {
            const counts = await this.getNodeCounts();
            const tierCounts = Object.entries(counts)
                .filter(([key]) => key !== 'total')
                .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
            const count = (counts[MemoryTier.DEEP] ?? tierCounts ?? counts.total ?? 0) as number;
            return {
                count,
                vectorsCount: counts.total || count
            };
        } catch (e) {
            console.error('Failed to get vector stats', e);
            return { count: -1, vectorsCount: -1 };
        }
    }

    public async searchByContent(query: string, limit: number = 20): Promise<LegacyVectorResult[]> {
        if (!(await this.ensureConnected())) return [];

        if (this.shouldUsePostgres()) {
            try {
                const nodes = await this.adapter!.searchByContent(query, limit);
                return this.mapAdapterResults(nodes);
            } catch (e) {
                console.error('Failed to search pgvector memory by content', e);
                return [];
            }
        }

        try {
            return await this.retry(async () => {
                const result = await this.client.scroll(this.collectionName, {
                    limit: 500,
                    with_payload: true,
                    with_vector: false
                });

                const queryLower = query.toLowerCase();
                const points = result.points || [];

                return points
                    .filter((p: any) => (p.payload?.content || '').toLowerCase().includes(queryLower))
                    .slice(0, limit)
                    .map((point: any) => this.normalizeQdrantResult(point));
            });
        } catch (e) {
            console.error('Failed to search vector memory by content', e);
            return [];
        }
    }

    public async searchDistantMemories(vector: number[], minScore: number = 0.35, maxScore: number = 0.65, limit: number = 5): Promise<LegacyVectorResult[]> {
        if (!(await this.ensureConnected())) return [];

        if (this.shouldUsePostgres()) {
            try {
                const results = await this.searchMemory(vector, 50);
                return results
                    .filter((res: any) => typeof res.score === 'number' && res.score >= minScore && res.score <= maxScore)
                    .slice(0, limit);
            } catch (e) {
                console.error('Bisociation Search Failed:', e);
                return [];
            }
        }

        try {
            return await this.retry(async () => {
                const results = await this.client.search(this.collectionName, {
                    vector,
                    limit: 50,
                    with_payload: true,
                    score_threshold: minScore
                });

                return results
                    .filter((res: any) => res.score <= maxScore)
                    .slice(0, limit)
                    .map((result: any) => this.normalizeQdrantResult(result));
            });
        } catch (e) {
            console.error('Bisociation Search Failed:', e);
            return [];
        }
    }

    public async getBrandTwin(brandId: string): Promise<BrandDigitalTwin | null> {
        if (!(await this.ensureConnected())) return null;

        if (this.shouldUsePostgres()) {
            const point = await this.findBrandPoint(brandId);
            return point ? point.payload as BrandDigitalTwin : null;
        }

        try {
            try {
                const points = await this.client.retrieve(this.collectionName, { ids: [brandId] });
                if (points.length > 0) return points[0].payload as BrandDigitalTwin;
            } catch {
                // Ignore invalid UUID error and continue with payload lookup.
            }

            const result = await this.client.scroll(this.collectionName, {
                filter: {
                    must: [{ key: 'id', match: { value: brandId } }]
                },
                limit: 1,
                with_payload: true
            });

            if (result.points.length > 0) {
                return result.points[0].payload as BrandDigitalTwin;
            }
            return null;
        } catch (e) {
            console.error('Failed to get brand twin', e);
            return null;
        }
    }

    public async queryBrandRules(brandId: string, _query: string): Promise<string> {
        const brand = await this.getBrandTwin(brandId);
        if (!brand) return 'Brand rules not found.';

        const rules = [
            `Tone of Voice: ${brand.manifesto.toneOfVoice.join(', ')}`,
            `Typography Rules: ${brand.designSystem.typography.usageRules}`,
            `Logo Clearance: ${brand.designSystem.logoRules.clearance}`
        ];
        return rules.join('\n');
    }

    public async updateManifesto(brandId: string, feedback: string): Promise<boolean> {
        if (!(await this.ensureConnected())) return false;

        try {
            const point = await this.findBrandPoint(brandId);
            const brand = point?.payload as BrandDigitalTwin | undefined;
            if (!brand || !point) return false;

            const updatedBrand = {
                ...brand,
                lastUpdated: Date.now(),
                evolutionLog: [...(brand.evolutionLog || []), { date: Date.now(), feedback }]
            };

            if (this.shouldUsePostgres()) {
                const node = this.payloadToMemoryNode(String(point.id), updatedBrand);
                await this.adapter!.storeVector(node);
                return true;
            }

            await this.client.setPayload(this.collectionName, {
                payload: updatedBrand,
                points: [point.id]
            });
            return true;
        } catch (e) {
            console.error('Failed to update manifesto', e);
            return false;
        }
    }
}

export const vectorMemory = new VectorMemoryService();
