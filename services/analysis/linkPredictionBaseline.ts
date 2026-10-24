/** Offline, provider-free topology measurement. No runtime services imported. */
import { createHash } from 'node:crypto';

export interface GraphEdge { source: string; target: string }
export type Baseline = 'commonNeighbors' | 'jaccard' | 'adamicAdar';
const algorithms: Baseline[] = ['commonNeighbors', 'jaccard', 'adamicAdar'];
const pairKey = (a: string, b: string): string => JSON.stringify(a < b ? [a, b] : [b, a]);
const hash = (seed: string, key: string): string => createHash('sha256').update(JSON.stringify([seed, key])).digest('hex');

export function normalizeEdges(input: GraphEdge[]): GraphEdge[] {
    const pairs = new Map<string, GraphEdge>();
    for (const edge of input) {
        if (!edge || typeof edge.source !== 'string' || !edge.source.trim() || typeof edge.target !== 'string' || !edge.target.trim()) {
            throw new Error('Every edge needs nonempty string source and target');
        }
        if (edge.source === edge.target) continue;
        const [source, target] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
        pairs.set(pairKey(source, target), { source, target });
    }
    return [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, edge]) => edge);
}

export function neighborScores(a: Set<string>, b: Set<string>, degrees: Map<string, number>): Record<Baseline, number> {
    const common = [...a].filter(n => b.has(n));
    const union = a.size + b.size - common.length;
    return {
        commonNeighbors: common.length,
        jaccard: union ? common.length / union : 0,
        adamicAdar: common.reduce((sum, n) => {
            const degree = degrees.get(n) ?? 0;
            return sum + (degree > 1 ? 1 / Math.log(degree) : 0);
        }, 0),
    };
}

export function measureLinkBaselines(input: GraphEdge[], options: {
    seed?: string; holdoutFraction?: number; topK?: number; maxPairs?: number;
} = {}) {
    const { seed = 'silhouette-topology-v1', holdoutFraction = 0.2, topK = 10, maxPairs = 100_000 } = options;
    if (!(holdoutFraction > 0 && holdoutFraction < 1)) throw new Error('holdoutFraction must be between 0 and 1');
    if (!Number.isSafeInteger(topK) || topK < 1) throw new Error('topK must be a positive integer');
    if (!Number.isSafeInteger(maxPairs) || maxPairs < 1) throw new Error('maxPairs must be a positive integer');
    const edges = normalizeEdges(input);
    const nodes = [...new Set(edges.flatMap(e => [e.source, e.target]))].sort();
    const totalPairs = nodes.length * (nodes.length - 1) / 2;
    // Fail before allocating the quadratic candidate set, never sample silently.
    if (totalPairs > maxPairs) throw new Error(`Pair budget exceeded: ${totalPairs} > ${maxPairs}`);
    const metadata = {
        kind: 'offline-undirected-edge-reconstruction', seed, holdoutFraction, topK,
        inputEdges: input.length, uniqueUndirectedEdges: edges.length, nodes: nodes.length,
        graphSemantics: 'direction/type collapsed; self loops removed; transductive known-node universe',
        groundTruth: 'held-out observed edges only; unobserved pairs are UNKNOWN, not negative labels',
    };
    if (edges.length < 2) return { ...metadata, status: 'insufficient-data', trainEdges: edges.length, heldOutEdges: 0, metrics: null };
    const ordered = [...edges].sort((a, b) => {
        const ka = pairKey(a.source, a.target), kb = pairKey(b.source, b.target);
        return hash(seed, ka).localeCompare(hash(seed, kb)) || ka.localeCompare(kb);
    });
    const holdoutCount = Math.min(edges.length - 1, Math.max(1, Math.floor(edges.length * holdoutFraction)));
    const heldOut = ordered.slice(0, holdoutCount);
    const train = ordered.slice(holdoutCount);
    const adjacency = new Map(nodes.map(n => [n, new Set<string>()]));
    const trainPairs = new Set<string>();
    for (const { source, target } of train) {
        adjacency.get(source)!.add(target); adjacency.get(target)!.add(source);
        trainPairs.add(pairKey(source, target));
    }
    // All scores and degrees use TRAIN ONLY. Held-out edges never enter topology.
    const degrees = new Map([...adjacency].map(([n, neighbors]) => [n, neighbors.size]));
    const positives = new Set(heldOut.map(e => pairKey(e.source, e.target)));
    const candidates: { key: string; scores: Record<Baseline, number> }[] = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const key = pairKey(nodes[i], nodes[j]);
        if (trainPairs.has(key)) continue;
        candidates.push({ key, scores: neighborScores(adjacency.get(nodes[i])!, adjacency.get(nodes[j])!, degrees) });
    }
    const metrics = Object.fromEntries(algorithms.map(algorithm => {
        const ranked = [...candidates].sort((a, b) => b.scores[algorithm] - a.scores[algorithm] || a.key.localeCompare(b.key));
        const selected = ranked.slice(0, topK);
        const hits = selected.filter(c => positives.has(c.key)).length;
        return [algorithm, {
            evaluatedK: selected.length, hitsAtK: hits, recallAtK: hits / heldOut.length,
            observedEdgeFractionAtK: selected.length ? hits / selected.length : null,
            positiveScoreCandidates: ranked.filter(c => c.scores[algorithm] > 0).length,
            zeroScoreSelected: selected.filter(c => c.scores[algorithm] === 0).length,
        }];
    }));
    return {
        ...metadata, status: 'measured', trainEdges: train.length, heldOutEdges: heldOut.length,
        candidatePairs: candidates.length,
        coldHeldOutEdges: heldOut.filter(e => !degrees.get(e.source) || !degrees.get(e.target)).length,
        tieBreak: 'lexicographic canonical pair key (including zero-score ties)', metrics,
    };
}
