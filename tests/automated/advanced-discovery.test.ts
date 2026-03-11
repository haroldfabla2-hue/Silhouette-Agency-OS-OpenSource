import { describe, it, expect, vi, beforeEach } from 'vitest';
import { advancedDiscovery } from '../../services/cognitive/advancedDiscovery';
import { graph } from '../../services/graphService';

// Mock graphService
vi.mock('../../services/graphService', () => ({
    graph: {
        isConnectedStatus: vi.fn().mockReturnValue(true),
        runQuery: vi.fn()
    }
}));

describe('AdvancedDiscoveryService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('calculateClusteringCoefficient', () => {
        it('should return 0.0 if not connected', async () => {
            vi.mocked(graph.isConnectedStatus).mockReturnValueOnce(false);
            const result = await advancedDiscovery.calculateClusteringCoefficient('node1');
            expect(result).toBe(0.0);
        });

        it('should return correct coefficient from db', async () => {
            vi.mocked(graph.runQuery).mockResolvedValueOnce([{ clustering: 0.75 }]);
            const result = await advancedDiscovery.calculateClusteringCoefficient('node1');
            expect(result).toBe(0.75);
            expect(graph.runQuery).toHaveBeenCalledWith(expect.any(String), { nodeId: 'node1' });
        });

        it('should return 0.0 if query returns null result', async () => {
            vi.mocked(graph.runQuery).mockResolvedValueOnce([]);
            const result = await advancedDiscovery.calculateClusteringCoefficient('node1');
            expect(result).toBe(0.0);
        });
    });

    describe('findWeakTies', () => {
        it('should find and sort weak ties by discovery potential', async () => {
            vi.mocked(graph.runQuery).mockResolvedValueOnce([
                { targetId: 'node2', weight: 0.2 },
                { targetId: 'node3', weight: 0.1 }
            ]);
            // Mock clustering calls inside
            const clusterSpy = vi.spyOn(advancedDiscovery, 'calculateClusteringCoefficient');
            clusterSpy.mockResolvedValueOnce(0.5).mockResolvedValueOnce(0.8);

            const result = await advancedDiscovery.findWeakTies('node1', 0.3);

            expect(result).toHaveLength(2);
            // node3 has weight 0.1 -> potential 0.9
            // node2 has weight 0.2 -> potential 0.8
            expect(result[0].nodeId).toBe('node3');
            expect(result[0].discoveryPotential).toBe(0.9);
            expect(result[0].clustering).toBe(0.8);

            expect(result[1].nodeId).toBe('node2');
            expect(result[1].discoveryPotential).toBe(0.8);
            expect(result[1].clustering).toBe(0.5);

            clusterSpy.mockRestore();
        });
    });

    describe('discoverBridges', () => {
        it('should discover and sort nodes with high degree and low clustering', async () => {
            vi.mocked(graph.runQuery).mockResolvedValueOnce([
                { id: 'nodeA', name: 'Concept A', degree: 10 },
                { id: 'nodeB', name: 'Concept B', degree: 5 },
                { id: 'nodeC', name: 'Concept C', degree: 4 } // High clustering so filtered out
            ]);

            const clusterSpy = vi.spyOn(advancedDiscovery, 'calculateClusteringCoefficient');
            clusterSpy.mockImplementation(async (id) => {
                if (id === 'nodeA') return 0.1; // Bridge!
                if (id === 'nodeB') return 0.2; // Bridge!
                if (id === 'nodeC') return 0.8; // Not a bridge
                return 0.0;
            });

            const bridges = await advancedDiscovery.discoverBridges(10);
            expect(bridges).toHaveLength(2);
            expect(bridges[0].nodeId).toBe('nodeA'); // higher connections
            expect(bridges[1].nodeId).toBe('nodeB');

            clusterSpy.mockRestore();
        });
    });
});
