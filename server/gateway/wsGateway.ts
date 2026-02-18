// =============================================================================
// SILHOUETTE WEBSOCKET GATEWAY
// Central WebSocket control plane.
// Bridges the existing SystemBus with typed WS connections to clients.
// =============================================================================

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { Server as HTTPServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
    Frame,
    RequestFrame,
    ConnectFrame,
    ClientConnection,
    GatewayEvent,
    GatewayMethod,
    PROTOCOL_TO_GATEWAY_EVENT,
    isValidFrame,
    createResponse,
    createErrorResponse,
    createEvent,
} from './protocol';
import { sessionManager } from './sessionManager';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
    HEARTBEAT_INTERVAL_MS: 30_000,
    MAX_PAYLOAD_BYTES: 10 * 1024 * 1024, // 10MB
    HANDSHAKE_TIMEOUT_MS: 5_000,
    IDLE_SWEEP_INTERVAL_MS: 5 * 60_000,   // 5 minutes
    IDEMPOTENCY_TTL_MS: 60_000,           // 1 minute dedup cache
    SERVER_VERSION: '2.2.0',
};

// ─── Gateway Class ───────────────────────────────────────────────────────────

class SilhouetteGateway {
    private wss: WebSocketServer | null = null;
    private connections: Map<string, { ws: WebSocket; conn: ClientConnection }> = new Map();
    private idempotencyCache: Map<string, { result: unknown; expiresAt: number }> = new Map();
    private eventSeq = 0;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private sweepInterval: NodeJS.Timeout | null = null;
    private idempotencyCleanupInterval: NodeJS.Timeout | null = null;

    // ── Initialize ────────────────────────────────────────────────────────

