
import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../types";
import { IBusAdapter } from "./bus/IBusAdapter";
import { MemoryBusAdapter } from "./bus/MemoryBusAdapter";
// import { RedisBusAdapter } from "./bus/RedisBusAdapter"; // REMOVED: Static import causes browser crash

// --- SYSTEM BUS V2.1 (ENHANCED WITH MESSAGE TAGGING) ---
// The Central Nervous System for Silhouette.
// Enables Event-Driven Architecture for Protocols and Real-Time Updates.
// Now supports Pluggable Persistence (Redis/Memory) and Priority-Based Message Delivery.

/**
 * Message Tag - Indicates the source/type of message
 * Inspired by Poke's multi-agent architecture
 */
export enum MessageTag {
    USER_REQUEST = 'USER_REQUEST',           // Direct user request
    AGENT_DELEGATION = 'AGENT_DELEGATION',   // Task delegated to another agent
    TRIGGER = 'TRIGGER',                     // Automated trigger/event
    SYSTEM = 'SYSTEM',                       // System-level message
    HELP_REQUEST = 'HELP_REQUEST',           // Inter-agent help request
    REMEDIATION = 'REMEDIATION'              // Self-healing/recovery events
}

/**
 * Message Priority - Determines delivery urgency
 */
export enum MessagePriority {
    CRITICAL = 'CRITICAL',  // Immediate delivery, wake agent if needed
    HIGH = 'HIGH',          // Deliver within 1 second
    NORMAL = 'NORMAL',      // Standard delivery (3s cycle)
    LOW = 'LOW'             // Deliver when convenient
}

/**
 * Enhanced Inter-Agent Message with tagging support
 */
export interface EnhancedInterAgentMessage extends InterAgentMessage {
    tag?: MessageTag;
    priority: MessagePriority;
    requiresAck?: boolean;  // Requires acknowledgment from recipient
}

type EventHandler = (event: ProtocolEvent) => void;

