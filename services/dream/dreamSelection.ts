/**
 * DREAM SELECTION (etapa 3 B/C) - measured relevance from the CANONICAL
 * vector store (LanceDB per-identity projections), layered on top of the
 * existing stochastic exploration, never replacing it:
 *
 * - Seeds/anchors are still drawn randomly by the caller (productive
 *   exploration, preserved). This module only changes HOW partners/zone
 *   members are chosen among candidates: by MEASURED cosine similarity
 *   over stored vectors instead of proxies.
 * - Coverage is explicit: only nodes carrying a stored vector with a known,
 *   non-legacy identity (embeddingIdentity + validEmbedding). Nodes without
 *   coverage stay fully eligible through the caller's existing random /
 *   fallback path - nothing is dropped, capped or silently skipped.
 * - Zero new external calls: only STORED vectors are read. Identities are
 *   never mixed (same model+version+dimension only) and unknown/legacy
 *   identities are excluded rather than guessed.
 * - Retrieval is top-k approximate (ANN when the native engine serves it,
 *   exact partitioned scan otherwise; lancedbService normalizes both to
 *   cosine SIMILARITY). k is a retrieval bound, not a data cap - never
 *   presented as full recall.
 * - Band semantics stay per path (contracts are NOT unified):
 *   CONSTELLATION zone 0.30-0.85, serendipity Goldilocks 0.5-0.85,
 *   PARADOX wants LOW similarity (a different objective, not Goldilocks).
 */
import { MemoryNode } from '../../types';
import { validEmbedding, LEGACY_EMBEDDING, type EmbeddingIdentity } from '../memoryRetrieval';
import { cosineSimilarity } from '../vectorScan';
import { lancedbService } from '../lancedbService';

export interface VectorCoverage {
    ok: boolean;
    identity?: EmbeddingIdentity;
    vector?: number[];
}

/** Usable stored-vector coverage: known non-legacy identity + valid vector. */
export function storedVectorCoverage(node: MemoryNode): VectorCoverage {
    const identity = node.embeddingIdentity as EmbeddingIdentity | undefined;
    const raw = node.embeddingVector as ArrayLike<number> | undefined;
    if (!identity || !raw) return { ok: false };
    if (identity.model === LEGACY_EMBEDDING.model) return { ok: false }; // unknown legacy: never guessed
    const vector = Array.from(raw as any) as number[];
    if (!validEmbedding(vector, identity)) return { ok: false };
    return { ok: true, identity, vector };
}

function sameIdentity(a: EmbeddingIdentity, b: EmbeddingIdentity): boolean {
    return a.model === b.model && a.version === b.version && a.dimension === b.dimension;
}

/**
 * PARADOX anti-seed: among the caller's randomly drawn candidates, pick the
 * MEASURED least-similar one with same-identity coverage. Returns
 * measured=false when neither seed nor any drawn candidate has coverage -
 * the caller then keeps its existing random pick (declared, no degradation).
 */
export function pickLeastSimilarMeasured(
    seed: MemoryNode,
    drawn: MemoryNode[]
): { pick: MemoryNode | null; measured: boolean; similarity?: number } {
    const cov = storedVectorCoverage(seed);
    if (!cov.ok) return { pick: null, measured: false };
    let best: MemoryNode | null = null;
    let bestSim = Infinity;
    for (const candidate of drawn) {
        if (candidate.id === seed.id) continue;
        const cc = storedVectorCoverage(candidate);
        if (!cc.ok || !sameIdentity(cov.identity!, cc.identity!)) continue;
        const sim = cosineSimilarity(cov.vector!, cc.vector!);
        if (sim === null) continue;
        if (sim < bestSim) { bestSim = sim; best = candidate; }
    }
    return best
        ? { pick: best, measured: true, similarity: bestSim }
        : { pick: null, measured: false };
}

/**
 * Zone members (CONSTELLATION / serendipity Goldilocks) from the canonical
 * store, filtered to the path's own SIMILARITY band. Ranked best-first, so
 * members[0] preserves the legacy "best fit within filter" semantics.
 * source 'none' = seed has no usable stored vector: the caller's legacy
 * path (external embed + optional Qdrant mirror + fallbacks) runs unchanged.
 */
export async function zoneMembers(
    seed: MemoryNode,
    band: { min: number; max: number },
    k: number,
    retrievalLimit = 50
): Promise<{ members: (MemoryNode & { similarity?: number })[]; source: 'canonical' | 'none' }> {
    const cov = storedVectorCoverage(seed);
    if (!cov.ok) return { members: [], source: 'none' };
    const ranked = await lancedbService.search(cov.vector!, retrievalLimit, undefined, cov.identity, { withScores: true });
    const members = ranked
        .filter(n => n.id !== seed.id
            && typeof n.similarity === 'number'
            && n.similarity >= band.min
            && n.similarity <= band.max)
        .slice(0, k);
    return { members, source: 'canonical' };
}
