import type { LanceDbService } from './lancedbService';
import type { MemoryNode } from '../types';
import { inScope, type EmbeddingIdentity, type MemoryScope } from './memoryRetrieval';

/** The real Continuum semantic retrieval path. No app bootstrap or model call.
 * Code has its own versioned Code RAG query; file markers are not experiences.
 * Qdrant payloads never bypass canonical freshness/identity/hydration here.
 */
export function isContextMemory(node: MemoryNode): boolean {
    return !['CODE_CHUNK', 'CODE_FILE_VERSION'].includes((node as any).type);
}
export async function queryCanonicalContext(canonical: LanceDbService, vector: number[], identity: EmbeddingIdentity,
    scope: MemoryScope, limit = 50): Promise<MemoryNode[]> {
    const filter = { ...(scope.ownerId ? { ownerId: [scope.ownerId, 'system'] } : {}),
        $excludeTypes: ['CODE_CHUNK', 'CODE_FILE_VERSION'], $excludeTags: ['HYPOTHESIS'],
        ...(scope.tag ? { $tagIncludes: scope.tag } : {}) };
    const points = await canonical.searchVectorPoints(vector, identity, limit, filter);
    return points.map(point => ({ ...point.payload, similarity: point.score }))
        .filter(node => isContextMemory(node) && inScope(node, scope));
}

export async function queryCanonicalTextContext(canonical: LanceDbService, query: string, scope: MemoryScope, limit = 50): Promise<MemoryNode[]> {
    return canonical.searchContextByContent(query, limit, scope);
}
