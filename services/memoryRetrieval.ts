import type { MemoryNode } from '../types';

export interface MemoryScope { ownerId?: string; tag?: string }
export interface EmbeddingIdentity { model: string; version: string; dimension: number }
export const LEGACY_EMBEDDING: EmbeddingIdentity = { model: 'legacy-unverified', version: '0', dimension: 768 };

export function validEmbedding(vector: number[], identity: EmbeddingIdentity): boolean {
    return !!identity.model && !!identity.version && Number.isInteger(identity.dimension) && identity.dimension > 0
        && vector.length === identity.dimension && vector.every(Number.isFinite)
        && vector.some(value => value !== 0);
}
export function inScope(node: MemoryNode, scope: MemoryScope): boolean {
    return (!scope.ownerId || !node.ownerId || node.ownerId === 'system' || node.ownerId === scope.ownerId)
        && (!scope.tag || node.tags.some(tag => tag.includes(scope.tag)))
        && !node.tags.includes('HYPOTHESIS');
}
export function scopeSql(scope: MemoryScope): string {
    const quote = (s: string) => s.replace(/'/g, "''");
    return scope.ownerId ? "(`ownerId` = '" + quote(scope.ownerId) + "' OR `ownerId` = 'system')" : 'true';
}
/** Reciprocal-rank fusion avoids comparing unrelated vector and lexical score scales. */
export function fuseMemories(lists: MemoryNode[][], query: string, tokenBudget = 4096): MemoryNode[] {
    const scores = new Map<string, { node: MemoryNode; score: number }>();
    for (const list of lists) {
        const seen = new Set<string>();
        list.forEach((node, index) => {
            if (seen.has(node.id)) return;
            seen.add(node.id);
            const entry = scores.get(node.id) || { node, score: 0 };
            if (node.timestamp > entry.node.timestamp) entry.node = node;
            entry.score += 1 / (60 + index + 1);
            scores.set(node.id, entry);
        });
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = [...scores.values()].sort((a, b) => {
        const exact = (node: MemoryNode) => terms.filter(t => node.content.toLowerCase().includes(t)).length / Math.max(1, terms.length);
        return (b.score + exact(b.node) / 100) - (a.score + exact(a.node) / 100) || a.node.id.localeCompare(b.node.id);
    });
    let used = 0;
    return ranked.flatMap(({ node }) => {
        const cost = Math.ceil(node.content.length / 3); // Conservative estimate; not a tokenizer claim.
        if (used + cost > tokenBudget) return [];
        used += cost;
        return [node];
    });
}
