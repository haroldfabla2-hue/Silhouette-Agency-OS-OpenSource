import { registerStarted, startedResourcesBound } from './desktop/startedResources.js';
// Shared existing startup sequence, mechanically extracted for desktop source review.
import type { Server } from 'node:http';
import type { Express } from 'express';
export async function initializeBackendServices(server: Server, app: Express, PROCESS_STARTED_AT: number): Promise<void> {
    // [LEDGER-INTEGRITY] Close ledger rows left open by previous process
    // lives: a restart strands pending/running rows whose executor is
    // gone. Signal verified in code: these rows are unambiguous orphans -
    // the only executor that could advance them ran in the dead process,
    // and mission resume (workflowEngine.executeMissionBuild) always
    // generates a NEW planId via planGenerator.create and overwrites
    // pipelineData.planId, so no resume path ever re-drives a pre-boot
    // row. They are failed honestly (never deleted); re-running the
    // mission is the recovery path.
    try {
        const { reapStaleTasks } = await import('../services/execution/taskLedger');
        reapStaleTasks(PROCESS_STARTED_AT, 'executor lost: process restart (ledger row predates this boot)');
    } catch (e: any) {
        console.warn('[BOOT] stale task sweep failed (non-blocking):', e?.message);
    }

    // [GATEWAY] Initialize WebSocket Gateway (shares HTTP server)
    try {
        const { gateway } = await import('./gateway');
        gateway.initialize(server);
        registerStarted('websocket-gateway', {stopAdmission: () => gateway.shutdown()});
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
        if (startedResourcesBound()) {
            const { channelRouter } = await import('./channels/channelRouter');
            registerStarted('messaging-channels', {stopAdmission: () => channelRouter.disconnectAll()});
        }
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

        // [R12] Discover + validate + register custom plugins (real ESM load)
        const { registerCustomPlugins } = await import('../services/plugins/loader');
        await registerCustomPlugins();

        // Initialize Registry (starts plugins and registers tools)
        await pluginRegistry.initialize();
        registerStarted('plugins', {stopAdmission: () => pluginRegistry.shutdown()});
        console.log('[PLUGINS] ✅ Plugin System initialized with Core Plugins');
    } catch (error) {
        console.error('[PLUGINS] Failed to initialize plugin system:', error);
    }

    // [INGESTION] Start Webhook Ingestion Engine
    try {
        await import('../services/ingestionEngine');
        console.log('[INGESTION] ✅ Webhook Ingestion Engine online');
    } catch (error) {
        console.error('[INGESTION] Failed to start Ingestion Engine:', error);
    }

    // [EVOLUTION] Proactive Self-Evolution is now handled by Unified Daemon

    // [COGNITIVE] Start 4-Tier Memory Cognitive Engines & Evolution (Unified Daemon)
    try {
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        if (startedResourcesBound()) {
            await unifiedDaemon.start();
            registerStarted('unified-daemon', {stopAdmission: () => unifiedDaemon.stopAdmission(), flush: () => unifiedDaemon.flushStoppedState()});
        } else unifiedDaemon.start();
    } catch (error) {
        console.error('[DAEMON] Failed to start unified daemon:', error);
    }

    // [ORCHESTRATOR] Initialize Agent Lifecycle Manager (auto-starts on import)
    try {
        await import('../services/orchestrator');
        console.log('[ORCHESTRATOR] ✅ Agent Lifecycle Manager initialized');

        // [Ticket W7] Wire the capability-awareness writer: it was imported
        // (promptCompiler) but initialize() was never called, so its event
        // subscriptions never existed and universal_knowledge had no writer.
        try {
            const { capabilityAwareness } = await import('../services/capabilityAwareness');
            await capabilityAwareness.initialize();
            console.log('[CAPABILITY_AWARENESS] ✅ Initialized');
        } catch (caErr) {
            console.error('[CAPABILITY_AWARENESS] Init failed (non-fatal):', caErr);
        }
    } catch (error) {
        console.error('[ORCHESTRATOR] Failed to initialize orchestrator:', error);
    }

    // [EVOLUTION] Start Self-Evolution Scheduler (respects PowerManager mode)
    try {
        const { evolutionScheduler } = await import('../services/evolution/evolutionScheduler');
        evolutionScheduler.start();
        registerStarted('evolution-scheduler', {stopAdmission: () => evolutionScheduler.stop()});
        console.log('[EVOLUTION] ✅ Evolution Scheduler started');
    } catch (error) {
        console.error('[EVOLUTION] Failed to start evolution scheduler:', error);
    }
}
