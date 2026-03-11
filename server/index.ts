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

const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
    -------------------------------------------
    SILHOUETTE AGENCY OS IS ONLINE
    -------------------------------------------
    ► API Gateway:  http://localhost:${PORT}
    ► WS Gateway:   ws://localhost:${PORT}/ws
    ► Environment:  ${process.env.NODE_ENV || 'development'}
    -------------------------------------------
    `);

    // [GATEWAY] Initialize WebSocket Gateway (shares HTTP server)
    try {
        const { gateway } = await import('./gateway');
        gateway.initialize(server);
        console.log('[GATEWAY] ✅ WebSocket Gateway initialized');
    } catch (error) {
        console.error('[GATEWAY] Failed to initialize WebSocket Gateway:', error);
    }

    // [TERMINAL] Initialize Interactive Terminal WebSocket
    try {
        const { TerminalGateway } = await import('./channels/terminalWebSocket');
        TerminalGateway.initialize(server);
    } catch (error) {
        console.error('[TERMINAL] Failed to initialize Terminal Gateway:', error);
    }


    // [CHANNELS] Initialize Messaging Channels (WhatsApp, Telegram, Discord)
    try {
        const { initializeChannels } = await import('./channels');
        await initializeChannels();
    } catch (error) {
        console.error('[CHANNELS] Failed to initialize channels:', error);
    }

    // [MCP] Initialize and Mount Standard MCP Server
    try {
        const { mcpWrapper } = await import('./mcp/mcpServer');
        await mcpWrapper.initialize();
        await mcpWrapper.mount(app);
    } catch (error) {
        console.error('[MCP] Failed to initialize standard MCP server:', error);
    }

    // [PLUGINS] Initialize Plugin System (Phase 14)
    try {
        const { pluginRegistry } = await import('../services/plugins/pluginRegistry');
        const { registerCorePlugins } = await import('../services/plugins/loader');

        // Register Core Plugins
        registerCorePlugins();

        // Initialize Registry (starts plugins and registers tools)
        await pluginRegistry.initialize();
        console.log('[PLUGINS] ✅ Plugin System initialized with Core Plugins');
    } catch (error) {
        console.error('[PLUGINS] Failed to initialize plugin system:', error);
    }

    // [INGESTION] Start Webhook Ingestion Engine
    try {
        const { ingestionEngine } = await import('../services/ingestionEngine');
        console.log('[INGESTION] ✅ Webhook Ingestion Engine online');
    } catch (error) {
        console.error('[INGESTION] Failed to start Ingestion Engine:', error);
    }

    // [EVOLUTION] Proactive Self-Evolution is now handled by Unified Daemon

    // [COGNITIVE] Start 4-Tier Memory Cognitive Engines & Evolution (Unified Daemon)
    try {
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        unifiedDaemon.start();
    } catch (error) {
        console.error('[DAEMON] Failed to start unified daemon:', error);
    }

    // [ORCHESTRATOR] Initialize Agent Lifecycle Manager (auto-starts on import)
    try {
        await import('../services/orchestrator');
        console.log('[ORCHESTRATOR] ✅ Agent Lifecycle Manager initialized');
    } catch (error) {
        console.error('[ORCHESTRATOR] Failed to initialize orchestrator:', error);
    }

    // [EVOLUTION] Start Self-Evolution Scheduler (respects PowerManager mode)
    try {
        const { evolutionScheduler } = await import('../services/evolution/evolutionScheduler');
        evolutionScheduler.start();
        console.log('[EVOLUTION] ✅ Evolution Scheduler started');
    } catch (error) {
        console.error('[EVOLUTION] Failed to start evolution scheduler:', error);
    }
});

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN - Clean up all resources properly
// ═══════════════════════════════════════════════════════════════
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[SHUTDOWN] ${signal} received: shutting down gracefully...`);

    // 1. Flush pending memory entries
    try {
        const { continuousMemory } = await import('../services/memory/continuousMemory');
        continuousMemory.shutdown();
        console.log('[SHUTDOWN] Continuous Memory flushed');
    } catch { /* ignore if not initialized */ }

    // 2. Shutdown WS Gateway (notify clients)
    try {
        const { gateway } = await import('./gateway');
        gateway.shutdown();
        console.log('[SHUTDOWN] WebSocket Gateway closed');
    } catch { /* ignore if not initialized */ }

    // 3. Disconnect Redis
    try {
        const { redisClient } = await import('../services/redisClient');
        await redisClient.disconnect();
        console.log('[SHUTDOWN] Redis disconnected');
    } catch { /* ignore if not initialized */ }

    // 4. Disconnect Neo4j
    try {
        const { graph } = await import('../services/graphService');
        await graph.close();
        console.log('[SHUTDOWN] Neo4j disconnected');
    } catch { /* ignore if not initialized */ }

    // 5. Close SQLite
    try {
        const { sqliteService } = await import('../services/sqliteService');
        sqliteService.close();
        console.log('[SHUTDOWN] SQLite closed');
    } catch { /* ignore if not initialized */ }

    // 6. Stop Unified Daemon
    try {
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        unifiedDaemon.stop();
        console.log('[SHUTDOWN] Unified Daemon stopped');
    } catch { /* ignore if not initialized */ }

    // 7. Close HTTP server
    server.close(() => {
        console.log('[SHUTDOWN] HTTP server closed');
        process.exit(0);
    });

    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced exit after timeout');
        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
