import { drainCurrentBackend } from './currentBackendDrain';
import { initializeBackendServices } from './backendServices';
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load environment variables FIRST, before any imports
// This is the true entry point - must load env before everything
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load Configuration FIRST (Env -> JSON Migration)
// ═══════════════════════════════════════════════════════════════
import { configLoader } from './config/configLoader';

// Initialize Config (Loads Env or JSON)
const config = configLoader.getConfig();

import { app } from './app';
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

const server = app.listen(PORT, HOST, async () => {
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

    await initializeBackendServices(server, app, PROCESS_STARTED_AT);
});

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN - Clean up all resources properly
// ═══════════════════════════════════════════════════════════════
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[SHUTDOWN] ${signal} received: shutting down gracefully...`);
    const deadline = setTimeout(() => {
        console.error('[SHUTDOWN] Forced exit after timeout; drainage unverified');
        process.exit(1);
    }, 10000);
    deadline.unref();
    const shutdownFailed = !await drainCurrentBackend();

    // 7. Close HTTP server
    server.close(() => {
        console.log('[SHUTDOWN] HTTP server closed');
        clearTimeout(deadline);
        process.exit(shutdownFailed ? 1 : 0);
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
