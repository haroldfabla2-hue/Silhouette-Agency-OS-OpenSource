/**
 * Advanced Memory Discovery System
 * Based on Small-World Network Theory (Watts & Strogatz, 1998)
 * Ported from `Silhouette-brain/advanced_discovery.py`
 *
 * Implements the COMPLETE Watts-Strogatz Model:
 * 1. Local Clustering Coefficient C_i
 * 2. Global Average Clustering Coefficient C̄
 * 3. Average Shortest Path Length L
 * 4. Random Graph Baselines (C_rand, L_rand) — Erdős–Rényi equivalent
 * 5. Small-World Index σ = (C/C_rand) / (L/L_rand)
 * 6. Weak Ties Discovery (Granovetter, 1973)
 * 7. Bridge Node Detection
 */

import { graph } from '../graphService';

export interface WeakTie {
    nodeId: string;
    weight: number;
    clustering: number;
    discoveryPotential: number; // 1.0 - weight
}

export interface BridgeNode {
    nodeId: string;
    clustering: number;
    connections: number;
}

export interface SmallWorldReport {
    sigma: number;             // σ >> 1 = small-world network
    avgClustering: number;     // C̄ (global average clustering)
    avgPathLength: number;     // L (average shortest path)
    randomClustering: number;  // C_rand = k̄/N
    randomPathLength: number;  // L_rand = ln(N)/ln(k̄)
    isSmallWorld: boolean;     // σ > 1.0
    totalNodes: number;
    totalEdges: number;
    avgDegree: number;         // k̄
    bridges: { nodeId: string; name: string; clustering: number; connections: number }[];
    timestamp: number;
}

const logger = {
    info: (msg: string, ...args: any[]) => console.log(`[ADV_DISCOVERY] 🧠 ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[ADV_DISCOVERY] ⚠️ ${msg}`, ...args),
};

class AdvancedDiscoveryService {
    // Cache the last topology report (expensive to compute)
    private lastReport: SmallWorldReport | null = null;
    private lastReportTime: number = 0;
    private readonly REPORT_CACHE_MS = 30 * 60 * 1000; // 30 min cache

    /**
     * Calculates the local clustering coefficient for a given node.
     * C_i = (links between neighbors) / (max possible links between them)
     */
    public async calculateClusteringCoefficient(nodeId: string): Promise<number> {
        if (!graph.isConnectedStatus()) return 0.0;

        const query = `
            MATCH (n {id: $nodeId})-[r1]-(n1)
            WITH n, count(DISTINCT n1) as k
            WHERE k > 1
            MATCH (n)-[]-(n1)-[r2]-(n2)-[]-(n)
            RETURN CASE 
                WHEN k > 1 THEN toFloat(count(r2)) / 2.0 / (k * (k - 1) / 2.0)
                ELSE 0.0 
            END as clustering
        `;

        try {
            const result = await graph.runQuery(query, { nodeId });
            if (result && result.length > 0 && result[0].clustering !== null) {
                return result[0].clustering;
            }
            return 0.0;
        } catch (e) {
            logger.warn(`Failed to calculate clustering for ${nodeId}:`, e);
            return 0.0;
        }
    }

    /**
     * Global Average Clustering Coefficient C̄.
     * C̄ = (1/N) * Σ C_i for sampled nodes with degree >= 2
     */
    public async calculateGlobalClusteringCoefficient(sampleSize: number = 30): Promise<number> {
        if (!graph.isConnectedStatus()) return 0.0;

        const query = `
            MATCH (n)
            OPTIONAL MATCH (n)-[r]-()
            WITH n, count(r) as degree
            WHERE degree >= 2
            RETURN n.id as id
            ORDER BY rand()
            LIMIT $sampleSize
        `;

        try {
            const candidates = await graph.runQuery(query, { sampleSize });
            if (candidates.length === 0) return 0.0;

            const coefficients = await Promise.all(
                candidates.map((c: any) => this.calculateClusteringCoefficient(c.id))
            );

            return coefficients.reduce((a, b) => a + b, 0) / coefficients.length;
        } catch (e) {
            logger.warn('Failed to calculate global clustering:', e);
            return 0.0;
        }
    }

