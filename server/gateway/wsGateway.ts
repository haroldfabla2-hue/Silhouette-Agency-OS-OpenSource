import { ResourceScope, type ScopeReport } from '../runtime/resourceScope';
import { ownWebSocket, ownWebSocketServer } from '../runtime/webSocketOwnership';
import { subscribeScoped } from '../../services/runtime/scopedSubscription';
// =============================================================================
// SILHOUETTE WEBSOCKET GATEWAY
// Central WebSocket control plane.
// Bridges the existing SystemBus with typed WS connections to clients.
// =============================================================================

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { Server as HTTPServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
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
    private readonly operations = new ResourceScope('ws-gateway');
    private closeTask?: Promise<ScopeReport>;
    public getLifecycleStatus() { return { failures: this.operations.getFailures(), diagnostics: this.operations.getDiagnostics() }; }
    private retainSend(ws: WebSocket, data: string): void {
        void this.operations.run('ws-send', () => new Promise<void>((resolve, reject) => {
            ws.send(data, error => error ? reject(error) : resolve());
        })).catch(() => undefined);
    }
    private wss: WebSocketServer | null = null;
    private connections: Map<string, { ws: WebSocket; conn: ClientConnection }> = new Map();
    private idempotencyCache: Map<string, { result: unknown; expiresAt: number }> = new Map();
    private eventSeq = 0;
    private replyRoutes = new Map<string, {connectionId:string;sessionId:string;expiresAt:number}>();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private sweepInterval: NodeJS.Timeout | null = null;
    private idempotencyCleanupInterval: NodeJS.Timeout | null = null;

    // ── Initialize ────────────────────────────────────────────────────────

    /**
     * Attach the WebSocket server to an existing HTTP server.
     * This allows WS to share the same port as the Express API.
     */
    initialize(httpServer: HTTPServer): void {
        this.operations.assertWorkAccepted();

        this.operations.assertAccepting();
        if (this.wss) throw new Error('WebSocket gateway already initialized');
        this.wss = new WebSocketServer({
            server: httpServer,
            path: '/ws',
            maxPayload: CONFIG.MAX_PAYLOAD_BYTES,
        });

        ownWebSocketServer(this.operations, this.wss, 'gateway-ws-server');
        const onConnection = (ws: WebSocket, req: import('http').IncomingMessage) => {
            const connectionId = uuidv4();
            const ip = req.socket.remoteAddress ?? 'unknown';
            console.log(`[Gateway] 🔌 New WS connection from ${ip} (${connectionId})`);

            let onMessage: (data: RawData) => void = () => undefined;
            const stopMessages = () => ws.off('message', onMessage);
            const onError = (error: Error) => this.operations.recordDiagnostic('gateway-client', error, 'OPERATION_REJECTED', 'UNAVAILABLE');
            ws.on('error', onError);
            ws.once('close', () => ws.off('error', onError));
            ownWebSocket(this.operations, ws, `gateway-client:${connectionId}`, stopMessages);
            if (!this.operations.accepting) { ws.close(1001, 'Server shutting down'); return; }
            // Original five-second handshake bound, owned through reply/close.
            const handshakeTimer = setTimeout(() => {
                console.warn(`[Gateway] ⏰ Handshake timeout for ${connectionId}`);
                ws.close(4001, 'Handshake timeout');
            }, CONFIG.HANDSHAKE_TIMEOUT_MS);
            const releaseHandshake = this.operations.own({ name: `gateway-handshake:${connectionId}`, stopIntake: () => clearTimeout(handshakeTimer), close: () => clearTimeout(handshakeTimer) });

            let isHandshakeComplete = false;

            onMessage = (data: RawData) => {
                if (!this.operations.accepting) return;
                try {
                    const raw = data.toString();
                    const frame = JSON.parse(raw);

                    if (!isValidFrame(frame)) {
                        this.retainSend(ws, JSON.stringify(createErrorResponse('unknown', 'INVALID_FRAME', 'Invalid frame structure')));
                        return;
                    }

                    // First frame must be `connect`
                    if (!isHandshakeComplete) {
                        if (frame.type !== 'connect') {
                            ws.close(4002, 'First frame must be connect');
                            return;
                        }
                        void releaseHandshake();
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
                    this.retainSend(ws, JSON.stringify(createErrorResponse('unknown', 'PARSE_ERROR', 'Invalid JSON')));
                }
            };
            ws.on('message', onMessage);

            ws.on('close', (code, reason) => {
                stopMessages();
                ws.off('error', onError);
                void releaseHandshake();
                this.handleDisconnect(connectionId, code, reason.toString());
            });

        };
        const wss = this.wss;
        wss.on('connection', onConnection);
        this.operations.own({ name: 'gateway-connection-hook', closeRank: -200, close: () => { wss.off('connection', onConnection); } });

        // Start heartbeat loop
        this.heartbeatInterval = setInterval(() => { if (this.operations.accepting) this.sendHeartbeats(); }, CONFIG.HEARTBEAT_INTERVAL_MS);
        const heartbeatInterval = this.heartbeatInterval;
        this.operations.own({ name: 'heartbeatInterval', stopIntake: () => clearInterval(heartbeatInterval), close: () => clearInterval(heartbeatInterval) });

        // Start idle session sweep
        this.sweepInterval = setInterval(() => { if (this.operations.accepting) sessionManager.sweepIdleSessions(); }, CONFIG.IDLE_SWEEP_INTERVAL_MS);
        const sweepInterval = this.sweepInterval;
        this.operations.own({ name: 'sweepInterval', stopIntake: () => clearInterval(sweepInterval), close: () => clearInterval(sweepInterval) });

        // Start idempotency cache cleanup
        this.idempotencyCleanupInterval = setInterval(() => { if (this.operations.accepting) this.cleanIdempotencyCache(); }, CONFIG.IDEMPOTENCY_TTL_MS);
        const idempotencyCleanupInterval = this.idempotencyCleanupInterval;
        this.operations.own({ name: 'idempotencyCleanupInterval', stopIntake: () => clearInterval(idempotencyCleanupInterval), close: () => clearInterval(idempotencyCleanupInterval) });

        // Bridge SystemBus events to WS clients
        this.bridgeSystemBusEvents();

        console.log(`[Gateway] 🚀 WebSocket Gateway initialized on /ws`);
    }

    // ── Handshake ─────────────────────────────────────────────────────────

    private handleConnect(connectionId: string, ws: WebSocket, frame: ConnectFrame): void {
        const { clientId, clientType, auth, capabilities, version } = frame.params;

        // Auth Check
        const expectedToken = process.env.SILHOUETTE_API_KEY || process.env.SILHOUETTE_API_TOKEN;
        let authenticated = false;

        if (expectedToken) {
            if (auth?.token === expectedToken) {
                authenticated = true;
            } else {
                console.warn(`[Gateway] 🛑 Auth failed: Invalid/Missing token from ${clientId}`);
                ws.close(4001, 'Unauthorized');
                return;
            }
        } else {
            // [SECURITY HARDENING] Refuse unauthenticated connections in production
            if (process.env.NODE_ENV === 'production') {
                console.error(`[Gateway] 🛑 FATAL: No SILHOUETTE_API_KEY set in production! Rejecting connection from ${clientId}`);
                ws.close(4001, 'Unauthorized (Server Configuration Error)');
                return;
            }
            // Allow in local dev mode if no env set
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
        this.retainSend(ws, JSON.stringify({
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
        return this.operations.run('handleRequest', async () => {

        const { id, method, params, idempotencyKey } = frame;
        const entry = this.connections.get(connectionId);
        if (!entry) return;

        // Check idempotency cache
        if (idempotencyKey) {
            const cached = this.idempotencyCache.get(`${connectionId}:${idempotencyKey}`);
            if (cached && cached.expiresAt > Date.now()) {
                this.retainSend(ws, JSON.stringify(createResponse(id, cached.result)));
                return;
            }
        }

        try {
            const result = await this.routeMethod(method, params, entry.conn);

            // Cache result if idempotency key provided
            if (idempotencyKey) {
                this.idempotencyCache.set(`${connectionId}:${idempotencyKey}`, {
                    result,
                    expiresAt: Date.now() + CONFIG.IDEMPOTENCY_TTL_MS,
                });
            }

            this.retainSend(ws, JSON.stringify(createResponse(id, result)));
        } catch (err: any) {
            this.retainSend(ws, JSON.stringify(createErrorResponse(
                id,
                err.code ?? 'INTERNAL_ERROR',
                err.message ?? 'Internal error',
                err.details,
            )));
        }
    
        });
    }

    // ── Method Router ─────────────────────────────────────────────────────

    /**
     * Routes a method call to the appropriate handler.
     * This is the main dispatch table for all gateway methods.
     */
    private async routeMethod(method: GatewayMethod, params: Record<string, unknown>, conn: ClientConnection): Promise<unknown> {
        return this.operations.run('routeMethod', async () => {

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
                if (!sessionManager.getSession(sessionId)) throw new Error('Reply session unavailable');
                if (typeof message !== 'string' || !message.trim()) throw new Error('Message text is required');
                // The return route is issued here, never accepted from params.
                // Bind to this connection, not the shared personal session.
                const replyRoute = this.issueReplyRoute(conn.id, sessionId);
                if (!replyRoute) throw new Error('Reply connection unavailable');

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
                    replyRoute,
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
                    // Truthful backend: 'connected' only when Neo4j really answers; SQLite fallback is 'degraded'.
                    const b = graph.getBackendStatus();
                    return {
                        status: b.backend === 'neo4j' ? 'connected' : b.backend === 'disabled' ? 'disabled' : 'degraded',
                        backend: b.backend,
                        connected: b.connected
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
    
        });
    }

    // ── Doctor (System Diagnostics) ───────────────────────────────────────

    private async runDoctor(): Promise<Record<string, unknown>> {
        return this.operations.run('runDoctor', async () => {

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
    
        });
    }

    // ── SystemBus Bridge ──────────────────────────────────────────────────

    /**
     * Subscribe to SystemProtocol events and forward them to connected WS clients.
     */
    private bridgeSystemBusEvents(): void {
        // Subscribe to all mapped protocols
        for (const [protocol, gatewayEvent] of Object.entries(PROTOCOL_TO_GATEWAY_EVENT)) {
            subscribeScoped(this.operations, systemBus, protocol as SystemProtocol, (payload) => {
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
        this.operations.assertWorkAccepted();

        const frame = createEvent(event, payload, ++this.eventSeq);
        const data = JSON.stringify(frame);

        for (const { ws, conn } of this.connections.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                // Check subscription filter (empty set = subscribe to all)
                if (conn.subscriptions.size === 0 || conn.subscriptions.has(event)) {
                    try {
                        this.retainSend(ws, data);
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
        this.operations.assertWorkAccepted();

        const entry = this.connections.get(connectionId);
        if (!entry || entry.ws.readyState !== WebSocket.OPEN) return;

        try {
            this.retainSend(entry.ws, JSON.stringify(createEvent(event, payload, ++this.eventSeq)));
        } catch (err) {
            console.error(`[Gateway] Failed to send to ${connectionId}:`, err);
        }
    }

    /**
     * Send an event to all clients connected to a specific session.
     */
    sendToSession(sessionId: string, event: GatewayEvent, payload: unknown): void {
        this.operations.assertWorkAccepted();

        for (const { ws, conn } of this.connections.values()) {
            if (conn.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
                try {
                    this.retainSend(ws, JSON.stringify(createEvent(event, payload, ++this.eventSeq)));
                } catch (err) {
                    console.error(`[Gateway] Failed to send to session ${sessionId}:`, err);
                }
            }
        }
    }

    /** Internal ingress helper. A connection route never grants tool authority. */
    issueReplyRoute(connectionId:string, sessionId?:string):string|null {
        this.operations.assertWorkAccepted();

        const entry=this.connections.get(connectionId);
        if(!entry || entry.ws.readyState!==WebSocket.OPEN) return null;
        const destinationSession=sessionId ?? entry.conn.sessionId;
        if(!sessionManager.getSession(destinationSession)) return null;
        const token=uuidv4();
        this.replyRoutes.set(token,{connectionId,sessionId:destinationSession,expiresAt:Date.now()+10*60_000});
        return token;
    }

    /** One-shot route from an accepted gateway connection. A successful send
     * callback is transport acceptance only, not remote read acknowledgement. */
    async deliverReply(replyRoute:string, text:string, media?:unknown[]):Promise<string|null> {
        return this.operations.run('deliverReply', async () => {

        const route=this.replyRoutes.get(replyRoute);
        this.replyRoutes.delete(replyRoute); // Uncertainty must never cause a retry.
        if(!route || route.expiresAt<Date.now()) return null;
        const entry=this.connections.get(route.connectionId);
        if(!entry || entry.ws.readyState!==WebSocket.OPEN || !sessionManager.getSession(route.sessionId)) return null;
        const message={id:uuidv4(),role:'agent',content:text,timestamp:Date.now()};
        const frame=createEvent('session.message',{sessionId:route.sessionId,message,...(media?{media}:{})},++this.eventSeq);
        this.operations.assertAccepting();
        const accepted=await new Promise<boolean>(resolve=>{
            let settled = false;
            let release: () => Promise<void> = async () => undefined;
            const finish = (accepted: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(deadline);
                resolve(accepted);
                void release();
            };
            const deadline=setTimeout(()=>finish(false),2000);
            release = this.operations.own({ name: 'gateway-reply-callback', stopIntake: () => finish(false), close: () => clearTimeout(deadline) });
            try{entry.ws.send(JSON.stringify(frame),error=>finish(!error));}
            catch{finish(false);}
        });
        if(!accepted) return null;
        try{sessionManager.addMessage(route.sessionId,{role:'agent',content:text,metadata:{channel:entry.conn.clientType}});}
        catch(error){console.error('[Gateway] Reply accepted; session history receipt unverified, do not resend:',error);}
        return message.id;
    
        });
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
                    this.retainSend(ws, data);
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
        for(const [token,route] of this.replyRoutes) if(route.connectionId===connectionId) this.replyRoutes.delete(token);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    private cleanIdempotencyCache(): void {
        const now = Date.now();
        for(const [token,route] of this.replyRoutes) if(route.expiresAt<now) this.replyRoutes.delete(token);
        for (const [key, entry] of this.idempotencyCache.entries()) {
            if (entry.expiresAt < now) {
                this.idempotencyCache.delete(key);
            }
        }
    }

    // ── Shutdown ───────────────────────────────────────────────────────────

    shutdown(): Promise<ScopeReport> {
        if (!this.closeTask) {
            if (this.operations.accepting) this.broadcast('shutdown', { reason: 'Server shutting down' });
            this.closeTask = this.operations.close().then(report => {
                this.connections.clear();
                this.replyRoutes.clear();
                return report;
            });
        }
        return this.closeTask;
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    getStats() {
        this.operations.assertWorkAccepted();

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
