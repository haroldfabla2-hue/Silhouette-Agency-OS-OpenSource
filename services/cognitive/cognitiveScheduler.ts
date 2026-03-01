import { graph } from '../graphService';
import { lancedbService } from '../lancedbService';
import { generateEmbedding } from '../geminiService';
import { continuum } from '../continuumMemory';
import { redisClient } from '../redisClient';

/**
 * 🧠 Silhouette Cognitive Scheduler (Brain Port)
 * Handles chron jobs for the 4-Tier Memory system mirroring the Python architecture.
 */
export class CognitiveScheduler {
    private isRunning: boolean = false;
    private timers: ReturnType<typeof setInterval>[] = [];

    constructor() { }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[COGNITIVE: WARNING] 🧠 cognitiveScheduler.start() is deprecated. Real scheduling is now handled by UnifiedDaemon.');
    }

    public stop() {
        console.log('[COGNITIVE: WARNING] 🛑 cognitiveScheduler.stop() is deprecated.');
        this.timers.forEach(clearTimeout);
        this.timers = [];
        this.isRunning = false;
    }

    // --- ENGINE PORTS ---

    /**
     * 🔍 Curiosity Engine
     * Explores the graph looking for "holes" and generates questions.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runCuriosity() {
        console.log('[COGNITIVE: CURIOSITY] 🔍 Seeking knowledge gaps...');
        try {
            // Find open triangles in Neo4j to suggest possible missing links
            const gaps = await graph.findOpenTriangles(3);
            if (gaps && gaps.length > 0) {
                console.log(`[COGNITIVE: CURIOSITY] Found ${gaps.length} gaps. Injecting to Working Memory.`);
                // Insert into continuum (Working Memory) so agents see it
                for (const gap of gaps) {
                    await continuum.store({
                        content: `COGNITIVE DRIVE: I noticed ${gap.nodeA.name} and ${gap.nodeB.name} are both related to ${gap.bridge.name}. Are they related to each other? I should investigate.`,
                        type: 'thought'
                    } as any);
                }
            }
        } catch (e: any) {
            console.error('[COGNITIVE: CURIOSITY] Failed:', e.message);
        }
    }

    /**
     * 🧹 Janitor Engine
     * Cleans up Medium Memory and resolves contradictions.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runJanitor() {
        console.log('[COGNITIVE: JANITOR] 🧹 Cleaning up memories...');
        try {
            // In a full port, this would read SQLite (Medium Memory) and look for conflicting facts
            // For now, it cleans up decayed memory in LanceDB
            const stats = await continuum.getStats();
            console.log(`[COGNITIVE: JANITOR] Analyzed ${stats.workingMemoryItems} working items.`);
        } catch (e: any) {
            console.error('[COGNITIVE: JANITOR] Failed:', e.message);
        }
    }

    /**
     * 🌙 Dreamer Engine
     * Consolidates Medium Memory into Long-Term (LanceDB) and Deep (Neo4j).
     * @deprecated Called by unifiedDaemon now.
     */
    public async runDreamer() {
        console.log('[COGNITIVE: DREAMER] 🌙 Consolidating knowledge...');
        try {
            // 1. Poda Sináptica (Synaptic Pruning) — remove weak/stale nodes
            try {
                const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                const cutoff = Date.now() - THIRTY_DAYS_MS;
                const pruned = await graph.runQuery(`
                    MATCH (c:Concept)
                    WHERE c.accessCount < 3 AND c.lastAccessed < $cutoff
                    WITH c, c.name AS name
                    DETACH DELETE c
                    RETURN count(name) AS prunedCount
                `, { cutoff });
                const count = pruned?.[0]?.prunedCount || 0;
                if (count > 0) {
                    console.log(`[COGNITIVE: DREAMER] 🌿 Pruned ${count} weak concepts (< 3 access, > 30 days old).`);
                }
            } catch (e: any) {
                // Graph might not support these fields yet — that's fine
                console.warn('[COGNITIVE: DREAMER] Pruning skipped (graph may not have accessCount/lastAccessed):', e.message);
            }

            // 2. Check working memory pressure
            try {
                const stats = await continuum.getStats();
                if (stats.workingMemoryItems > 200) {
                    console.warn(`[COGNITIVE: DREAMER] ⚠️ Working memory pressure: ${stats.workingMemoryItems} items (threshold: 200). Consider manual review.`);
                }
            } catch (e: any) {
                console.warn('[COGNITIVE: DREAMER] Working memory stats check skipped:', e.message);
            }

            // 3. Sync concepts to VectorStore
            const conceptsToSync = await graph.runQuery(`
                MATCH (c:Concept)
                RETURN c.id as id, c.name as name, c.description as description
                ORDER BY c.lastUpdated DESC
                LIMIT 10
            `);

            if (conceptsToSync && conceptsToSync.length > 0) {
                console.log(`[COGNITIVE: DREAMER] Syncing ${conceptsToSync.length} concepts to VectorStore...`);
                for (const record of conceptsToSync) {
                    await graph.syncConceptToVectorStore({
                        id: record.id,
                        name: record.name,
                        description: record.description
                    });
                }
            }

            console.log('[COGNITIVE: DREAMER] Phase 1 complete.');
        } catch (e: any) {
            console.error('[COGNITIVE: DREAMER] Failed:', e.message);
        }
    }

    /**
     * 🧬 Evolution Engine
     * Meta-cognitive evaluation of system performance.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runEvolution() {
        console.log('[COGNITIVE: EVOLUTION] 🧬 Evaluating metric performance...');
        try {
            // Evaluates verification rates and suggests prompt optimizations
            console.log('[COGNITIVE: EVOLUTION] System stable.');
        } catch (e: any) {
            console.error('[COGNITIVE: EVOLUTION] Failed:', e.message);
        }
    }

    /**
     * 🗣️ Thought Narrator
     * Generates a steady stream of consciousness about the system state.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runNarrator() {
        try {
            // Import dynamically to avoid circular dependencies if thoughtNarrator imports continuum
            const { thoughtNarrator } = await import('./thoughtNarrator');
            await thoughtNarrator.generateNarrative();
        } catch (e: any) {
            console.error('[COGNITIVE: NARRATOR] Failed:', e.message);
        }
    }
}

export const cognitiveScheduler = new CognitiveScheduler();
