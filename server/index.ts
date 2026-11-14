// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load environment variables FIRST, before any imports
// This is the true entry point - must load env before everything
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load Configuration FIRST (Env -> JSON Migration)
// ═══════════════════════════════════════════════════════════════
import { configLoader } from './config/configLoader';
import { createServer } from 'http';
import { stopRuntimeRootHost, recordRuntimeStartupFailure, installRuntimeRootShutdown } from './runtimeRootHost';
import { AdmissionClosed } from '../services/lifecycle/host';
import { sealEvaluatedRuntimeProducers, drainEvaluatedRuntimeProducers, closeEvaluatedRuntimeStorage, evaluatedRuntimeFrontier, RuntimeConstructionAdmissionClosed } from '../services/lifecycle/runtimeStopBindings';

// Initialize Config (Loads Env or JSON)
const config = configLoader.getConfig();

import { app, appInitialization } from './app';
import { sealAndDrainBootTimers, bootTimerFrontier } from './lifecycle/bootTimers';
import '../services/narrativeService'; // Initialize Unified Stream Aggregator

const PORT = config.system.port || 3005;
// Bind to loopback by default for safety. Set SILHOUETTE_HOST=0.0.0.0 to expose
// on all interfaces (containers/VPS) — and set SILHOUETTE_API_TOKEN when you do.
const HOST = process.env.SILHOUETTE_HOST || '127.0.0.1';

// ═══════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS - Catch unhandled errors before they crash
// ═══════════════════════════════════════════════════════════════
process.on('unhandledRejection', async (reason: any) => {
    const msg = reason?.message || String(reason);
    console.error('[FATAL] Unhandled Promise Rejection:', msg);
    // Route through structured logger so self-healing can pick it up
    try {
        const { logger } = await import('../services/logger');
        logger.error({ source: 'unhandledRejection', stack: reason?.stack?.substring(0, 500) }, msg);
    } catch (_) { /* logger not yet available during early boot */ }
});

process.on('uncaughtException', async (error: Error) => {
    console.error('[FATAL] Uncaught Exception:', error.message);
    console.error(error.stack);
    try {
        const { logger } = await import('../services/logger');
        logger.fatal({ source: 'uncaughtException', stack: error.stack?.substring(0, 500) }, error.message);
    } catch (_) { /* logger not yet available */ }
    // For uncaught exceptions, give time to flush logs then exit
    setTimeout(() => process.exit(1), 1000);
});

// [LEDGER-INTEGRITY] Captured at process start: ledger rows older than
// this boot belong to a dead executor and are reaped in the listen callback.
const PROCESS_STARTED_AT = Date.now();

