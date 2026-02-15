import { graph } from './graphService';

// ═══════════════════════════════════════════════════════════════════════════
// [PHASE 2B] HUB STRENGTHENING SERVICE (SYNAPTIC PLASTICITY) - OPTIMIZED
// Based on: Hebbian Learning, Synaptic Pruning, Scale-Free Network Dynamics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HubStrengtheningService implements biomimetic neural plasticity:
 * 
 * OPTIMIZATIONS (v2):
 * - Batched Hebbian reinforcement (reduces DB calls)
 * - Throttled pruning (prevents DB overload)
 * - Configurable batch sizes
 * - Structured logging with levels
 */

// Simple structured logger
const logger = {
    info: (msg: string, data?: any) => console.log(`[HUB_STRENGTH] ℹ️ ${msg}`, data || ''),
    warn: (msg: string, data?: any) => console.warn(`[HUB_STRENGTH] ⚠️ ${msg}`, data || ''),
    error: (msg: string, data?: any) => console.error(`[HUB_STRENGTH] ❌ ${msg}`, data || ''),
    debug: (msg: string, data?: any) => {
        if (process.env.DEBUG_HUB_STRENGTH) console.log(`[HUB_STRENGTH] 🔍 ${msg}`, data || '');
    }
};

interface ReinforcementRequest {
    fromId: string;
    toId: string;
    timestamp: number;
}

class HubStrengtheningService {
    // Configuration
    private readonly CONFIG = {
        DECAY_RATE: 0.01,
        MIN_WEIGHT_THRESHOLD: 0.05,
        REINFORCEMENT_DELTA: 0.15,
        HUB_PROTECTION_FACTOR: 0.5,
        BATCH_SIZE: 50,                    // Process N reinforcements at once
        BATCH_INTERVAL_MS: 5000,           // Flush batch every 5 seconds
        PRUNING_BATCH_SIZE: 100,           // Prune N connections per query
        PRUNING_INTERVAL_MS: 10 * 60 * 1000 // 10 minutes
    };

    private pruningInterval: NodeJS.Timeout | null = null;
    private batchInterval: NodeJS.Timeout | null = null;

    // Batched reinforcement queue
    private reinforcementQueue: ReinforcementRequest[] = [];
    private isProcessingBatch = false;

    constructor() {
        // Auto-start after 1 minute
        setTimeout(() => {
            this.startPruningCycle();
            this.startBatchProcessor();
        }, 60000);
    }

    /**
     * Starts the periodic pruning cycle
     */
    public startPruningCycle() {
        if (this.pruningInterval) return;

        logger.info(`Starting Synaptic Pruning Cycle (Every ${this.CONFIG.PRUNING_INTERVAL_MS / 60000}m)`);
        this.pruningInterval = setInterval(() => {
            this.runPruningCycle().catch(e => logger.error('Pruning error:', e));
        }, this.CONFIG.PRUNING_INTERVAL_MS);
    }

    /**
     * Starts the batch processor for Hebbian reinforcement
     */
    private startBatchProcessor() {
        if (this.batchInterval) return;

        logger.info(`Starting Batch Reinforcement Processor (Every ${this.CONFIG.BATCH_INTERVAL_MS / 1000}s)`);
        this.batchInterval = setInterval(() => {
            this.flushReinforcementBatch().catch(e => logger.error('Batch flush error:', e));
        }, this.CONFIG.BATCH_INTERVAL_MS);
    }

    /**
     * Stop all background processes
     */
    public stop() {
        if (this.pruningInterval) {
            clearInterval(this.pruningInterval);
            this.pruningInterval = null;
        }
        if (this.batchInterval) {
            clearInterval(this.batchInterval);
            this.batchInterval = null;
        }
        logger.info('All background processes stopped');
    }

    // Alias for backward compatibility
    public stopPruningCycle() {
        this.stop();
    }

    /**
     * HEBBIAN REINFORCEMENT (Queued)
     * Adds reinforcement request to batch queue for efficient processing.
     */
    public async reinforceConnection(fromId: string, toId: string) {
        // Deduplicate: Don't add if already in queue
        const exists = this.reinforcementQueue.some(
            r => (r.fromId === fromId && r.toId === toId) ||
                (r.fromId === toId && r.toId === fromId)
        );

        if (!exists) {
            this.reinforcementQueue.push({ fromId, toId, timestamp: Date.now() });
            logger.debug(`Queued reinforcement: ${fromId} ↔ ${toId} (Queue size: ${this.reinforcementQueue.length})`);
        }

        // Flush immediately if batch is full
        if (this.reinforcementQueue.length >= this.CONFIG.BATCH_SIZE) {
            await this.flushReinforcementBatch();
        }
    }

