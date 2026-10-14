/**
 * AdvancedDiscovery regressions (found live in production logs):
 * 1. calculateClusteringCoefficient emitted Cypher that Neo4j rejects with
 *    50N42 (aggregation expression using implicit grouping key k).
 * 2. discoverBridges crashed with "TypeError: Cannot convert a BigInt value
 *    to a number" because Neo4j integers arrive as BigInt and the final
 *    sort subtracted them raw — killing ConsciousnessEngine.calculatePhi
 *    every tick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const mockRunQuery = vi.fn();
vi.mock('../../services/graphService', () => ({
    graph: {
        isConnectedStatus: () => true,
        runQuery: (q: string, p?: unknown) => mockRunQuery(q, p),
    }
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { advancedDiscovery } = await import('../../services/cognitive/advancedDiscovery');

describe('advancedDiscovery (production-crash regressions)', () => {
    // NOTE: braces required — a bare arrow returns the mock from mockReset(),
    // and vitest registers a returned function as a cleanup hook (calls it with
    // no args after the test, re-entering mockImplementation with undefined).
    beforeEach(() => { mockRunQuery.mockReset(); });

    it('discoverBridges: BigInt degrees from Neo4j do not crash the sort', async () => {
        mockRunQuery.mockImplementation(async (query: string) => {
            if (query.includes('degree > 3')) {
                return [
                    { id: 'a', name: 'A', degree: 5n },   // Neo4j Integer => BigInt
                    { id: 'b', name: 'B', degree: 9n },
                ];
            }
            return [{ clustering: 0.1 }]; // clustering coefficient per candidate
        });
        const bridges = await advancedDiscovery.discoverBridges(10);
        expect(bridges).toHaveLength(2);
        expect(bridges.map(b => b.nodeId)).toEqual(['b', 'a']); // sorted desc, no TypeError
        expect(typeof bridges[0].connections).toBe('number');
    });

    it('clustering Cypher is legal for Neo4j 5 (no aggregation over implicit grouping key)', async () => {
        mockRunQuery.mockResolvedValue([{ clustering: 0.42 }]);
        const c = await advancedDiscovery.calculateClusteringCoefficient('node-1');
        expect(c).toBe(0.42);
        const src = fs.readFileSync(path.resolve(__dirname, '../../services/cognitive/advancedDiscovery.ts'), 'utf-8');
        expect(src).toContain('WITH k, count(r2) as links');
        expect(src).not.toContain('WHEN k > 1 THEN toFloat(count(r2))');
    });

    it('calculateAveragePathLength: BigInt path lengths do not crash the reduce', async () => {
        mockRunQuery.mockResolvedValue([{ pathLength: 4n }, { pathLength: 6n }]);
        const l = await advancedDiscovery.calculateAveragePathLength(50);
        expect(l).toBe(5);
        expect(typeof l).toBe('number');
    });

    it('calculateSmallWorldIndex: BigInt N/E from Neo4j do not crash (2 * E)', async () => {
        mockRunQuery.mockImplementation(async (query: string) => {
            if (query.includes('count(n) as N')) return [{ N: 647n, E: 12000n }]; // Neo4j Integers
            if (query.includes('degree >= 2')) return [{ id: 'x' }, { id: 'y' }];
            if (query.includes('shortestPath')) return [{ pathLength: 4n }, { pathLength: 6n }];
            return [{ clustering: 0.5 }];
        });
        const r = await advancedDiscovery.calculateSmallWorldIndex();
        expect(r.totalNodes).toBe(647);
        expect(r.totalEdges).toBe(12000);
        expect(typeof r.avgDegree).toBe('number');
        expect(Number.isFinite(r.sigma)).toBe(true);
        expect(r.sigma).toBeGreaterThan(0); // well-connected graph must score sigma > 0
    });
    it('empty result (k <= 1 filtered out) yields 0.0 without throwing', async () => {
        mockRunQuery.mockResolvedValue([]);
        await expect(advancedDiscovery.calculateClusteringCoefficient('lonely')).resolves.toBe(0.0);
    });
});
