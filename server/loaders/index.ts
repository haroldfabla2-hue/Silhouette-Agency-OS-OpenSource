
import { initDatabases } from './dbLoader';
import { initAIServices } from './aiLoader';
import { startHeartbeat } from '../jobs/heartbeat';
import { startPersistenceJobs } from '../jobs/persistence';
import { contextJanitor } from '../../services/contextJanitor';
import { learningLoop } from '../../services/learningLoop';
import { toolEvolver } from '../../services/tools/toolEvolver';
import { voiceMonitor } from '../../services/media/voiceMonitorService';
import { initializeContextConfig } from '../routes/v1/context.routes'; // [PA-041]
import { initializeNervousSystem } from '../../services/connectionNervousSystem'; // Auto-healing

export const initServer = async () => {
    console.log("=================================");
    console.log("   SILHOUETTE AGENCY OS - v7.5   ");
    console.log("=================================");

    await initDatabases();
    await initAIServices();

    // [LIFECYCLE] Dreaming loop starts EXPLICITLY at boot. It previously
    // started as a hidden side effect of importing continuumMemory, which
    // also fired in tests/tools. Idempotent and PowerManager-gated; only the
    // trigger point moved. [SECURITY] It now ALSO respects the config
    // ceiling: the Dreamer daemon task is gated by autonomy.enabled in
    // unifiedDaemon, and this loop is the same capability by another route -
    // the ceiling must hold on every route. Fail-closed.
    try {
        const { configLoader } = await import('../config/configLoader');
        const { isTaskAllowedByAutonomy } = await import('../../services/daemon/autonomyPolicy');
        if (isTaskAllowedByAutonomy('Dreamer', configLoader.getConfig().autonomy as any)) {
            const { dreamer } = await import('../../services/dreamerService');
            dreamer.startDreamingLoop();
        } else {
            console.log('[BOOT] 🌙 Dreaming loop NOT started: autonomy.enabled=false (config ceiling).');
        }
    } catch (e: any) {
        console.warn('[BOOT] Dreaming loop not started: autonomy config unreadable (fail-closed):', e?.message);
    }

    // [PA-041] Load persisted Context Priority configuration
    await initializeContextConfig();

    // Start Background Jobs
    startHeartbeat();
    startPersistenceJobs();

    // Initial Cleanup - DEFERRED 5s after startup to avoid blocking
    setTimeout(() => {
        contextJanitor.runMaintenance().catch((e) =>
            console.warn("[LOADER] Janitor maintenance deferred error:", e)
        );
    }, 5000);

    // === SELF-EVOLUTION SYSTEM ===
    // [SECURITY] These loops are the SAME proactive capabilities the daemon
    // runs as its gated 'Tool_Evolution' task (learning analysis + tool
    // evolution) - started here by a second route. The authority ceiling must
    // hold on every route: they start only when autonomy allows
    // 'Tool_Evolution' (master enabled + allowEvolution). Fail-closed.
    // PowerManager throttling is applied per-tick inside the loops.
    try {
        const { configLoader } = await import('../config/configLoader');
        const { isTaskAllowedByAutonomy } = await import('../../services/daemon/autonomyPolicy');
        if (isTaskAllowedByAutonomy('Tool_Evolution', configLoader.getConfig().autonomy as any)) {
            // Schedule Learning Loop (every 6 hours) - analyzes failures and generates insights
            const LEARNING_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
            learningLoop.schedulePeriodicAnalysis(LEARNING_INTERVAL);
            console.log("[LOADER] 🧠 Learning Loop scheduled (every 6h)");

            // Schedule Tool Evolution (every 6 hours) - optimizes underperforming tools
            toolEvolver.scheduleEvolutionCycles(LEARNING_INTERVAL);
            console.log("[LOADER] 🧬 Tool Evolution scheduled (every 6h)");

            // Run initial analysis after 30 seconds (gives system time to warm up)
            setTimeout(async () => {
                console.log("[LOADER] 🔍 Running initial self-evolution analysis...");
                try {
                    const insights = await learningLoop.analyzeFailures();
                    console.log(`[LOADER] 💡 Initial analysis complete: ${insights.length} insights found`);
                } catch (e) {
                    console.warn("[LOADER] Initial learning analysis skipped:", e);
                }
            }, 30000);
        } else {
            console.log("[LOADER] 🧬 Self-evolution loops NOT started: autonomy ceiling (Tool_Evolution / allowEvolution) disabled.");
        }
    } catch (e: any) {
        console.warn("[LOADER] 🧬 Self-evolution loops not started: autonomy config unreadable (fail-closed):", e?.message || e);
    }

    // === VOICE ENGINE MONITORING ===
    // Start voice engine health monitoring (checks every 30s) if enabled
    if (process.env.ENABLE_VOICE_ENGINE === 'true') {
        voiceMonitor.startMonitoring();
        console.log("[LOADER] 🎤 Voice Engine monitoring started");
    } else {
        console.log("[LOADER] 🎤 Voice Engine monitoring disabled (ENABLE_VOICE_ENGINE != true)");
    }

    // === CONNECTION NERVOUS SYSTEM ===
    // Auto-healing for Neo4j, Ollama, Google APIs, etc.
    setTimeout(async () => {
        try {
            await initializeNervousSystem();
            console.log("[LOADER] 🧠 Connection Nervous System online");
        } catch (e) {
            console.warn("[LOADER] Nervous System initialization deferred:", e);
        }
    }, 3000); // Wait 3s for services to be ready

    // === AUTONOMOUS SCHEDULER ===
    // Start task scheduler for autonomous operations
    setTimeout(async () => {
        try {
            const { schedulerService } = await import('../../services/schedulerService');
            schedulerService.start();
            console.log("[LOADER] ⏰ Autonomous Scheduler online");
        } catch (e) {
            console.warn("[LOADER] Scheduler initialization deferred:", e);
        }
    }, 5000); // Wait 5s for other services

    console.log("[LOADER] 🚀 System Ready.");
};