    /**
     * Average Shortest Path Length L.
     * L = (1/|pairs|) * Σ d(u,v) for sampled pairs
     * Uses Neo4j's shortestPath() on random node pairs.
     */
    public async calculateAveragePathLength(samplePairs: number = 50): Promise<number> {
        if (!graph.isConnectedStatus()) return Infinity;

        const query = `
            MATCH (a), (b)
            WHERE a.id IS NOT NULL AND b.id IS NOT NULL
              AND a <> b AND rand() < 0.05
            WITH a, b
            LIMIT $samplePairs
            MATCH path = shortestPath((a)-[*..15]-(b))
            RETURN length(path) as pathLength
        `;

        try {
            const results = await graph.runQuery(query, { samplePairs });
            if (results.length === 0) return Infinity;

            const totalLength = results.reduce((sum: number, r: any) => sum + (r.pathLength || 0), 0);
            return totalLength / results.length;
        } catch (e) {
            logger.warn('Failed to calculate average path length:', e);
            return Infinity;
        }
    }

    /**
     * Calculates the Small-World Index σ (sigma).
     * 
     * σ = (C / C_rand) / (L / L_rand)
     * 
     * Where:
     *   C      = Global Average Clustering Coefficient
     *   C_rand = k̄ / N (Erdős–Rényi random graph baseline)
     *   L      = Average Shortest Path Length
     *   L_rand = ln(N) / ln(k̄) (Erdős–Rényi random graph baseline)
     * 
     * σ >> 1 → Small-World Network (like the human brain)
     * σ ≈ 1  → Random network
     * σ < 1  → Lattice-like (over-clustered, poor information flow)
     */
    public async calculateSmallWorldIndex(): Promise<{
        sigma: number;
        avgClustering: number;
        avgPathLength: number;
        randomClustering: number;
        randomPathLength: number;
        totalNodes: number;
        totalEdges: number;
        avgDegree: number;
    }> {
        const empty = { sigma: 0, avgClustering: 0, avgPathLength: Infinity, randomClustering: 0, randomPathLength: Infinity, totalNodes: 0, totalEdges: 0, avgDegree: 0 };
        if (!graph.isConnectedStatus()) return empty;

        const statsQuery = `
            MATCH (n) WHERE n.id IS NOT NULL
            WITH count(n) as N
            OPTIONAL MATCH ()-[r]->()
            RETURN N, count(r) as E
        `;

        try {
            const stats = await graph.runQuery(statsQuery);
            const N = stats[0]?.N || 0;
            const E = stats[0]?.E || 0;

            if (N < 5) {
                logger.info(`Graph too small for σ (N=${N}). Need ≥5 nodes.`);
                return { ...empty, totalNodes: N, totalEdges: E };
            }

            const avgDegree = (2 * E) / N; // k̄ = 2E/N for undirected

            // Compute C̄ and L in parallel
            const [avgClustering, avgPathLength] = await Promise.all([
                this.calculateGlobalClusteringCoefficient(30),
                this.calculateAveragePathLength(50)
            ]);

            // Erdős–Rényi random graph baselines
            const randomClustering = avgDegree / N;                        // C_rand
            const randomPathLength = avgDegree > 1
                ? Math.log(N) / Math.log(avgDegree)                       // L_rand
                : Infinity;

            // σ = (C/C_rand) / (L/L_rand)
            let sigma = 0;
            if (randomClustering > 0 && isFinite(randomPathLength) && isFinite(avgPathLength) && avgPathLength > 0) {
                const clusteringRatio = avgClustering / randomClustering;
                const pathRatio = avgPathLength / randomPathLength;
                sigma = pathRatio > 0 ? clusteringRatio / pathRatio : 0;
            }

            logger.info(`σ=${sigma.toFixed(3)} | C̄=${avgClustering.toFixed(3)} L=${avgPathLength.toFixed(2)} | C_rand=${randomClustering.toFixed(4)} L_rand=${randomPathLength.toFixed(2)} | N=${N} E=${E} k̄=${avgDegree.toFixed(1)}`);

            return { sigma, avgClustering, avgPathLength, randomClustering, randomPathLength, totalNodes: N, totalEdges: E, avgDegree };
        } catch (e) {
            logger.warn('Failed to calculate Small-World Index:', e);
            return empty;
        }
    }

