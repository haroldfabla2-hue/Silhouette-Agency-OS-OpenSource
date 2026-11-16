import { ResourceScope } from '../../server/runtime/resourceScope';
import { subscribeScoped } from '../runtime/scopedSubscription';
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
import { selfHealingTask } from './selfHealingTask';
import { isTaskAllowedByAutonomy, PROACTIVE_TASK_FLAGS, AutonomyFlags } from './autonomyPolicy';

// ─── TYPES ─────────────────────────────────────────────────────────────

export interface DaemonTask {
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
    // Lock TTL cap: the Redis lock protects against CONCURRENT execution, not
    // scheduling. A holder that dies (restart/crash) leaves a stale lock; with
    // a TTL near the full task interval (up to 12h) one restart silently
    // deferred every task by a whole interval. Cap the lease so a dead holder
    // blocks for at most LOCK_TTL_CAP_MS. Documented tradeoff: a task that
    // genuinely runs longer than the cap could overlap in a real multi-instance
    // cluster (single-instance deployment today; longest observed run ~1min).
    private readonly LOCK_TTL_CAP_MS = 60 * 60 * 1000; // 1 hour
    private readonly STATE_FILE = path.resolve(process.cwd(), 'data', 'daemon_state.json');

    private tasks: DaemonTask[] = [];

