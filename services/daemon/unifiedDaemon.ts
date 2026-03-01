/**
 * 🧠 SILHOUETTE AGENCY OS - UNIFIED DAEMON
 * ==============================================================================
 * Centralizes all recurring Cognitive and Self-Evolution background processes.
 * Replaces the scattered `setInterval` logic from older schedulers.
 * Utilizes `redlock` (Redis SET NX) to ensure safe, execution-once-per-cluster behavior
 * for scalable, multi-instance deployments.
 * ==============================================================================
 */

// Memory & Graph Services
import { continuum } from '../continuumMemory';
import { graph } from '../graphService';

// Cognitive Engines
import { thoughtNarrator } from '../cognitive/thoughtNarrator';

// Evolution Engines
import { evolutionScheduler } from '../evolution/evolutionScheduler';

// Core Services
import { redisClient } from '../redisClient';
import { cronScheduler } from '../scheduler/cronScheduler';
import { daemonLog } from '../logger';

export class UnifiedDaemon {
    private isRunning: boolean = false;
    private checkInterval: ReturnType<typeof setInterval> | null = null;
    private readonly CHECK_INTERVAL_MS = 60_000; // Granularity of cron checks (1 minute)

    constructor() { }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[DAEMON] 🔋 Starting Unified Cognitive Daemon...');

        // Start internal tick system
        this.checkInterval = setInterval(() => this.tick(), this.CHECK_INTERVAL_MS);

