import { lancedbService, type LanceDbService } from './lancedbService';
import { vectorMemory } from './vectorMemoryService';
import { MemoryTier, type BrandDigitalTwin, type MemoryNode } from '../types';
import { validEmbedding, type EmbeddingIdentity } from './memoryRetrieval';

/** Application contract: canonical data and identity-partitioned retrieval in
 * LanceDB. Qdrant is a replayable projection, never the only acknowledged copy.
 * Existing Qdrant-only data is not deleted or silently relabeled into a model.
 */
export class UnifiedVectorMemory {
    constructor(private readonly canonical: LanceDbService = lancedbService) {}
    async storeMemory(id: string, vector: number[], payload: any, identity?: EmbeddingIdentity): Promise<void> {
        if (!identity || !validEmbedding(vector, identity)) throw new Error('Verified embedding identity required');
        const node: MemoryNode = {
            ...payload, id, content: payload.content, tier: MemoryTier.DEEP,
            tags: payload.tags || [], timestamp: payload.timestamp || Date.now(),
            importance: payload.importance ?? 0.5, decayHealth: payload.decayHealth ?? 100,
            accessCount: payload.accessCount ?? 0, lastAccess: payload.lastAccess || Date.now(),
            compressionLevel: payload.compressionLevel ?? 0, embeddingIdentity: identity
        };
        await this.canonical.store(node, vector);
    }
    async searchMemory(vector: number[], limit = 5, filter?: Record<string, any>, identity?: EmbeddingIdentity) {
        if (!identity || !validEmbedding(vector, identity)) throw new Error('Verified query identity required');
        return this.canonical.searchVectorPoints(vector, identity, limit, filter);
    }
    async searchDistantMemories(vector: number[], minScore = 0.35, maxScore = 0.65, limit = 5, identity?: EmbeddingIdentity) {
        if (!identity || !validEmbedding(vector, identity)) throw new Error('Verified query identity required');
        return this.canonical.searchVectorPoints(vector, identity, limit, undefined, { min: minScore, max: maxScore });
    }
    async commitCodeVersion(fileId: string, hash: string): Promise<void> {
        // One canonical commit marker switches all chunks together. Previous
        // immutable versions stay in history and are excluded from active RAG.
        await this.canonical.store({ id: `code_file_version:${fileId}`, content: `Code version ${hash}`,
            fileId, hash, type: 'CODE_FILE_VERSION', tier: MemoryTier.DEEP, tags: ['CODE_FILE_VERSION'],
            timestamp: Date.now(), importance: 0.5, decayHealth: 100,
            accessCount: 0, lastAccess: Date.now(), compressionLevel: 0 } as any);
    }
    async getBrandTwin(brandId: string): Promise<BrandDigitalTwin | null> {
        const stored = await this.canonical.getNodeById(brandId);
        if (stored) return stored as unknown as BrandDigitalTwin;
        // Read-only compatibility for existing Qdrant-only Brand Twins.
        // A dependency outage remains an error, not an invented missing brand.
        return vectorMemory.getBrandTwin(brandId);
    }
    async queryBrandRules(brandId: string, _query: string): Promise<string> {
        const brand = await this.getBrandTwin(brandId);
        if (!brand) return 'Brand rules not found.';
        return [`Tone of Voice: ${brand.manifesto.toneOfVoice.join(', ')}`,
            `Typography Rules: ${brand.designSystem.typography.usageRules}`,
            `Logo Clearance: ${brand.designSystem.logoRules.clearance}`].join('\n');
    }
    async updateManifesto(brandId: string, feedback: string): Promise<boolean> {
        const brand = await this.getBrandTwin(brandId);
        if (!brand) return false;
        const current = await this.canonical.getNodeById(brandId);
        const updated = { ...brand, lastUpdated: Date.now(),
            evolutionLog: [...(brand.evolutionLog || []), { date: Date.now(), feedback }] };
        const node = { ...current, ...updated, id: brandId,
            content: current?.content || `Brand Twin ${brandId}`,
            tier: MemoryTier.DEEP, tags: current?.tags || ['BRAND_TWIN'],
            timestamp: Date.now(), importance: current?.importance ?? 0.5,
            decayHealth: 100, accessCount: 0, lastAccess: Date.now(), compressionLevel: 0 } as unknown as MemoryNode;
        // Payload-only update, no new invented embedding and no inference.
        await this.canonical.store(node);
        return true;
    }
}
export const unifiedVectorMemory = new UnifiedVectorMemory();