    /**
     * Attach the WebSocket server to an existing HTTP server.
     * This allows WS to share the same port as the Express API.
     */
    initialize(httpServer: HTTPServer): void {
        this.wss = new WebSocketServer({
            server: httpServer,
            path: '/ws',
            maxPayload: CONFIG.MAX_PAYLOAD_BYTES,
        });

        this.wss.on('connection', (ws, req) => {
            const connectionId = uuidv4();
            const ip = req.socket.remoteAddress ?? 'unknown';
            console.log(`[Gateway] 🔌 New WS connection from ${ip} (${connectionId})`);

            // Set handshake timeout — first frame must be `connect`
            const handshakeTimer = setTimeout(() => {
                console.warn(`[Gateway] ⏰ Handshake timeout for ${connectionId}`);
                ws.close(4001, 'Handshake timeout');
            }, CONFIG.HANDSHAKE_TIMEOUT_MS);

            let isHandshakeComplete = false;

            ws.on('message', (data: RawData) => {
                try {
                    const raw = data.toString();
                    const frame = JSON.parse(raw);

                    if (!isValidFrame(frame)) {
                        ws.send(JSON.stringify(createErrorResponse('unknown', 'INVALID_FRAME', 'Invalid frame structure')));
                        return;
                    }

                    // First frame must be `connect`
                    if (!isHandshakeComplete) {
                        if (frame.type !== 'connect') {
                            ws.close(4002, 'First frame must be connect');
                            return;
                        }
                        clearTimeout(handshakeTimer);
                        isHandshakeComplete = true;
                        this.handleConnect(connectionId, ws, frame as ConnectFrame);
                        return;
                    }

                    // Route by frame type
                    if (frame.type === 'req') {
                        this.handleRequest(connectionId, ws, frame as RequestFrame);
                    }
                    // Clients don't send 'res' or 'event' frames (server-only)
                } catch (err) {
                    console.error(`[Gateway] Parse error from ${connectionId}:`, err);
                    ws.send(JSON.stringify(createErrorResponse('unknown', 'PARSE_ERROR', 'Invalid JSON')));
                }
            });

            ws.on('close', (code, reason) => {
                clearTimeout(handshakeTimer);
                this.handleDisconnect(connectionId, code, reason.toString());
            });

            ws.on('error', (err) => {
                console.error(`[Gateway] WS error for ${connectionId}:`, err.message);
            });
        });

        // Start heartbeat loop
        this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), CONFIG.HEARTBEAT_INTERVAL_MS);

        // Start idle session sweep
        this.sweepInterval = setInterval(() => sessionManager.sweepIdleSessions(), CONFIG.IDLE_SWEEP_INTERVAL_MS);

        // Start idempotency cache cleanup
        this.idempotencyCleanupInterval = setInterval(() => this.cleanIdempotencyCache(), CONFIG.IDEMPOTENCY_TTL_MS);

        // Bridge SystemBus events to WS clients
        this.bridgeSystemBusEvents();

        console.log(`[Gateway] 🚀 WebSocket Gateway initialized on /ws`);
    }

    // ── Handshake ─────────────────────────────────────────────────────────

    private handleConnect(connectionId: string, ws: WebSocket, frame: ConnectFrame): void {
        const { clientId, clientType, auth, capabilities, version } = frame.params;

        // Auth Check
        const expectedToken = process.env.SILHOUETTE_API_KEY;
        let authenticated = false;

        if (expectedToken) {
            if (auth?.token === expectedToken) {
                authenticated = true;
            } else {
                console.warn(`[Gateway] 🛑 Auth failed: Invalid/Missing token from ${clientId}`);
                // Instead of hard closing, strictly mark as unauthenticated or close.
                // Protocol says we can close with error frame or error code.
                ws.close(4001, 'Unauthorized');
                return;
            }
        } else {
            // If no token set server-side, we default to open (dev mode) or warn.
            // Given "Perfect" requirement, we should probably warn but allow local if no env set.
            authenticated = true;
        }

        // Create or get a session for this client
        const session = sessionManager.getOrCreateSession(undefined, {
            channel: clientType,
            clientId,
        });

        const conn: ClientConnection = {
            id: connectionId,
            clientId,
            clientType,
            sessionId: session.id,
            connectedAt: Date.now(),
            lastHeartbeat: Date.now(),
            subscriptions: new Set<GatewayEvent>(), // Subscribe to all by default
            authenticated,
            metadata: { version, capabilities, ip: 'local' },
        };

        this.connections.set(connectionId, { ws, conn });

        // Send connect-ok
        ws.send(JSON.stringify({
            type: 'connect-ok',
            sessionId: session.id,
            serverVersion: CONFIG.SERVER_VERSION,
            capabilities: [
                'agent', 'sessions', 'memory', 'tools',
                'channels', 'orchestrator', 'media', 'cron',
                'graph', 'introspection', 'narrative',
            ],
            config: {
                heartbeatIntervalMs: CONFIG.HEARTBEAT_INTERVAL_MS,
                maxPayloadBytes: CONFIG.MAX_PAYLOAD_BYTES,
            },
        }));

        console.log(`[Gateway] ✅ Client connected: ${clientId} (${clientType}) → session ${session.id}`);
    }

    // ── Request Handler ───────────────────────────────────────────────────

    private async handleRequest(connectionId: string, ws: WebSocket, frame: RequestFrame): Promise<void> {
        const { id, method, params, idempotencyKey } = frame;
        const entry = this.connections.get(connectionId);
        if (!entry) return;

        // Check idempotency cache
        if (idempotencyKey) {
            const cached = this.idempotencyCache.get(idempotencyKey);
            if (cached && cached.expiresAt > Date.now()) {
                ws.send(JSON.stringify(createResponse(id, cached.result)));
                return;
            }
        }

        try {
            const result = await this.routeMethod(method, params, entry.conn);

            // Cache result if idempotency key provided
            if (idempotencyKey) {
                this.idempotencyCache.set(idempotencyKey, {
                    result,
                    expiresAt: Date.now() + CONFIG.IDEMPOTENCY_TTL_MS,
                });
            }

            ws.send(JSON.stringify(createResponse(id, result)));
        } catch (err: any) {
            ws.send(JSON.stringify(createErrorResponse(
                id,
                err.code ?? 'INTERNAL_ERROR',
                err.message ?? 'Internal error',
                err.details,
            )));
        }
    }

    // ── Method Router ─────────────────────────────────────────────────────

    /**
     * Routes a method call to the appropriate handler.
     * This is the main dispatch table for all gateway methods.
     */
    private async routeMethod(method: GatewayMethod, params: Record<string, unknown>, conn: ClientConnection): Promise<unknown> {
        switch (method) {
            // ── System ────────────────────────────────────────────────
            case 'health':
                return { status: 'ok', uptime: process.uptime(), connections: this.connections.size };

            case 'status':
                return {
                    connections: this.connections.size,
                    sessions: sessionManager.getStats(),
                    serverVersion: CONFIG.SERVER_VERSION,
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                };

            case 'doctor':
                return this.runDoctor();

            // ── Sessions ──────────────────────────────────────────────
            case 'sessions.list':
                return sessionManager.listSessions(params as any);

            case 'sessions.get':
                return sessionManager.getSession(params.sessionId as string) ?? { error: 'Session not found' };

            case 'sessions.create':
                return sessionManager.createSession(params as any);

            case 'sessions.delete':
                return { deleted: sessionManager.deleteSession(params.sessionId as string) };

            case 'sessions.compact':
                return { compacted: sessionManager.compactSession(params.sessionId as string, params.keepRecent as number) };

            case 'sessions.history':
                return sessionManager.getHistory(params.sessionId as string, params as any);

            // ── Agent ─────────────────────────────────────────────────
            case 'agent.send': {
                // Route user message to the orchestrator via SystemBus
                const sessionId = (params.sessionId as string) ?? conn.sessionId;
                const message = params.message as string;

                // Add to session history
                sessionManager.addMessage(sessionId, {
                    role: 'user',
                    content: message,
                    metadata: { channel: conn.clientType },
                });

                // Emit to SystemBus for orchestrator to pick up
                systemBus.emit(SystemProtocol.USER_MESSAGE, {
                    sessionId,
                    message,
                    clientId: conn.clientId,
                    channel: conn.clientType,
                    timestamp: Date.now(),
                }, conn.clientId);

                return { sessionId, status: 'sent', queued: true };
            }

            case 'agent.status': {
                const { orchestrator } = await import('../../services/orchestrator');
                const agents = orchestrator.getAgents().map(a => ({
                    id: a.id,
                    name: a.name,
                    status: a.status,
                    role: a.role
                }));
                return { status: 'active', agents };
            }

            // ── Channels ──────────────────────────────────────────────
            case 'channels.list': {
                const { channelRouter } = await import('../channels/channelRouter');
                return { channels: channelRouter.getStatus() };
            }

            case 'channels.send': {
                const { channelRouter } = await import('../channels/channelRouter');
                const { channel, message } = params;
                // message is OutgoingMessage
                const result = await channelRouter.send(channel as string, message as any);
                return { id: result, success: !!result };
            }

            // ── Skills ────────────────────────────────────────────────
            case 'skills.list': {
                const { skillRegistry } = await import('../../services/skills/skillRegistry');
                return { skills: skillRegistry.list() };
            }

            case 'skills.search': {
                const { skillRegistry } = await import('../../services/skills/skillRegistry');
                return { results: skillRegistry.search(params.query as string) };
            }

            case 'skills.get': {
                const { skillRegistry } = await import('../../services/skills/skillRegistry');
                return { skill: skillRegistry.get(params.name as string) };
            }

            // ── Security ──────────────────────────────────────────────
            case 'security.status': {
                const { securityManager } = await import('../../services/security/securityManager');
                return {
                    policy: securityManager.getPolicy(),
                    stats: securityManager.getStats(),
                };
            }

            case 'security.pending': {
                const { securityManager } = await import('../../services/security/securityManager');
                return { requests: securityManager.getPendingApprovals() };
            }

            case 'security.approve': {
                const { securityManager } = await import('../../services/security/securityManager');
                return { result: securityManager.approve(params.id as string, conn.clientId) };
            }

            case 'security.deny': {
                const { securityManager } = await import('../../services/security/securityManager');
                return { result: securityManager.deny(params.id as string, conn.clientId) };
            }

            // ── Browser ──────────────────────────────────────────────
            case 'browser.action': {
                const { browserController } = await import('../../services/browser/browserController');
                // Execute a browser action (navigate, click, etc.)
                return await browserController.execute(params.action as any, params.pageId as string);
            }

            case 'browser.scrape': {
                const { browserController } = await import('../../services/browser/browserController');
                return await browserController.scrapeUrl(params.url as string, params.selector as string);
            }

            case 'browser.screenshot': {
                const { browserController } = await import('../../services/browser/browserController');
                return await browserController.screenshotUrl(params.url as string, !!params.fullPage);
            }

            case 'browser.status': {
                const { browserController } = await import('../../services/browser/browserController');
                return browserController.getStatus();
            }

            // ── Memory ────────────────────────────────────────────────
            // ── Memory ────────────────────────────────────────────────
            case 'memory.search': {
                const { continuum } = await import('../../services/continuumMemory');
                const results = await continuum.retrieve(
                    params.query as string,
                    params.type as any, // Optional type filter
                    undefined
                );
                // Manual limit
                const limit = params.limit as number || 5;
                return { results: results.slice(0, limit) };
            }

            case 'memory.write': {
                const { continuum } = await import('../../services/continuumMemory');
                await continuum.store(
                    params.content as string,
                    undefined,
                    params.tags as string[]
                );
                return { success: true };
            }

            // ── Tools ─────────────────────────────────────────────────
            // ── Tools ─────────────────────────────────────────────────
            case 'tools.list': {
                const { toolRegistry } = await import('../../services/tools/toolRegistry');
                return { tools: toolRegistry.getAllTools() };
            }

            // ── Orchestrator ──────────────────────────────────────────
            // ── Orchestrator ──────────────────────────────────────────
            case 'orchestrator.metrics': {
                const { orchestrator } = await import('../../services/orchestrator');
                return {
                    // Accessing private stats via any cast or if we add a getter.
                    // For now, assuming we assume orchestrator has a public getter for stats or we construct basic ones.
                    activeAgents: orchestrator.getActiveCount(),
                    // activeTasks: (orchestrator as any).activeTasks?.size || 0 
                };
            }

            // ── Graph ─────────────────────────────────────────────────
            // ── Graph ─────────────────────────────────────────────────
            case 'graph.health': {
                try {
                    const { graph } = await import('../../services/graphService');
                    return {
                        status: graph.isConnectedStatus() ? 'connected' : 'disconnected',
                        // Graph service doesn't expose public stats, so we return simple status
                        connected: graph.isConnectedStatus()
                    };
                } catch {
                    return { status: 'disconnected' };
                }
            }

            // ── Scheduler (NLP) ───────────────────────────────────────
            case 'scheduler.nlp': {
                const { schedulerService } = await import('../../services/schedulerService');
                const result = schedulerService.scheduleNaturalLanguage(
                    params.instruction as string,
                    { type: 'CUSTOM', payload: params.payload || {} }
                );
                return { success: !!result, taskId: result };
            }

            default:
                throw { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${method}` };
        }
    }

    // ── Doctor (System Diagnostics) ───────────────────────────────────────

    private async runDoctor(): Promise<Record<string, unknown>> {
        const checks: Record<string, { status: string; message: string }> = {};

        // Check Gateway
        checks['gateway'] = {
            status: 'ok',
            message: `WebSocket server running with ${this.connections.size} connections`,
        };

        // Check Sessions
        const sessionStats = sessionManager.getStats();
        checks['sessions'] = {
            status: 'ok',
            message: `${sessionStats.total} sessions (${sessionStats.active} active, ${sessionStats.idle} idle)`,
        };

        // Check Memory
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        checks['memory'] = {
            status: heapUsedMB > 500 ? 'warning' : 'ok',
            message: `Heap used: ${heapUsedMB}MB`,
        };

        // Check SystemBus
        const recentEvents = systemBus.getRecentEvents();
        checks['systemBus'] = {
            status: 'ok',
            message: `${recentEvents.length} recent events in log`,
        };

        return {
            timestamp: Date.now(),
            version: CONFIG.SERVER_VERSION,
            checks,
            overall: Object.values(checks).every(c => c.status === 'ok') ? 'healthy' : 'degraded',
        };
    }

    // ── SystemBus Bridge ──────────────────────────────────────────────────

    /**
     * Subscribe to SystemProtocol events and forward them to connected WS clients.
     */
    private bridgeSystemBusEvents(): void {
        // Subscribe to all mapped protocols
        for (const [protocol, gatewayEvent] of Object.entries(PROTOCOL_TO_GATEWAY_EVENT)) {
            systemBus.subscribe(protocol as SystemProtocol, (payload) => {
                this.broadcast(gatewayEvent!, payload);
            });
        }

        console.log(`[Gateway] 🔗 Bridged ${Object.keys(PROTOCOL_TO_GATEWAY_EVENT).length} SystemProtocol events to WebSocket`);
    }

    // ── Broadcasting ──────────────────────────────────────────────────────

    /**
     * Broadcast an event to all connected clients.
     */
    broadcast(event: GatewayEvent, payload: unknown): void {
        const frame = createEvent(event, payload, ++this.eventSeq);
        const data = JSON.stringify(frame);

        for (const { ws, conn } of this.connections.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                // Check subscription filter (empty set = subscribe to all)
                if (conn.subscriptions.size === 0 || conn.subscriptions.has(event)) {
                    try {
                        ws.send(data);
                    } catch (err) {
                        console.error(`[Gateway] Failed to send to ${conn.clientId}:`, err);
                    }
                }
            }
        }
    }

    /**
     * Send an event to a specific client by connection ID.
     */
    sendTo(connectionId: string, event: GatewayEvent, payload: unknown): void {
        const entry = this.connections.get(connectionId);
        if (!entry || entry.ws.readyState !== WebSocket.OPEN) return;

        try {
            entry.ws.send(JSON.stringify(createEvent(event, payload, ++this.eventSeq)));
        } catch (err) {
            console.error(`[Gateway] Failed to send to ${connectionId}:`, err);
        }
    }

    /**
     * Send an event to all clients connected to a specific session.
     */
    sendToSession(sessionId: string, event: GatewayEvent, payload: unknown): void {
        for (const { ws, conn } of this.connections.values()) {
            if (conn.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(createEvent(event, payload, ++this.eventSeq)));
                } catch (err) {
                    console.error(`[Gateway] Failed to send to session ${sessionId}:`, err);
                }
            }
        }
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────

    private sendHeartbeats(): void {
        const frame = createEvent('heartbeat', {
            timestamp: Date.now(),
            connections: this.connections.size,
        }, ++this.eventSeq);
        const data = JSON.stringify(frame);

        for (const [id, { ws, conn }] of this.connections.entries()) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(data);
                    conn.lastHeartbeat = Date.now();
                } catch {
                    // Connection dead, will be cleaned up
                }
            } else {
                this.connections.delete(id);
            }
        }
    }

    // ── Disconnect ────────────────────────────────────────────────────────

    private handleDisconnect(connectionId: string, code: number, reason: string): void {
        const entry = this.connections.get(connectionId);
        if (entry) {
            console.log(`[Gateway] 🔌 Client disconnected: ${entry.conn.clientId} (code: ${code}, reason: ${reason})`);
        }
        this.connections.delete(connectionId);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    private cleanIdempotencyCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.idempotencyCache.entries()) {
            if (entry.expiresAt < now) {
                this.idempotencyCache.delete(key);
            }
        }
    }

    // ── Shutdown ───────────────────────────────────────────────────────────

    shutdown(): void {
        console.log('[Gateway] 🛑 Shutting down WebSocket Gateway...');

        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.sweepInterval) clearInterval(this.sweepInterval);
        if (this.idempotencyCleanupInterval) clearInterval(this.idempotencyCleanupInterval);

        // Notify all clients
        this.broadcast('shutdown', { reason: 'Server shutting down' });

        // Close all connections
        for (const { ws } of this.connections.values()) {
            ws.close(1001, 'Server shutting down');
        }
        this.connections.clear();

        if (this.wss) {
            this.wss.close();
        }
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    getStats() {
        return {
            connections: this.connections.size,
            clientTypes: this.getClientTypeCounts(),
            sessions: sessionManager.getStats(),
            eventSeq: this.eventSeq,
        };
    }

    private getClientTypeCounts(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const { conn } of this.connections.values()) {
            counts[conn.clientType] = (counts[conn.clientType] ?? 0) + 1;
        }
        return counts;
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const gateway = new SilhouetteGateway();