let isShuttingDown = false;
let startupGateway: typeof import('./gateway').gateway | undefined;
let startupTerminalGateway: typeof import('./channels/terminalWebSocket').TerminalGateway | undefined;
let finishStartup!: () => void;
let failStartup!: (error: unknown) => void;
let startupEntered = false;
const originalStartup = new Promise<void>((resolve, reject) => { finishStartup = resolve;failStartup = reject; });
// Retain rejection now; shutdown also joins the exact original task.
void originalStartup.catch(error => {
    recordRuntimeStartupFailure(error);
    console.error('[BOOT] Original startup failed:', error);
    void gracefulShutdown('ORIGINAL_STARTUP_FAILED').catch(failure=>console.error('[BOOT] Failed startup drain rejected:',failure));
});
const server = createServer((request, response) => {
    if (isShuttingDown) {
        response.statusCode = 503;response.setHeader('Connection', 'close');
        response.end('Server shutting down');return;
    }
    // This retains the actual Express listener but does NOT claim its void
    // return or response.finish joins all transitive asynchronous route work.
    app(request, response);
});
async function completeOriginalStartup(): Promise<void> {
    await appInitialization;
    if(isShuttingDown)return;
    console.log(`
    -------------------------------------------
    SILHOUETTE AGENCY OS IS ONLINE
    -------------------------------------------
    ► API Gateway:  http://localhost:${PORT}
    ► WS Gateway:   ws://localhost:${PORT}/ws
    ► Bind Host:    ${HOST}
    ► Environment:  ${process.env.NODE_ENV || 'development'}
    -------------------------------------------
    `);

    // [LEDGER-INTEGRITY] Close ledger rows left open by previous process
    // lives: a restart strands pending/running rows whose executor is
    // gone. Signal verified in code: these rows are unambiguous orphans -
    // the only executor that could advance them ran in the dead process,
    // and mission resume (workflowEngine.executeMissionBuild) always
    // generates a NEW planId via planGenerator.create and overwrites
    // pipelineData.planId, so no resume path ever re-drives a pre-boot
    // row. They are failed honestly (never deleted); re-running the
    // mission is the recovery path.
    if (isShuttingDown) return;
    try {
        const { reapStaleTasks } = await import('../services/execution/taskLedger');
        if (isShuttingDown) return;
        reapStaleTasks(PROCESS_STARTED_AT, 'executor lost: process restart (ledger row predates this boot)');
    } catch (e: any) {

        if (isShuttingDown && (e instanceof AdmissionClosed || e instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(e);
        console.warn('[BOOT] stale task sweep failed (non-blocking):', e?.message);
    }

    // [GATEWAY] Initialize WebSocket Gateway (shares HTTP server)
    if (isShuttingDown) return;
    try {
        const { gateway } = await import('./gateway');
        startupGateway = gateway;
        if (isShuttingDown) return;
        gateway.initialize(server);
        console.log('[GATEWAY] ✅ WebSocket Gateway initialized');
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[GATEWAY] Failed to initialize WebSocket Gateway:', error);
    }

    // [TERMINAL] Initialize Interactive Terminal WebSocket
    if (isShuttingDown) return;
    try {
        const { TerminalGateway } = await import('./channels/terminalWebSocket');
        startupTerminalGateway = TerminalGateway;
        if (isShuttingDown) return;
        TerminalGateway.initialize(server);
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[TERMINAL] Failed to initialize Terminal Gateway:', error);
    }


    // [CHANNELS] Initialize Messaging Channels (WhatsApp, Telegram, Discord)
    if (isShuttingDown) return;
    try {
        const { initializeChannels } = await import('./channels');
        if (isShuttingDown) return;
        await initializeChannels();
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[CHANNELS] Failed to initialize channels:', error);
    }

    // [MCP] Initialize and Mount Standard MCP Server
    if (isShuttingDown) return;
    try {
        const { mcpWrapper } = await import('./mcp/mcpServer');
        if (isShuttingDown) return;
        await mcpWrapper.initialize();
        await mcpWrapper.mount(app);
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[MCP] Failed to initialize standard MCP server:', error);
    }

    // [PLUGINS] Initialize Plugin System (Phase 14)
    if (isShuttingDown) return;
    try {
        const { pluginRegistry } = await import('../services/plugins/pluginRegistry');
        if (isShuttingDown) return;
        const { registerCorePlugins } = await import('../services/plugins/loader');
        if (isShuttingDown) return;

        // Register Core Plugins
        registerCorePlugins();

        // [R12] Discover + validate + register custom plugins (real ESM load)
        const { registerCustomPlugins } = await import('../services/plugins/loader');
        if (isShuttingDown) return;
        await registerCustomPlugins();

        // Initialize Registry (starts plugins and registers tools)
        await pluginRegistry.initialize();
        console.log('[PLUGINS] ✅ Plugin System initialized with Core Plugins');
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[PLUGINS] Failed to initialize plugin system:', error);
    }

    // [INGESTION] Start Webhook Ingestion Engine
    if (isShuttingDown) return;
    try {
        await import('../services/ingestionEngine');
        console.log('[INGESTION] ✅ Webhook Ingestion Engine online');
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[INGESTION] Failed to start Ingestion Engine:', error);
    }

    // [EVOLUTION] Proactive Self-Evolution is now handled by Unified Daemon

    // [COGNITIVE] Start 4-Tier Memory Cognitive Engines & Evolution (Unified Daemon)
    if (isShuttingDown) return;
    try {
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        if (isShuttingDown) return;
        await unifiedDaemon.start();
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[DAEMON] Failed to start unified daemon:', error);
    }

    // [ORCHESTRATOR] Initialize Agent Lifecycle Manager (auto-starts on import)
    if (isShuttingDown) return;
    try {
        await import('../services/orchestrator');
        console.log('[ORCHESTRATOR] ✅ Agent Lifecycle Manager initialized');

        // [Ticket W7] Wire the capability-awareness writer: it was imported
        // (promptCompiler) but initialize() was never called, so its event
        // subscriptions never existed and universal_knowledge had no writer.
        if (isShuttingDown) return;
    try {
            const { capabilityAwareness } = await import('../services/capabilityAwareness');
            if (isShuttingDown) return;
            await capabilityAwareness.initialize();
            console.log('[CAPABILITY_AWARENESS] ✅ Initialized');
        } catch (caErr) {

            if (isShuttingDown && (caErr instanceof AdmissionClosed || caErr instanceof RuntimeConstructionAdmissionClosed)) return;

            recordRuntimeStartupFailure(caErr);
            console.error('[CAPABILITY_AWARENESS] Init failed (non-fatal):', caErr);
        }
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[ORCHESTRATOR] Failed to initialize orchestrator:', error);
    }

    // [EVOLUTION] Start Self-Evolution Scheduler (respects PowerManager mode)
    if (isShuttingDown) return;
    try {
        const { evolutionScheduler } = await import('../services/evolution/evolutionScheduler');
        if (isShuttingDown) return;
        evolutionScheduler.start();
        console.log('[EVOLUTION] ✅ Evolution Scheduler started');
    } catch (error) {

        if (isShuttingDown && (error instanceof AdmissionClosed || error instanceof RuntimeConstructionAdmissionClosed)) return;

        recordRuntimeStartupFailure(error);
        console.error('[EVOLUTION] Failed to start evolution scheduler:', error);
    }
}
server.once('listening', () => {
    startupEntered = true;
    void completeOriginalStartup().then(finishStartup, failStartup);
});
server.once('error', error => {
    console.error('[HTTP] Original server error:', error);
    if (!startupEntered) failStartup(error);
    void gracefulShutdown('HTTP_SERVER_ERROR').catch(failure => console.error('[SHUTDOWN] Server error drain failed:', failure));
});
installRuntimeRootShutdown(gracefulShutdown);
server.listen(PORT, HOST);

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN - Clean up all resources properly
// ═══════════════════════════════════════════════════════════════
let originalShutdown: Promise<void> | undefined;
function gracefulShutdown(signal: string): Promise<void> {
    isShuttingDown = true;
    if (originalShutdown) return originalShutdown;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    originalShutdown = new Promise<void>((yes, no) => { resolve = yes;reject = no; });
    void performOriginalShutdown(signal).then(resolve, reject);
    return originalShutdown;
}
async function performOriginalShutdown(signal: string): Promise<void> {
    // Arm before any original stop callback. External containment still owns
    // non-cooperative synchronous CPU/native work that cannot service timers.
    const deadline = setTimeout(() => {
        console.error('[SHUTDOWN] Forced exit after timeout; drainage unverified');
        process.exit(1);
    }, 10000);

    console.log(`\n[SHUTDOWN] ${signal} received: shutting down gracefully...`);
    // Full receiver/transitive frontier remains open. Never turn direct
    // transport closure into a successful global-quiescence exit receipt.
    let shutdownFailed = false;
    console.error('[SHUTDOWN] Product lifecycle frontier remains INCOMPLETE');
    const httpClosed = new Promise<void>((resolve, reject) => {
        server.close(error => { if (error) reject(error);else resolve(); });
    });
    // Observe each rejection immediately while independent producers drain.
    const httpReceipt = Promise.allSettled([httpClosed]);
    // Stop original boot callbacks before backend release. Retain joins now,
    // even if a later independent producer throws synchronously.
    const bootTimerReceipts=Promise.allSettled([sealAndDrainBootTimers()]);
    sealEvaluatedRuntimeProducers();
    const producerStops: Promise<unknown>[] = [];
    for (const stop of [
        () => startupGateway?.sealAndDrain(),
        () => startupTerminalGateway?.sealAndCloseDirectSessions(),
    ]) {
        try { producerStops.push(Promise.resolve(stop())); }
        catch (error) { producerStops.push(Promise.reject(error)); }
    }
    const producerReceipts = Promise.allSettled(producerStops);
    // Referenced deadline prevents an unresolved join from silently exiting0.
    // No new graph is imported for these joins. Already-admitted startup may
    // finish its current original import, but later independent phases skip.
    const startupReceipts = await Promise.allSettled([originalStartup,appInitialization]);
    for (const result of [...startupReceipts, ...await producerReceipts, ...await bootTimerReceipts]) {
        if (result.status === 'rejected') { shutdownFailed = true;console.error('[SHUTDOWN] Original startup/producer drain failed:', result.reason); }
    }
    for (const result of await httpReceipt) {
        if (result.status === 'rejected') { shutdownFailed = true;console.error('[SHUTDOWN] HTTP transport close failed:', result.reason); }
    }
    try {
        // Only original evaluated singleton callbacks. No dynamic import here
        // can instantiate a new producer/storage graph during shutdown.
        await drainEvaluatedRuntimeProducers();
    } catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Evaluated producer drain failed:', error);
    }
    try {
        await closeEvaluatedRuntimeStorage();
    } catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Evaluated storage close failed:', error);
    }

    try {
        const report = await stopRuntimeRootHost();
        // Original failed task outcomes remain immutable evidence, not clean
        // task success. A settled task fault alone is not a failed close.
        if (report.ownerFailures) shutdownFailed = true;
        console.error('[SHUTDOWN] Explicit host evidence:', report.state, report.coverage, {ownerFailures:report.ownerFailures,taskOutcomeFailures:report.taskOutcomeFailures,lifetimeFailures:report.lifetimeFailures}, evaluatedRuntimeFrontier());
    } catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Explicit host stop failed:', error);
    }

    console.error('[SHUTDOWN] Boot timer source frontier:',bootTimerFrontier());
    // The original HTTP close callback was already joined above, not issued
    // after backend release. A forced deadline is still an explicit failure.
    // Conventional exit code reflects actual shutdown failures, not the
    // separate INCOMPLETE coverage report. Never force a successful exit.
    // If handles naturally drain, let Node exit. A real survivor reaching the
    // original10s timeout still forces1. Avoid restart-on-failure loops caused
    // solely by honest incomplete bookkeeping, while preserving actual faults.
    process.exitCode = shutdownFailed ? 1 : 0;
    deadline.unref();
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM').catch(error => console.error('[SHUTDOWN] Original shutdown rejected:', error)); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT').catch(error => console.error('[SHUTDOWN] Original shutdown rejected:', error)); });
