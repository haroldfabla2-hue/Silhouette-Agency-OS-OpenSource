/**
 * 🧠 SILHOUETTE AGENCY OS - UNIFIED DAEMON (STATEFUL)
 * ==============================================================================
 * Centralizes all recurring Cognitive and Self-Evolution background processes.
 * Uses a Stateful Task Architecture (persisted to daemon_state.json) to survive
 * restarts, isolated `try/catch` per task, and precise interval-based execution.
 * Utilizes `redlock` (Redis SET NX) to ensure safe, execution-once-per-cluster behavior.
 * ==============================================================================
 */

import fs from 'fs/promises';
import path from 'path';
import { continuum } from '../continuumMemory';
import { graph } from '../graphService';
import { thoughtNarrator } from '../cognitive/thoughtNarrator';
import { evolutionScheduler } from '../evolution/evolutionScheduler';
import { redisClient } from '../redisClient';
import { daemonLog } from '../logger';

// ─── TYPES ─────────────────────────────────────────────────────────────

interface DaemonTask {
    name: string;
    intervalMs: number;
    execute: () => Promise<void>;
    enabled?: boolean;
    lastRun?: number;
    runCount?: number;
    errCount?: number;
}

interface DaemonState {
    tasks: Record<string, { lastRun: number; runCount: number; errCount: number }>;
    updatedAt: number;
}

// ─── CLASS ─────────────────────────────────────────────────────────────

export class UnifiedDaemon {
    private isRunning: boolean = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly TICK_INTERVAL_MS = 10_000; // Check every 10 seconds
    private readonly STATE_FILE = path.resolve(process.cwd(), 'data', 'daemon_state.json');

    private tasks: DaemonTask[] = [];

    constructor() {
        this.initializeTasks();
    }

    private initializeTasks() {
        this.tasks = [
            {
                name: 'Heartbeat',
                intervalMs: 15 * 60 * 1000, // 15 mins
                execute: async () => this.runHeartbeatTask()
            },
            {
                name: 'Narrator',
                intervalMs: 30 * 60 * 1000, // 30 mins
                execute: async () => this.runNarratorTask()
            },
            {
                name: 'Evolution_Goals',
                intervalMs: 30 * 60 * 1000, // 30 mins
                execute: async () => this.runEvolutionGoalsTask()
            },
            {
                name: 'Curiosity',
                intervalMs: 3 * 60 * 60 * 1000, // 3 hours
                execute: async () => this.runCuriosityTask()
            },
            {
                name: 'Tool_Evolution',
                intervalMs: 6 * 60 * 60 * 1000, // 6 hours
                execute: async () => this.runToolEvolutionTask()
            },
            {
                name: 'Janitor',
                intervalMs: 12 * 60 * 60 * 1000, // 12 hours
                execute: async () => this.runJanitorTask()
            },
            {
                name: 'Dreamer',
                intervalMs: 24 * 60 * 60 * 1000, // 24 hours
                execute: async () => this.runDreamerTask()
            }
        ];

        // Init optional fields
        this.tasks.forEach(t => {
            t.enabled = true;
            t.lastRun = 0;
            t.runCount = 0;
            t.errCount = 0;
        });
    }

    public async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[DAEMON] 🔋 Starting Unified Cognitive Daemon...');
        await this.loadState();

        // Start internal tick system
        this.checkInterval = setInterval(() => this.tick(), this.TICK_INTERVAL_MS);

