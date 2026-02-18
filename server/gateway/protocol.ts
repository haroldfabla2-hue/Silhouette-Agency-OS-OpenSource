// =============================================================================
// SILHOUETTE GATEWAY PROTOCOL
// Typed WebSocket protocol for Silhouette AGI.
// All client↔server communication uses JSON frames over WebSocket.
// =============================================================================

import { SystemProtocol } from '../../types';

// ─── Frame Types ─────────────────────────────────────────────────────────────

/**
 * Base frame type discriminator.
 * Every frame sent over the WS must have a `type` field.
 */
export type FrameType = 'req' | 'res' | 'event' | 'connect' | 'connect-ok';

/**
 * Client → Server: Request frame.
 * The client sends a request with a unique `id` and expects a response with the same `id`.
 */
export interface RequestFrame {
    type: 'req';
    id: string;            // UUID — unique per request, used for correlation
    method: GatewayMethod; // The method to invoke
    params: Record<string, unknown>;
    idempotencyKey?: string; // For safe retries on side-effecting methods
}

/**
 * Server → Client: Response frame.
 * Correlated by `id` to the original request.
 */
export interface ResponseFrame {
    type: 'res';
    id: string;            // Matches the request id
    ok: boolean;
    payload?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}

/**
 * Server → Client: Event frame (server-push).
 * Events are fire-and-forget; clients do not acknowledge them.
 */
export interface EventFrame {
    type: 'event';
    event: GatewayEvent;
    payload: unknown;
    seq?: number;          // Monotonic sequence number for ordering
    timestamp: number;
}

/**
 * Client → Server: Initial connection handshake.
 * Must be the first frame sent after WS open.
 */
export interface ConnectFrame {
    type: 'connect';
    params: {
        clientId: string;       // Unique client identifier
        clientType: ClientType; // What kind of client
        auth?: {
            token?: string;     // Bearer token for authentication
        };
        capabilities?: string[]; // Client-declared capabilities
        version?: string;       // Client protocol version
    };
}

/**
 * Server → Client: Connection acknowledgement.
 */
export interface ConnectOkFrame {
    type: 'connect-ok';
    sessionId: string;     // Server-assigned session ID
    serverVersion: string;
    capabilities: string[]; // Server capabilities
    config?: {
        heartbeatIntervalMs: number;
        maxPayloadBytes: number;
    };
}

// Union of all frame types
export type Frame = RequestFrame | ResponseFrame | EventFrame | ConnectFrame | ConnectOkFrame;

// ─── Client Types ────────────────────────────────────────────────────────────

export type ClientType =
    | 'web-ui'      // React frontend
    | 'cli'         // CLI client
    | 'channel'     // Messaging channel (WhatsApp, Telegram, etc.)
    | 'node'        // Device node (mobile, desktop companion)
    | 'webchat'     // Embedded webchat widget
    | 'api'         // External API consumer
    | 'internal';   // Internal service-to-service

// ─── Gateway Methods ─────────────────────────────────────────────────────────

/**
 * All supported request methods.
 * Grouped by domain for clarity.
 */
export type GatewayMethod =
    // System
    | 'health' | 'status' | 'doctor' | 'config.get' | 'config.set'
    // Agent / Chat
    | 'agent.send' | 'agent.status' | 'agent.cancel'
    // Sessions
    | 'sessions.list' | 'sessions.get' | 'sessions.create' | 'sessions.delete' | 'sessions.compact' | 'sessions.history'
    | 'sessions.send'
    // Memory
    | 'memory.search' | 'memory.get' | 'memory.write'
    // Tools
    | 'tools.list' | 'tools.execute' | 'tools.approve' | 'tools.deny'
    // Channels
    | 'channels.list' | 'channels.status' | 'channels.send'
    // Skills
    | 'skills.list' | 'skills.search' | 'skills.get' | 'skills.install'
    // Security
    | 'security.status' | 'security.pending' | 'security.approve' | 'security.deny'
    // Browser
    | 'browser.action' | 'browser.scrape' | 'browser.screenshot' | 'browser.status'
    // Orchestrator
    | 'orchestrator.agents' | 'orchestrator.squads' | 'orchestrator.metrics' | 'orchestrator.mode'
    // Cron / Scheduler
    | 'cron.list' | 'cron.add' | 'cron.remove' | 'cron.run' | 'scheduler.nlp'
    // Media
    | 'media.generate' | 'media.status'
    // Graph
    | 'graph.health' | 'graph.hubs' | 'graph.query';

// ─── Gateway Events ──────────────────────────────────────────────────────────

/**
 * All event types that the server can push to clients.
 * These map to SystemProtocol events where applicable.
 */