class SystemBus {
    private adapter: IBusAdapter;
    private eventLog: ProtocolEvent[] = [];
    private pendingRequests: Map<string, { resolve: (data: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }> = new Map();

    constructor() {
        // Default to Memory Adapter (Safe for Browser & Server Init)
        console.log("[SYSTEM BUS] Initializing Memory Adapter (Default)...");
        this.adapter = new MemoryBusAdapter();

        // Attempt to upgrade to Redis if on Server
        this.upgradeToRedis();
    }

    private async upgradeToRedis() {
        // Check if we are in a Node.js environment and have Redis config
        const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
        if (!isNode) return; // Browser: Stay on Memory

        const useRedis = process.env.USE_REDIS === 'true' || process.env.REDIS_URL;

        if (useRedis) {
            try {
                console.log("[SYSTEM BUS] Detected Redis Config. Upgrading adapter...");
                // Dynamic Import to avoid bundling 'redis' in browser
                const { RedisBusAdapter } = await import("./bus/RedisBusAdapter");
                const redisAdapter = new RedisBusAdapter();
                await redisAdapter.connect();
                this.adapter = redisAdapter;
                console.log("[SYSTEM BUS] ✅ Upgraded to Redis Adapter.");
            } catch (err) {
                console.error("[SYSTEM BUS] Failed to upgrade to Redis, staying on Memory", err);
            }
        }
    }

    private handlers: Map<SystemProtocol, Set<EventHandler>> = new Map();

    public subscribe(protocol: SystemProtocol, handler: EventHandler) {
        this.adapter.subscribe(protocol, handler);

        // Track handlers for unsubscribe capability
        if (!this.handlers.has(protocol)) {
            this.handlers.set(protocol, new Set());
        }
        this.handlers.get(protocol)!.add(handler);

        // Return unsubscribe function
        return () => {
            const protocolHandlers = this.handlers.get(protocol);
            if (protocolHandlers) {
                protocolHandlers.delete(handler);
                // Call adapter unsubscribe if available
                if (typeof (this.adapter as any).unsubscribe === 'function') {
                    (this.adapter as any).unsubscribe(protocol, handler);
                }
            }
        };
    }

    public emit(protocol: SystemProtocol, payload: any, initiator: string = 'SYSTEM') {
        const event: ProtocolEvent = {
            type: protocol,
            payload,
            timestamp: Date.now(),
            initiator
        };

        // Log for terminal
        this.eventLog.push(event);
        if (this.eventLog.length > 100) this.eventLog.shift();

        console.log(`[BUS] Emitting ${protocol} from ${initiator}`, payload);

        this.adapter.publish(event);
    }

    public getRecentEvents(): ProtocolEvent[] {
        return this.eventLog;
    }

    // --- ACTOR MODEL MESSAGING (ASYNC SWARM) ---

    /**
     * Sends a message to a specific agent or team.
     * Non-blocking "Fire and Forget".
     * Now supports priority-based delivery and message tagging.
     */
    public send(message: InterAgentMessage | EnhancedInterAgentMessage) {
        const enhanced = message as EnhancedInterAgentMessage;
        const tag = enhanced.tag || MessageTag.SYSTEM;
        const priority = enhanced.priority || MessagePriority.NORMAL;

        // Enhanced logging with tag and priority
        const priorityEmoji = {
            [MessagePriority.CRITICAL]: '🚨',
            [MessagePriority.HIGH]: '⚡',
            [MessagePriority.NORMAL]: '📨',
            [MessagePriority.LOW]: '📬'
        }[priority];

        console.log(`[BUS] ${priorityEmoji} [${tag}] Msg ${message.id.substring(0, 4)} (${message.type}) -> ${message.targetId} [Trace: ${message.traceId.substring(0, 4)}]`);

        this.adapter.send(message);

        // If it's a RESPONSE, check if we have a pending promise to resolve
        if (message.type === 'RESPONSE' && this.pendingRequests.has(message.traceId)) {
            const correlationId = message.payload?.correlationId;
            if (correlationId && this.pendingRequests.has(correlationId)) {
                const { resolve, timer } = this.pendingRequests.get(correlationId)!;
                clearTimeout(timer);
                resolve(message);
                this.pendingRequests.delete(correlationId);
                console.log(`[BUS] ✅ Request ${correlationId.substring(0, 4)} resolved.`);
            }
        }
    }

    /**
     * Sends a request and waits for a response (Promise-based).
     * Used for "Ask for Help" patterns.
     */
    public async request(targetId: string, protocol: SystemProtocol, payload: any, traceId: string, timeoutMs: number = 10000): Promise<InterAgentMessage> {
        const requestId = crypto.randomUUID();
        const message: InterAgentMessage = {
            id: requestId,
            traceId: traceId,
            senderId: 'SYSTEM', // Or caller
            targetId: targetId,
            type: 'REQUEST',
            protocol: protocol,
            payload: { ...payload, correlationId: requestId }, // Embed ID for correlation
            timestamp: Date.now(),
            priority: 'NORMAL'
        };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Request ${requestId} to ${targetId} timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer });
            this.send(message);
        });
    }

    public async checkMailbox(agentId: string): Promise<InterAgentMessage[]> {
        return this.adapter.checkMailbox(agentId);
    }

    public async hasMail(agentId: string): Promise<boolean> {
        return this.adapter.hasMail(agentId);
    }

    /**
     * Helper method to create a tagged message
     * Makes it easier to send messages with proper tagging
     */
    public createMessage(
        senderId: string,
        targetId: string,
        protocol: SystemProtocol,
        payload: any,
        options?: {
            tag?: MessageTag;
            priority?: MessagePriority;
            requiresAck?: boolean;
            traceId?: string;
        }
    ): EnhancedInterAgentMessage {
        return {
            id: crypto.randomUUID(),
            traceId: options?.traceId || crypto.randomUUID(),
            senderId,
            targetId,
            type: 'INFO',  // Changed from 'TASK' to match existing types
            protocol,
            payload,
            timestamp: Date.now(),
            priority: options?.priority || MessagePriority.NORMAL,
            tag: options?.tag || MessageTag.AGENT_DELEGATION,
            requiresAck: options?.requiresAck || false
        };
    }
}

export const systemBus = new SystemBus();