        // Run first tick immediately
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
        this.saveState(); // Save state on shutdown
    }

    private async tick() {
        const now = Date.now();

        for (const task of this.tasks) {
            if (!task.enabled) continue;

            const timeSinceLastRun = now - (task.lastRun || 0);
            if (timeSinceLastRun >= task.intervalMs) {

                // Enforce Redis Lock for Cluster Safety
                const lockKey = `lock:daemon:${task.name.toLowerCase()}`;
                // Lock for almost full interval so other instances don't run it
                const acquired = await redisClient.acquireLock(lockKey, task.intervalMs - 1000);

                if (!acquired) {
                    console.log(`[DAEMON: SKIPPED] 🔒 ${task.name} already running in cluster.`);
                    // Update lastRun so this instance doesn't keep hammering the lock locally
                    task.lastRun = now;
                    continue;
                }

                const t0 = Date.now();
                daemonLog.info({ task: task.name }, '▶ inicio');

                try {
                    await task.execute();
                    task.lastRun = Date.now();
                    task.runCount = (task.runCount || 0) + 1;
                    daemonLog.info({ task: task.name, durationMs: Date.now() - t0 }, '✓ completado');
                } catch (error: any) {
                    task.lastRun = Date.now(); // Prevent immediate retry loops
                    task.errCount = (task.errCount || 0) + 1;
                    console.error(`[DAEMON: FAULT] ❌ ${task.name} failed (Attempt #${task.errCount}):`, error.message);
                }

                await this.saveState();
            }
        }
    }

    // ─── STATE PERSISTENCE ────────────────────────────────────────────────

    private async loadState() {
        try {
            await fs.mkdir(path.dirname(this.STATE_FILE), { recursive: true });
            const data = await fs.readFile(this.STATE_FILE, 'utf-8');
            const state = JSON.parse(data) as DaemonState;

            for (const task of this.tasks) {
                if (state.tasks[task.name]) {
                    task.lastRun = state.tasks[task.name].lastRun;
                    task.runCount = state.tasks[task.name].runCount;
                    task.errCount = state.tasks[task.name].errCount;
                }
            }
            daemonLog.info({ taskCount: this.tasks.length }, 'Loaded daemon state');
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                console.warn(`[DAEMON] Failed to load state: ${e.message}`);
            }
        }
    }

    private async saveState() {
        try {
            const state: DaemonState = {
                tasks: {},
                updatedAt: Date.now()
            };

            for (const task of this.tasks) {
                state.tasks[task.name] = {
                    lastRun: task.lastRun || 0,
                    runCount: task.runCount || 0,
                    errCount: task.errCount || 0
                };
            }

            await fs.writeFile(this.STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
        } catch (e: any) {
            console.warn(`[DAEMON] Failed to save state: ${e.message}`);
        }
    }

    // ─── TASK IMPLEMENTATIONS ─────────────────────────────────────────────

    private async runHeartbeatTask() {
        const { orchestrator } = await import('../orchestrator');
        const actors = orchestrator.getActiveActors();

        let pendingGoals: string[] = [];
        try {
            const goals = await continuum.retrieve('PROACTIVE_GOAL', 'proactive_goal');
            pendingGoals = goals
                .filter((g: any) => g.content && g.content.includes('PROACTIVE_GOAL:'))
                .map((g: any) => g.content.replace('PROACTIVE_GOAL: ', '').trim())
                .slice(0, 4);
        } catch (_) { }

        let awokenCount = 0;
        const MAX_PER_CYCLE = 2;

        for (const actor of actors) {
            if (awokenCount >= MAX_PER_CYCLE) break;
            if (actor.status === 'IDLE') {
                const mission = pendingGoals.length > 0
                    ? `[CONSCIOUSNESS-DRIVEN MISSION] ${pendingGoals.shift()}`
                    : "PROACTIVE SYSTEM EVALUATION: Review recent memories, system errors, and consciousness epiphanies. If you see a knowledge gap, pending task, or optimization opportunity, take action. Otherwise, conclude stable.";

                console.log(`[DAEMON: HEARTBEAT] 💓 Dispatching to ${actor.name}: "${mission.substring(0, 80)}..."`);
                awokenCount++;

                actor.executeTask(mission).catch(async (e: any) => {
                    console.error(`[DAEMON: HEARTBEAT] ❌ Agent ${actor.name} failed: ${e.message}`);
                    continuum.store(
                        `SYSTEM ERROR: Agent ${actor.name} failed during heartbeat: ${e.message}`,
                        undefined,
                        ['CRITICAL', 'system_error', 'heartbeat_failure'],
                        true
                    ).catch(() => { });
                });
            }
        }

        if (awokenCount > 0) {
            console.log(`[DAEMON: HEARTBEAT] 💓 Awakened ${awokenCount}/${actors.length} agents.`);
        }
    }

    private async runNarratorTask() {
        const thought = await thoughtNarrator.generateNarrative();
        try {
            const { consciousness } = await import('../consciousnessEngine');
            const thoughts = thought ? [thought] : [];
            const metrics = await consciousness.tick(thoughts, thoughts.length > 0 ? 70 : 20);
            daemonLog.info({ phi: metrics.phiScore, emergence: metrics.emergenceIndex }, 'Consciousness tick completed.');
        } catch (e: any) {
            console.warn(`[CONSCIOUSNESS] Tick failed: ${e.message}`);
        }
    }

    private async runEvolutionGoalsTask() {
        try {
            const { introspection } = await import('../introspectionEngine');
            await introspection.runCognitiveCycle();
            console.log('[COGNITIVE: INTROSPECTION] 🧠 OODA cycle completed.');
        } catch (e: any) {
            console.warn(`[COGNITIVE: INTROSPECTION] OODA cycle failed: ${e.message}`);
        }

        // @ts-ignore
        if (typeof evolutionScheduler['executeActiveGoals'] === 'function') {
            await (evolutionScheduler as any)['executeActiveGoals']();
        }
    }

    private async runCuriosityTask() {
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
        await curiosity.triggerResearch();
    }

    private async runToolEvolutionTask() {
        // @ts-ignore 
        if (typeof evolutionScheduler['runToolEvolutionCycle'] === 'function') {
            await (evolutionScheduler as any)['runToolEvolutionCycle']();
        }

        try {
            const { learningLoop } = await import('../learningLoop');
            const insights = await learningLoop.analyzeFailures(24 * 60 * 60 * 1000);
            for (const insight of insights) {
                if (insight.autoApplicable && insight.confidence > 0.75) {
                    const applied = await learningLoop.applyInsight(insight);
                    if (applied) {
                        console.log(`[COGNITIVE: LEARNING] ✅ Auto-applied insight: ${insight.pattern}`);
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
        } catch (e: any) {
            console.warn(`[COGNITIVE: LEARNING] Analysis failed: ${e.message}`);
        }
    }

    private async runJanitorTask() {
        console.log('[COGNITIVE: JANITOR] 🧹 Cleaning up memories...');
        const stats = await continuum.getStats();
        console.log(`[COGNITIVE: JANITOR] Analyzed ${stats.workingMemoryItems} working items.`);
    }

    private async runDreamerTask() {
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
    }
}

export const unifiedDaemon = new UnifiedDaemon();