    /**
     * Full network topology report combining σ + bridges.
     * Cached for 30 minutes to avoid hammering Neo4j.
     */
    public async getNetworkTopologyReport(forceRefresh: boolean = false): Promise<SmallWorldReport> {
        if (!forceRefresh && this.lastReport && (Date.now() - this.lastReportTime < this.REPORT_CACHE_MS)) {
            return this.lastReport;
        }

        const [swIndex, bridges] = await Promise.all([
            this.calculateSmallWorldIndex(),
            this.discoverBridges(10)
        ]);

        const report: SmallWorldReport = {
            ...swIndex,
            isSmallWorld: swIndex.sigma > 1.0,
            bridges,
            timestamp: Date.now()
        };

        this.lastReport = report;
        this.lastReportTime = Date.now();
        return report;
    }

    // ═══════════════════════════════════════════════════════════════
    // WEAK TIES + BRIDGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Find Weak Ties for a node (Granovetter, 1973).
     * Lower weight = weaker tie = higher discovery potential.
     */
    public async findWeakTies(nodeId: string, threshold: number = 0.3): Promise<WeakTie[]> {
        if (!graph.isConnectedStatus()) return [];

        const query = `
            MATCH (n {id: $nodeId})-[r]-(neighbor)
            WITH neighbor, coalesce(r.weight, r.confidence, 1.0) as weight
            WHERE weight < $threshold
            RETURN neighbor.id as targetId, weight
        `;

        try {
            const results = await graph.runQuery(query, { nodeId, threshold });
            const weakTies = await Promise.all(
                results.map(async (r: any) => ({
                    nodeId: r.targetId,
                    weight: r.weight,
                    clustering: await this.calculateClusteringCoefficient(r.targetId),
                    discoveryPotential: 1.0 - r.weight
                }))
            );
            return weakTies.sort((a, b) => b.discoveryPotential - a.discoveryPotential);
        } catch (e) {
            logger.warn(`Failed to find weak ties for ${nodeId}:`, e);
            return [];
        }
    }

    /**
     * Discover bridging nodes across the entire Graph.
     * A Bridge has LOW clustering but HIGH connections.
     */
    public async discoverBridges(limit: number = 10): Promise<{ nodeId: string; name: string; clustering: number; connections: number }[]> {
        if (!graph.isConnectedStatus()) return [];

        const query = `
            MATCH (n)
            OPTIONAL MATCH (n)-[r]-()
            WITH n, count(r) as degree
            WHERE degree > 3
            RETURN n.id as id, n.name as name, degree
            ORDER BY degree DESC
            LIMIT 50
        `;

        try {
            const candidates = await graph.runQuery(query);
            const resolved = await Promise.all(
                candidates.map(async (c: any) => {
                    const clustering = await this.calculateClusteringCoefficient(c.id);
                    return clustering < 0.3
                        ? { nodeId: c.id, name: c.name || c.id, clustering, connections: c.degree }
                        : null;
                })
            );

            return resolved
                .filter((b): b is NonNullable<typeof b> => b !== null)
                .sort((a, b) => b.connections - a.connections)
                .slice(0, limit);
        } catch (e) {
            logger.warn(`Failed to discover bridges:`, e);
            return [];
        }
    }
}

export const advancedDiscovery = new AdvancedDiscoveryService();