    private readonly operations = new ResourceScope('unified-daemon');
    private startup?: Promise<void>;
    private stopTask?: Promise<unknown>;
    private restored = false;
    private requestRestart?: () => Promise<void>;
    public setRestartHandler(handler: () => Promise<void>): void {
        this.operations.assertAccepting();
        if (this.startup) throw new Error('Set executable restart handler before daemon start');
        this.requestRestart = handler;
    }
    private saveQueue: Promise<void> = Promise.resolve();
    public shutdown() { this.stop(); return this.operations.close(); }
    public getLifecycleStatus() { return { restored: this.restored, diagnostics: this.operations.getDiagnostics(), failures: this.operations.getFailures() }; }
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
                name: 'SelfDev',
                intervalMs: Number(process.env.SELFDEV_AUTONOMOUS_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
                execute: async () => this.runSelfDevTask()
            },
            {
                name: 'Dreamer',
                intervalMs: 24 * 60 * 60 * 1000, // 24 hours
                execute: async () => this.runDreamerTask()
            },
            selfHealingTask
        ];

        // Init optional fields
        this.tasks.forEach(t => {
            t.enabled = true;
            t.lastRun = 0;
            t.runCount = 0;
            t.errCount = 0;
        });
    }

    public start(): Promise<void> {
        if (!this.startup) this.startup = this.operations.run('daemon-start', () => this.startOnce());
        return this.startup;
    }
    private async startOnce() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('[DAEMON] 🔋 Starting Unified Cognitive Daemon...');
        this.operations.own({ name: 'daemon-final-state', flush: async () => { if (this.restored) await this.saveState(); }, close: () => undefined });
        await this.loadState();
        this.restored = true;
        this.operations.assertAccepting();

        // [SECURITY] Real readers for autonomy config: proactive tasks (the
        // ones that wake agents, evolve the system or narrate) run ONLY when
        // the operator enabled them in silhouette.config.json. Previously
        // autonomy.enabled=false had zero readers and every task ran anyway.
        // Maintenance tasks (Self_Healing, Janitor) are not autonomy and
        // always run. Fail-closed: if the config cannot be read, proactive
        // tasks stay disabled.
        try {
            const { configLoader } = await import('../../server/config/configLoader');
            const autonomy = configLoader.getConfig().autonomy as AutonomyFlags;
            for (const task of this.tasks) {
                if (!isTaskAllowedByAutonomy(task.name, autonomy)) {
                    task.enabled = false;
                    console.log(`[DAEMON] ⛔ Task "${task.name}" disabled by config: autonomy.${PROACTIVE_TASK_FLAGS[task.name]}=false`);
                }
            }
        } catch (cfgErr: any) {
            console.error('[DAEMON] ⛔ Could not read autonomy config; proactive tasks DISABLED (fail-closed):', cfgErr?.message || cfgErr);
            for (const task of this.tasks) {
                if (PROACTIVE_TASK_FLAGS[task.name]) task.enabled = false;
            }
        }

        // Start internal tick system
        this.checkInterval = setInterval(() => { if (this.operations.accepting && this.isRunning) void this.tick().catch(() => undefined); }, this.TICK_INTERVAL_MS);
        const timer = this.checkInterval;
        this.operations.own({ name: 'daemon-tick', stopIntake: () => { clearInterval(timer); this.isRunning = false; }, close: () => clearInterval(timer) });

        // Run first tick immediately
        void this.tick().catch(() => undefined);

        // [PA-051] OS Dynamic Reload Hook (For Enterprise Plugins)
        const { systemBus } = await import('../../services/systemBus');
        const { SystemProtocol } = await import('../../types');
        this.operations.assertAccepting();
        subscribeScoped(this.operations, systemBus, SystemProtocol.SYSTEM_RESTART_REQUEST, () => {
            // Executable owns restart/exit. No library process.exit or sleep-as-drain.
            if (!this.requestRestart) {
                this.operations.recordFailure('restart-unbound', new Error('Executable restart coordination is not bound'));
                return;
            }
            // Do not await executable shutdown from inside this owner's callback:
            // it must drain this very callback. Dispatch the request synchronously;
            // executable owns its completion receipt, timeout, and exit outcome.
            void this.requestRestart().catch(error => this.operations.recordFailure('executable-restart', error));
        });
    }

    /** Scheduler state, not a claim of thought quality or completed cognition. */
    public getRuntimeStatus() {
        return { running: this.isRunning && this.checkInterval !== null,
            enabledTaskCount: this.tasks.filter(task => task.enabled).length,
            registeredTaskCount: this.tasks.length };
    }

    public stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        console.log('[DAEMON] 🛑 Stopping Unified Cognitive Daemon...');
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.stopTask = this.operations.run('daemon-stop-save', () => this.saveState());
        void this.stopTask.catch(() => undefined);
    }

    private async tick() {
        return this.operations.run('tick', async () => {

        const now = Date.now();

        for (const task of this.tasks) {
            if (!this.operations.accepting || !this.isRunning) break;
            if (!task.enabled) continue;

            const timeSinceLastRun = now - (task.lastRun || 0);
            if (timeSinceLastRun >= task.intervalMs) {

                // Enforce Redis Lock for Cluster Safety
                const lockKey = `lock:daemon:${task.name.toLowerCase()}`;
                // Lock for almost full interval so other instances don't run it
                let acquired = false;
                try {
                    acquired = await redisClient.acquireLock(
                        lockKey,
                        Math.min(task.intervalMs - 1000, this.LOCK_TTL_CAP_MS)
                    );
                } catch (lockErr: any) {
                    // Lock CHECK failed (redis blip): not a run, not a deferral.
                    // Log visibly and leave the task due for the next tick.
                    console.warn(`[DAEMON: LOCK-ERROR] ⚠️ ${task.name} lock check failed (${lockErr?.message || lockErr}); task stays due.`);
                    continue;
                }

                if (!acquired) {
                    console.log(`[DAEMON: SKIPPED] 🔒 ${task.name} already running in cluster.`);
                    // Do NOT touch lastRun: a held/failed lock is not a run.
                    // The task stays due and retries on the next tick, so a
                    // stale lock from a dead holder only defers execution
                    // until the (capped) lock expires — never a full interval.
                    // Cost is one SET NX per due task per 10s tick: trivial.
                    continue;
                }

                if (!this.operations.accepting || !this.isRunning) {
                    await redisClient.releaseLock(lockKey);
                    break;
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
                    this.operations.recordDiagnostic(`daemon-task:${task.name}`, error, 'OPERATION_REJECTED', 'UNAVAILABLE');
                    console.error(`[DAEMON: FAULT] ❌ ${task.name} failed (Attempt #${task.errCount}):`, error.message);
                }

                await this.saveState();
            }
        }
    
        });
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
                this.operations.recordFailure('daemon-state-recovery', e);
                throw e; // Preserve corrupt source; never boot fresh then overwrite it.

            }
        }
    }

    private saveState(): Promise<void> {
        const task = this.saveQueue.then(() => this.saveStateOnce());
        this.saveQueue = task.catch(() => undefined);
        return task;
    }
    private async saveStateOnce() {
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

            // Atomic write: serialize to a tmp sibling, fsync, then rename
            // over the state file. An unclean exit mid-write then leaves the
            // previous good file intact instead of a truncated one (observed
            // in prod: repeated "Unexpected end of JSON input" load failures).
            const tmpFile = `${this.STATE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
            const payload = JSON.stringify(state, null, 2);
            try {
                const handle = await fs.open(tmpFile, 'w');
                try { await handle.writeFile(payload, 'utf-8'); await handle.sync(); }
                finally { await handle.close(); }
                await fs.rename(tmpFile, this.STATE_FILE);
            } finally { await fs.rm(tmpFile, { force: true }); }
        } catch (e: any) {
            this.operations.recordFailure('daemon-state-durability', e);
            console.warn(`[DAEMON] Failed to save state: ${e.message}`);
            throw e;
        }
    }

    // ─── TASK IMPLEMENTATIONS ─────────────────────────────────────────────

    private async runHeartbeatTask() {
        return this.operations.run('runHeartbeatTask', async () => {

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
    
        });
    }

    private async runNarratorTask() {
        return this.operations.run('runNarratorTask', async () => {

        const thought = await thoughtNarrator.generateNarrative();
        try {
            const { consciousness } = await import('../consciousnessEngine');
            const thoughts = thought ? [thought] : [];
            const metrics = await consciousness.tick(thoughts, thoughts.length > 0 ? 70 : 20);
            daemonLog.info({ phi: metrics.phiScore, emergence: metrics.emergenceIndex }, 'Consciousness tick completed.');
        } catch (e: any) {
            console.warn(`[CONSCIOUSNESS] Tick failed: ${e.message}`);
        }
    
        });
    }

    private async runEvolutionGoalsTask() {
        return this.operations.run('runEvolutionGoalsTask', async () => {

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
    
        });
    }

    private async runCuriosityTask() {
        return this.operations.run('runCuriosityTask', async () => {

        console.log('[COGNITIVE: CURIOSITY] 🔍 Seeking knowledge gaps from graph...');
        const { curiosity } = await import('../curiosityService');
        const { advancedDiscovery } = await import('../cognitive/advancedDiscovery');

        // 1. Classical Open Triangles
        const gaps = await graph.findOpenTriangles(3);
        if (gaps && gaps.length > 0) {
            for (const gap of gaps) {
                const nodeA = gap.nodeA?.name || gap.nodeA?.id || 'Unknown';
                const nodeB = gap.nodeB?.name || gap.nodeB?.id || 'Unknown';
                const bridge = gap.bridge?.name || gap.bridge?.id || 'Unknown';
                await curiosity.addGap(
                    `${nodeA} ↔ ${nodeB} via ${bridge}`,
                    `"${nodeA}" and "${nodeB}" are both connected to "${bridge}" but not to each other. What is the relationship between them?`,
                    0.7
                );
            }
            console.log(`[COGNITIVE: CURIOSITY] 📝 Fed ${gaps.length} graph triangles as knowledge gaps.`);
        }

        // 2. Advanced Bridges (Small-World Theory)
        const bridges = await advancedDiscovery.discoverBridges(3);
        if (bridges && bridges.length > 0) {
            for (const b of bridges) {
                const nodeName = b.name;
                await curiosity.addGap(
                    `Bridge Concept: ${nodeName}`,
                    `The concept "${nodeName}" acts as a major bridge between different knowledge domains (Clustering: ${b.clustering.toFixed(2)}). What is its foundational nature?`,
                    0.8
                );

                // Tag natively in Neo4j so UI can render it immediately without math
                try {
                    await graph.runQuery(
                        `MATCH (n {id: $nodeId}) SET n.isBridge = true RETURN n`,
                        { nodeId: b.nodeId }
                    );
                } catch (e) {
                    console.warn(`[COGNITIVE: DAEMON] Failed to tag bridge node ${b.nodeId} in DB:`, e);
                }
            }
            console.log(`[COGNITIVE: CURIOSITY] 🌉 Fed ${bridges.length} Small-World Bridges as knowledge gaps.`);
        }

        // 3. Small-World Topology Analysis (Watts-Strogatz σ)
        try {
            const report = await advancedDiscovery.getNetworkTopologyReport();
            const symbol = report.isSmallWorld ? '🌐' : '⚠️';
            console.log(`[COGNITIVE: CURIOSITY] ${symbol} σ=${report.sigma.toFixed(3)} (${report.isSmallWorld ? 'Small-World ✓' : 'Not yet Small-World'}) | C̄=${report.avgClustering.toFixed(3)} L=${report.avgPathLength.toFixed(2)} | N=${report.totalNodes} E=${report.totalEdges}`);

            // If σ < 1, the graph needs more cross-domain connections 
            if (report.sigma > 0 && report.sigma < 1.0 && report.totalNodes > 10) {
                await curiosity.addGap(
                    'Network Topology Optimization',
                    `The knowledge graph has σ=${report.sigma.toFixed(2)} (below 1.0), meaning it lacks the small-world property. We need more cross-domain bridges to improve information flow. What concepts from different domains could be connected?`,
                    0.9
                );
            }
        } catch (e: any) {
            console.warn(`[COGNITIVE: CURIOSITY] σ analysis failed: ${e.message}`);
        }

        await curiosity.triggerResearch();
    
        });
    }

    private async runToolEvolutionTask() {
        return this.operations.run('runToolEvolutionTask', async () => {

        // @ts-ignore 
        if (typeof evolutionScheduler['runToolEvolutionCycle'] === 'function') {
            await (evolutionScheduler as any)['runToolEvolutionCycle']();
        }

        try {
            const { learningLoop } = await import('../learningLoop');
            const insights = await learningLoop.analyzeFailures(24 * 60 * 60 * 1000);
            for (const insight of insights) {
                if (insight.autoApplicable && insight.confidence > 0.75) {
                    const outcome = await learningLoop.routeInsight(insight);
                    console.log(`[COGNITIVE: LEARNING] ${outcome.stage}: ${insight.pattern} (applied=${outcome.applied})`);
                }
            }
        } catch (e: any) {
            console.warn(`[COGNITIVE: LEARNING] Analysis failed: ${e.message}`);
        }
    
        });
    }

    private async runJanitorTask() {
        return this.operations.run('runJanitorTask', async () => {

        // Janitor Truth Evaluation Engine v2 (services/janitor/janitorService.ts).
        // Eternal-memory safe: the engine has no delete path. DRY-RUN by default
        // (JANITOR_DRY_RUN=true): it records verified proposals to the ledger
        // and modifies nothing until explicitly enabled.
        console.log('[COGNITIVE: JANITOR] 🧹 Running truth evaluation cycle...');
        try {
            const { getJanitorService } = await import('../janitor/janitorService');
            const janitor = await getJanitorService();
            const report = await janitor.runCycle();
            console.log(`[COGNITIVE: JANITOR] ✅ Cycle done (dryRun=${report.dryRun}): ${report.candidates} candidates, ${report.clusters} clusters, ${report.applied} applied, ${report.proposed} proposed, ${report.abstained} abstained, ${report.errors} errors${report.abortedByCircuitBreaker ? ' [CIRCUIT BREAKER]' : ''} in ${report.durationMs}ms.`);
        } catch (e: any) {
            console.warn(`[COGNITIVE: JANITOR] Cycle aborted safely (memory untouched): ${e.message}`);
        }

        // [LEDGER-INTEGRITY] Same-process stale ledger sweep, RUNNING rows
        // only: a legit plan executes its steps sequentially in-process, so
        // its future steps sit 'pending' as valid waits - reaping those
        // would falsify live work. A 'running' row older than the step
        // bound (SILHOUETTE_STEP_TIMEOUT_MS + margin) is genuinely
        // abandoned: withStepTimeout settles every live step within the
        // bound. Dead-executor 'pending' rows are the boot sweep's job.
        // Never deletes; the mission can be re-run.
        try {
            const { reapStaleTasks } = await import('../execution/taskLedger');
            const stepTimeoutMs = Number(process.env.SILHOUETTE_STEP_TIMEOUT_MS ?? 30 * 60 * 1000);
            const staleMs = Number(process.env.TASK_LEDGER_STALE_MS ?? stepTimeoutMs + 15 * 60 * 1000);
            reapStaleTasks(Date.now() - staleMs, `stale: running step older than step-timeout bound (${Math.round(staleMs / 60000)}min), executor abandoned it`, ['running']);
        } catch (e: any) {
            console.warn(`[COGNITIVE: JANITOR] stale task sweep failed (non-blocking): ${e?.message}`);
        }
    
        });
    }

    // [AUTONOMOUS-SCHEDULER] Self-improvement cycles. The scheduler owns
    // every gate (master switch SELFDEV_AUTONOMOUS, memory-first quota
    // deferral, daily cap, one active cycle, human PR gate); this task is
    // only the timer. It never throws into the daemon loop.
    private async runSelfDevTask() {
        return this.operations.run('runSelfDevTask', async () => {

        try {
            const { runSelfDevSchedulerOnce } = await import('../selfdev/scheduler');
            const decision = await runSelfDevSchedulerOnce();
            if (decision.ran || !decision.reason.startsWith('disabled')) {
                console.log(`[COGNITIVE: SELFDEV] ${decision.reason}`);
            }
        } catch (e: any) {
            console.warn(`[COGNITIVE: SELFDEV] scheduler error (contained): ${e?.message}`);
        }
    
        });
    }

    private async runDreamerTask() {
        return this.operations.run('runDreamerTask', async () => {

        console.log('[COGNITIVE: DREAMER] 🌙 Starting deep memory consolidation...');

        // 1. Sync recent concepts to vector store
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

        // 2. Decay old relationship weights (simulate memory fading)
        try {
            await graph.runQuery(`
                MATCH ()-[r]->()
                WHERE r.weight IS NOT NULL AND r.weight > 0.05
                  AND r.lastUpdated IS NOT NULL
                  AND r.lastUpdated < timestamp() - 7 * 24 * 60 * 60 * 1000
                SET r.weight = r.weight * 0.95
                RETURN count(r) as decayed
            `);
            console.log('[COGNITIVE: DREAMER] 📉 Decayed old relationship weights by 5%.');
        } catch (e: any) {
            console.warn(`[COGNITIVE: DREAMER] Weight decay failed: ${e.message}`);
        }

        // 3. Archive low-importance Working memories to Deep storage
        try {
            const workingMemories = await continuum.retrieve('', 'working');
            const oldMemories = workingMemories.filter((m: any) => {
                const age = Date.now() - (m.timestamp || 0);
                return age > 48 * 60 * 60 * 1000; // Older than 48 hours
            });

            if (oldMemories.length > 0) {
                const { MemoryTier } = await import('../../types');
                for (const mem of oldMemories.slice(0, 20)) {
                    await continuum.store(
                        mem.content,
                        MemoryTier.DEEP,
                        mem.tags || ['consolidated'],
                        false
                    );
                }
                console.log(`[COGNITIVE: DREAMER] 💾 Consolidated ${Math.min(oldMemories.length, 20)} working memories to deep storage.`);
            }
        } catch (e: any) {
            console.warn(`[COGNITIVE: DREAMER] Memory consolidation failed: ${e.message}`);
        }

        // 4. Clean stale bridge tags (nodes no longer meeting criteria)
        try {
            await graph.runQuery(`
                MATCH (n {isBridge: true})
                OPTIONAL MATCH (n)-[r]-()
                WITH n, count(r) as degree
                WHERE degree <= 3
                SET n.isBridge = null
                RETURN count(n) as cleaned
            `);
            console.log('[COGNITIVE: DREAMER] 🧹 Cleaned stale bridge tags.');
        } catch (e: any) {
            console.warn(`[COGNITIVE: DREAMER] Bridge cleanup failed: ${e.message}`);
        }

        console.log('[COGNITIVE: DREAMER] 🌙 Deep consolidation complete.');
    
        });
    }
}

export const unifiedDaemon = new UnifiedDaemon();