export type GatewayEvent =
    // Lifecycle
    | 'heartbeat'
    | 'shutdown'
    | 'reconnect'
    // Agent
    | 'agent.thinking'       // Agent started thinking
    | 'agent.streaming'      // Streaming token/chunk
    | 'agent.complete'       // Agent finished response
    | 'agent.error'          // Agent error
    | 'agent.tool_call'      // Agent invoked a tool
    | 'agent.tool_result'    // Tool returned result
    // Sessions
    | 'session.created'
    | 'session.updated'
    | 'session.deleted'
    | 'session.message'      // New message in session
    // System
    | 'system.alert'
    | 'system.metrics'       // Periodic metrics push
    | 'system.mode_changed'
    // Memory
    | 'memory.created'
    | 'memory.updated'
    // Channels
    | 'channel.connected'
    | 'channel.disconnected'
    | 'channel.message'      // Incoming message from channel
    // Orchestrator
    | 'orchestrator.agent_status' // Agent status change
    | 'orchestrator.squad_update' // Squad composition change
    | 'orchestrator.task_update'  // Task progress
    // Narrative
    | 'narrative.thought'    // Neural stream emission
    | 'narrative.insight'    // Dreamer/curiosity insight
    // Tools
    | 'tool.approval_needed' // Tool needs human approval
    | 'tool.executed'        // Tool was executed
    // Media
    | 'media.progress'       // Media generation progress
    | 'media.complete'       // Media generation done
    // Introspection
    | 'introspection.cycle'  // Cognitive loop completed
    | 'introspection.state'; // Consciousness state update

// ─── Protocol ↔ SystemBus Bridge ─────────────────────────────────────────────

/**
 * Maps SystemProtocol events to GatewayEvents for bridging.
 * Not all SystemProtocol events need to be exposed to clients.
 */
export const PROTOCOL_TO_GATEWAY_EVENT: Partial<Record<SystemProtocol, GatewayEvent>> = {
    [SystemProtocol.THOUGHT_EMISSION]: 'narrative.thought',
    [SystemProtocol.SYSTEM_ALERT]: 'system.alert',
    [SystemProtocol.MEMORY_CREATED]: 'memory.created',
    [SystemProtocol.UI_REFRESH]: 'system.metrics',
    [SystemProtocol.WORKFLOW_UPDATE]: 'orchestrator.task_update',
    [SystemProtocol.TASK_COMPLETION]: 'orchestrator.task_update',
    [SystemProtocol.NARRATIVE_UPDATE]: 'narrative.thought',
    [SystemProtocol.CONNECTION_LOST]: 'channel.disconnected',
    [SystemProtocol.CONNECTION_RESTORED]: 'channel.connected',
    [SystemProtocol.TOOL_EXECUTION]: 'tool.executed',
    [SystemProtocol.CONFIRMATION_REQUIRED]: 'tool.approval_needed',
    [SystemProtocol.MOOD_CHANGE]: 'introspection.state',
    [SystemProtocol.INTUITION_CONSOLIDATED]: 'narrative.insight',
    [SystemProtocol.EPISTEMIC_GAP_DETECTED]: 'narrative.insight',
    [SystemProtocol.VIDEO_REQUEST]: 'media.progress',
    [SystemProtocol.WORK_COMPLETE]: 'media.complete',
};

// ─── Connection State ────────────────────────────────────────────────────────

export interface ClientConnection {
    id: string;             // Server-assigned connection ID
    clientId: string;       // Client-provided ID
    clientType: ClientType;
    sessionId: string;      // Active session
    connectedAt: number;
    lastHeartbeat: number;
    subscriptions: Set<GatewayEvent>; // Events this client wants
    authenticated: boolean;
    metadata: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a response frame for a request.
 */
export function createResponse(requestId: string, payload: unknown): ResponseFrame {
    return { type: 'res', id: requestId, ok: true, payload };
}

/**
 * Create an error response frame.
 */
export function createErrorResponse(requestId: string, code: string, message: string, details?: unknown): ResponseFrame {
    return { type: 'res', id: requestId, ok: false, error: { code, message, details } };
}

/**
 * Create an event frame.
 */
export function createEvent(event: GatewayEvent, payload: unknown, seq?: number): EventFrame {
    return { type: 'event', event, payload, seq, timestamp: Date.now() };
}

/**
 * Validate that a frame has the required structure.
 */
export function isValidFrame(data: unknown): data is Frame {
    if (!data || typeof data !== 'object') return false;
    const frame = data as Record<string, unknown>;
    if (!frame.type) return false;
    switch (frame.type) {
        case 'connect':
            return typeof frame.params === 'object' && frame.params !== null;
        case 'req':
            return typeof frame.id === 'string' && typeof frame.method === 'string';
        case 'res':
            return typeof frame.id === 'string' && typeof frame.ok === 'boolean';
        case 'event':
            return typeof frame.event === 'string';
        default:
            return false;
    }
}
