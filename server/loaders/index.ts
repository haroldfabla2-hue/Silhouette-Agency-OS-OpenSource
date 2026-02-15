
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

    // === VOICE ENGINE MONITORING ===
    // Start voice engine health monitoring (checks every 30s)
    voiceMonitor.startMonitoring();
    console.log("[LOADER] 🎤 Voice Engine monitoring started");

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