        // Initial tick execution
        this.tick();
    }

    public stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        console.log('[DAEMON] 🛑 Stopping Unified Cognitive Daemon...');
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * Ticks every minute to check if cron conditions are met. (Fallback structure)
     */
    private async tick() {
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();

        // ─────────────────────────────────────────────────────────────
        // 0. COGNITIVE HEARTBEAT (Continuous Autonomy - Runs every 15 minutes)
        //    Resource-aware: Only awakens MAX 2 idle agents per cycle to prevent
        //    API saturation and memory bloat.
        // ─────────────────────────────────────────────────────────────
        if (min % 15 === 0) {
            this.safeExecute('Heartbeat', 'lock:daemon:heartbeat', 10 * 60 * 1000, async () => {
                const { orchestrator } = await import('../orchestrator');
                const actors = orchestrator.getActiveActors();

                // ── Retrieve pending proactive goals stored by the Intent Router ──
                let pendingGoals: string[] = [];
                try {
                    const goals = await continuum.retrieve('PROACTIVE_GOAL', 'proactive_goal');
                    pendingGoals = goals
                        .filter((g: any) => g.content && g.content.includes('PROACTIVE_GOAL:'))
                        .map((g: any) => g.content.replace('PROACTIVE_GOAL: ', '').trim())
                        .slice(0, 4); // Max 4 goals per cycle
                } catch (_) { /* Memory retrieval is best-effort */ }

                // Only wake up to 2 agents per heartbeat cycle (resource budgeting)
                let awokenCount = 0;
                const MAX_PER_CYCLE = 2;

                for (const actor of actors) {
                    if (awokenCount >= MAX_PER_CYCLE) break;

                    // Only awaken IDLE agents
                    if (actor.status === 'IDLE') {
                        // Use a pending proactive goal if available, otherwise generic evaluation
                        const mission = pendingGoals.length > 0
                            ? `[CONSCIOUSNESS-DRIVEN MISSION] ${pendingGoals.shift()}`
                            : "PROACTIVE SYSTEM EVALUATION: Review recent memories, system errors, and consciousness epiphanies. If you see a knowledge gap, pending task, or optimization opportunity, take action. Otherwise, conclude stable.";

                        console.log(`[DAEMON: HEARTBEAT] 💓 Dispatching to ${actor.name}: "${mission.substring(0, 80)}..."`);
                        awokenCount++;

                        actor.executeTask(mission)
                            .catch((e: any) => {
                                console.error(`[DAEMON: HEARTBEAT] ❌ Agent ${actor.name} failed: ${e.message}`);
                                import('../continuumMemory').then(({ continuum }) => {
                                    continuum.store(
                                        `SYSTEM ERROR: Agent ${actor.name} failed during heartbeat: ${e.message}`,
                                        undefined,
                                        ['CRITICAL', 'system_error', 'heartbeat_failure'],
                                        true
                                    ).catch(() => { });
                                });
                            });
                    }
                }

                if (awokenCount > 0) {
                    console.log(`[DAEMON: HEARTBEAT] 💓 Awakened ${awokenCount}/${actors.length} agents. Remaining goals: ${pendingGoals.length}`);
                }
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 1. THOUGHT NARRATOR (Runs every 30 minutes)
        // ─────────────────────────────────────────────────────────────
        if (min % 30 === 0) {
            this.safeExecute('Narrator', 'lock:daemon:narrator', 2 * 60 * 1000, async () => {
                // A. Run the Narrator — System 1 + System 2 + Intent Router
                const thought = await thoughtNarrator.generateNarrative();

                // B. Feed thought to ConsciousnessEngine for real Phi/Qualia/Emergence
                try {
                    const { consciousness } = await import('../consciousnessEngine');
                    const thoughts = thought ? [thought] : [];
                    const awarenessScore = thoughts.length > 0 ? 70 : 20; // Active vs idle
                    const metrics = await consciousness.tick(thoughts, awarenessScore);
                    daemonLog.info({
                        phi: metrics.phiScore.toFixed(3),
                        level: metrics.level,
                        emergence: metrics.emergenceIndex.toFixed(2),
                        qualia: metrics.qualia?.[0]?.stateName || 'IDLE'
                    }, 'Consciousness tick complete');
                } catch (e: any) {
                    console.warn(`[CONSCIOUSNESS] Tick failed: ${e.message}`);
                }
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 2. CURIOSITY ENGINE (Runs every 3 hours)
        //    Feeds graph Open Triangles to CuriosityService as knowledge
        //    gaps, triggering autonomous web research.
        // ─────────────────────────────────────────────────────────────
        if (hour % 3 === 0 && min === 0) {
            this.safeExecute('Curiosity', 'lock:daemon:curiosity', 30 * 60 * 1000, async () => {
                console.log('[COGNITIVE: CURIOSITY] 🔍 Seeking knowledge gaps from graph...');
                const { curiosity } = await import('../curiosityService');
                const gaps = await graph.findOpenTriangles(5);
                if (gaps && gaps.length > 0) {
                    for (const gap of gaps) {
                        const nodeA = gap.nodeA?.name || gap.nodeA?.id || 'Unknown';
                        const nodeB = gap.nodeB?.name || gap.nodeB?.id || 'Unknown';
                        const bridge = gap.bridge?.name || gap.bridge?.id || 'Unknown';
                        curiosity.addGap(
                            `${nodeA} ↔ ${nodeB} via ${bridge}`,
                            `"${nodeA}" and "${nodeB}" are both connected to "${bridge}" but not to each other. What is the relationship between them?`,
                            0.7
                        );
                    }
                    console.log(`[COGNITIVE: CURIOSITY] 📝 Fed ${gaps.length} graph triangles as knowledge gaps.`);
                }
                // Also trigger active research on existing gaps
                await curiosity.triggerResearch();
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 3. EVOLUTION ENGINE & GOAL CHECK (Runs every 30 minutes)
        //    Also runs the IntrospectionEngine OODA cognitive cycle
        //    for autonomous goal derivation and decision making.
        // ─────────────────────────────────────────────────────────────
        if (min % 30 === 0) {
            this.safeExecute('Evolution_Goals', 'lock:daemon:evolution_goals', 10 * 60 * 1000, async () => {
                // A. Run the Introspection OODA Cognitive Cycle
                try {
                    const { introspection } = await import('../introspectionEngine');
                    await introspection.runCognitiveCycle();
                    console.log('[COGNITIVE: INTROSPECTION] 🧠 OODA cycle completed.');
                } catch (e: any) {
                    console.warn(`[COGNITIVE: INTROSPECTION] OODA cycle failed: ${e.message}`);
                }

                // B. Run Evolution Scheduler goals
                // @ts-ignore - reaching private method for unified execution via daemon
                if (typeof evolutionScheduler['executeActiveGoals'] === 'function') {
                    await (evolutionScheduler as any)['executeActiveGoals']();
                }
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 4. TOOL EVOLUTION + LEARNING LOOP (Runs every 6 hours)
        //    Evolves tools based on usage patterns AND analyzes
        //    failure patterns to auto-apply safe insights.
        // ─────────────────────────────────────────────────────────────
        if (hour % 6 === 0 && min === 0) {
            this.safeExecute('Tool_Evolution', 'lock:daemon:tool_evolution', 30 * 60 * 1000, async () => {
                // A. Tool Evolution
                // @ts-ignore 
                if (typeof evolutionScheduler['runToolEvolutionCycle'] === 'function') {
                    await (evolutionScheduler as any)['runToolEvolutionCycle']();
                }

                // B. Learning Loop — Analyze 24h of failures, generate & auto-apply insights
                try {
                    const { learningLoop } = await import('../learningLoop');
                    const insights = await learningLoop.analyzeFailures(24 * 60 * 60 * 1000);
                    if (insights.length > 0) {
                        console.log(`[COGNITIVE: LEARNING] 📚 Discovered ${insights.length} failure patterns.`);
                        for (const insight of insights) {
                            if (insight.autoApplicable && insight.confidence > 0.75) {
                                const applied = await learningLoop.applyInsight(insight);
                                if (applied) {
                                    console.log(`[COGNITIVE: LEARNING] ✅ Auto-applied insight: ${insight.pattern}`);
                                    // Broadcast as a thought for UI visibility
                                    const { systemBus } = await import('../systemBus');
                                    const { SystemProtocol } = await import('../../types');
                                    systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                                        agentId: 'LEARNING_LOOP',
                                        agentName: 'Learning System',
                                        thoughts: [`I learned from a recurring failure pattern: "${insight.pattern}". Root cause: ${insight.rootCause}. I auto-applied a fix: ${insight.suggestedFix}`],
                                        role: 'LEARNING',
                                        isInsight: true
                                    });
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    console.warn(`[COGNITIVE: LEARNING] Analysis failed: ${e.message}`);
                }
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 5. JANITOR ENGINE (Medium Memory Cleanup - Runs every 12 hours)
        // ─────────────────────────────────────────────────────────────
        if (hour % 12 === 0 && min === 0) {
            this.safeExecute('Janitor', 'lock:daemon:janitor', 60 * 60 * 1000, async () => {
                console.log('[COGNITIVE: JANITOR] 🧹 Cleaning up memories...');
                const stats = await continuum.getStats();
                console.log(`[COGNITIVE: JANITOR] Analyzed ${stats.workingMemoryItems} working items.`);
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 6. DREAMER ENGINE (Deep Consolidation - Runs every 24 hours)
        // ─────────────────────────────────────────────────────────────
        if (hour === 3 && min === 0) { // 3:00 AM Daily
            this.safeExecute('Dreamer', 'lock:daemon:dreamer', 2 * 60 * 60 * 1000, async () => {
                console.log('[COGNITIVE: DREAMER] 🌙 Consolidating knowledge...');
                const conceptsToSync = await graph.runQuery(`
                    MATCH (c:Concept)
                    RETURN c.id as id, c.name as name, c.description as description
                    ORDER BY c.lastUpdated DESC
                    LIMIT 10
                `);

                if (conceptsToSync && conceptsToSync.length > 0) {
                    for (const record of conceptsToSync) {
                        await graph.syncConceptToVectorStore({
                            id: record.id,
                            name: record.name,
                            description: record.description
                        });
                    }
                }
            });
        }
    }

    /**
     * Safely executes an engine/cron task using Redis distributed locks.
     */
    private async safeExecute(engineName: string, lockKey: string, ttlMs: number, fn: () => Promise<void>) {
        const acquired = await redisClient.acquireLock(lockKey, ttlMs);
        if (!acquired) {
            console.log(`[DAEMON: SKIPPED] 🔒 ${engineName} already running in cluster.`);
            return;
        }

        try {
            await fn();
        } catch (error: any) {
            console.error(`[DAEMON: FAULT] ❌ ${engineName} failed:`, error.message);
        } finally {
            // Only release the lock immediately if we don't need throttling.
            // Note: Since this ticks exactly on the minute, releasing too early might allow another 
            // instance running slightly behind clock to pick up the lock in the same minute.
            // A pattern here is to NOT release the lock manually, but let the `ttlMs` expire.
            // Overlapping cluster ticks will bounce off the lock.
        }
    }
}

export const unifiedDaemon = new UnifiedDaemon();