    /**
     * Flush the reinforcement queue (batch update)
     */
    private async flushReinforcementBatch() {
        if (this.isProcessingBatch || this.reinforcementQueue.length === 0) return;

        this.isProcessingBatch = true;
        const batch = this.reinforcementQueue.splice(0, this.CONFIG.BATCH_SIZE);

        try {
            // Single optimized query for batch update using UNWIND
            const query = `
                UNWIND $pairs AS pair
                MATCH (a {id: pair.fromId})-[r]-(b {id: pair.toId})
                SET r.weight = COALESCE(r.weight, 0.5) + $delta,
                    r.lastAccessed = timestamp(),
                    r.accessCount = COALESCE(r.accessCount, 0) + 1
                RETURN count(r) as updated
            `;

            const result = await graph.runQuery(query, {
                pairs: batch.map(b => ({ fromId: b.fromId, toId: b.toId })),
                delta: this.CONFIG.REINFORCEMENT_DELTA
            });

            const updatedCount = result[0]?.updated || 0;
            if (updatedCount > 0) {
                logger.info(`Batch reinforced ${updatedCount} connections`);
            }

        } catch (e) {
            logger.error('Batch reinforcement failed:', e);
            // Re-queue failed items (with limit to prevent infinite loop)
            const now = Date.now();
            const retryable = batch.filter(b => now - b.timestamp < 60000);
            this.reinforcementQueue.unshift(...retryable);
        } finally {
            this.isProcessingBatch = false;
        }
    }

    /**
     * SYNAPTIC PRUNING CYCLE (Optimized with batching)
     */
    public async runPruningCycle() {
        logger.info('Running Synaptic Pruning...');
        const startTime = Date.now();

        try {
            // Get all hubs for protection
            const hubs = await graph.getHubs(10);
            const hubIds = new Set(hubs.map(h => h.id));

            // 1. DECAY in batches
            const decayQuery = `
                MATCH (a)-[r]-(b)
                WHERE r.lastAccessed IS NOT NULL 
                  AND r.lastAccessed < timestamp() - 600000
                WITH r, a, b
                LIMIT $batchSize
                SET r.weight = CASE
                    WHEN a.id IN $hubIds OR b.id IN $hubIds 
                    THEN r.weight - ($decayRate * $hubProtection)
                    ELSE r.weight - $decayRate
                END
                RETURN count(r) as decayedCount
            `;

            const decayResult = await graph.runQuery(decayQuery, {
                batchSize: this.CONFIG.PRUNING_BATCH_SIZE,
                decayRate: this.CONFIG.DECAY_RATE,
                hubProtection: this.CONFIG.HUB_PROTECTION_FACTOR,
                hubIds: Array.from(hubIds)
            });

            const decayedCount = decayResult[0]?.decayedCount || 0;

            // 2. PRUNE in batches
            const pruneQuery = `
                MATCH (a)-[r]-(b)
                WHERE r.weight IS NOT NULL AND r.weight < $threshold
                  AND NOT (a.id IN $hubIds AND b.id IN $hubIds)
                WITH r
                LIMIT $batchSize
                DELETE r
                RETURN count(*) as prunedCount
            `;

            const pruneResult = await graph.runQuery(pruneQuery, {
                batchSize: this.CONFIG.PRUNING_BATCH_SIZE,
                threshold: this.CONFIG.MIN_WEIGHT_THRESHOLD,
                hubIds: Array.from(hubIds)
            });

            const prunedCount = pruneResult[0]?.prunedCount || 0;
            const duration = Date.now() - startTime;

            // Log summary
            logger.info(`Pruning complete`, {
                decayed: decayedCount,
                pruned: prunedCount,
                durationMs: duration,
                hubsProtected: hubIds.size
            });

            // Anti-fragility warning
            if (prunedCount > 50) {
                logger.warn('High pruning rate detected - network may be losing coherence');
            }

        } catch (e) {
            logger.error('Pruning cycle failed:', e);
        }
    }

    /**
     * Get network health metrics (optimized single query)
     */
    public async getNetworkHealth(): Promise<{
        totalNodes: number;
        totalEdges: number;
        avgDegree: number;
        hubCount: number;
        weakConnectionsCount: number;
        queueSize: number;
    }> {
        try {
            // Combined query for efficiency
            const query = `
                MATCH (n)
                OPTIONAL MATCH (n)-[r]-()
                WITH n, count(r) as degree, r
                WITH 
                    count(DISTINCT n) as totalNodes,
                    sum(degree)/2 as totalEdges,
                    avg(degree) as avgDegree,
                    count(CASE WHEN degree > 10 THEN 1 END) as hubCount
                OPTIONAL MATCH ()-[weak]-() WHERE weak.weight IS NOT NULL AND weak.weight < 0.2
                RETURN totalNodes, totalEdges, avgDegree, hubCount, count(weak)/2 as weakCount
            `;

            const result = await graph.runQuery(query, {});

            return {
                totalNodes: result[0]?.totalNodes || 0,
                totalEdges: result[0]?.totalEdges || 0,
                avgDegree: result[0]?.avgDegree || 0,
                hubCount: result[0]?.hubCount || 0,
                weakConnectionsCount: result[0]?.weakCount || 0,
                queueSize: this.reinforcementQueue.length
            };
        } catch (e) {
            logger.error('Health check failed:', e);
            return {
                totalNodes: 0,
                totalEdges: 0,
                avgDegree: 0,
                hubCount: 0,
                weakConnectionsCount: 0,
                queueSize: this.reinforcementQueue.length
            };
        }
    }

    /**
     * Force flush any pending reinforcements (for testing/shutdown)
     */
    public async forceFlush() {
        await this.flushReinforcementBatch();
    }
}

export const hubStrengthening = new HubStrengtheningService();
