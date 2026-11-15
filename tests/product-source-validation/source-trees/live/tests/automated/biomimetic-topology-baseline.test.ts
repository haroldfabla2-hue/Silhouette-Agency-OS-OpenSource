import { describe, it, expect } from 'vitest';
import { measureLinkBaselines, neighborScores, normalizeEdges } from '../../services/analysis/linkPredictionBaseline';

const edges = [
    { source: 'a', target: 'b' }, { source: 'b', target: 'c' },
    { source: 'a', target: 'c' }, { source: 'c', target: 'd' },
    { source: 'a', target: 'd' },
];
describe('provider-free topology baseline (offline reconstruction, not GNN)', () => {
    it('computes explicit CN/Jaccard/Adamic-Adar scores', () => {
        const scores = neighborScores(new Set(['x', 'y']), new Set(['x', 'z']), new Map([['x', 4]]));
        expect(scores.commonNeighbors).toBe(1);
        expect(scores.jaccard).toBeCloseTo(1 / 3);
        expect(scores.adamicAdar).toBeCloseTo(1 / Math.log(4));
    });
    it('normalizes reverse/type duplicates and removes self loops', () => {
        expect(normalizeEdges([{ source: 'b', target: 'a' }, { source: 'a', target: 'b' }, { source: 'a', target: 'a' }])).toEqual([{ source: 'a', target: 'b' }]);
    });
    it('is deterministic under input reorder and records seed', () => {
        expect(measureLinkBaselines(edges)).toEqual(measureLinkBaselines([...edges].reverse()));
        expect(measureLinkBaselines(edges, { seed: 'explicit' }).seed).toBe('explicit');
    });
    it('reports insufficient data instead of inventing accuracy on an empty graph', () => {
        expect(measureLinkBaselines([])).toMatchObject({ status: 'insufficient-data', metrics: null, heldOutEdges: 0 });
        expect(measureLinkBaselines([edges[0]])).toMatchObject({ status: 'insufficient-data', metrics: null });
    });
    it('removes held-out links BEFORE all neighbor/degree calculation (triangle loses its only heldout link)', () => {
        const result = measureLinkBaselines(edges.slice(0, 3), { topK: 1 });
        expect(result).toMatchObject({ trainEdges: 2, heldOutEdges: 1, candidatePairs: 1 });
        expect(result.metrics?.commonNeighbors).toMatchObject({ hitsAtK: 1, positiveScoreCandidates: 1 });
    });
    it('keeps cold endpoints in the denominator and labels zero-score ties', () => {
        const result = measureLinkBaselines([{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }], { topK: 10 });
        expect(result.coldHeldOutEdges).toBe(1);
        expect(result.metrics?.commonNeighbors).toMatchObject({ evaluatedK: 5, hitsAtK: 1, recallAtK: 1, zeroScoreSelected: 5, positiveScoreCandidates: 0 });
    });
    it('rejects quadratic candidate overflow, malformed rows and invalid configuration', () => {
        expect(() => measureLinkBaselines(edges, { maxPairs: 2 })).toThrow('Pair budget exceeded');
        expect(() => measureLinkBaselines([{ source: '', target: 'x' }])).toThrow();
        expect(() => measureLinkBaselines(edges, { holdoutFraction: 1 })).toThrow();
        expect(() => measureLinkBaselines(edges, { topK: 0 })).toThrow();
    });
});
