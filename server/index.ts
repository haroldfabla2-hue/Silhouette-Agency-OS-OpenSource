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

    // [EVOLUTION] Start Proactive Self-Evolution Scheduler
    try {
        const { evolutionScheduler } = await import('../services/evolution/evolutionScheduler');
        evolutionScheduler.start();
    } catch (error) {
        console.error('[EVOLUTION] Failed to start evolution scheduler:', error);
    }
});

// Graceful Shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: shutting down gracefully...');

    // [EVOLUTION] Flush all pending memory entries before shutdown
    try {
        const { continuousMemory } = await import('../services/memory/continuousMemory');
        continuousMemory.shutdown();
        console.log('[SHUTDOWN] ✅ Continuous Memory flushed');
    } catch { /* ignore if not initialized */ }

    // Shutdown WS Gateway first (notify clients)
    try {
        const { gateway } = await import('./gateway');
        gateway.shutdown();
    } catch { /* ignore if not initialized */ }

    server.close(() => {
        console.log('HTTP server closed');
    });
});
