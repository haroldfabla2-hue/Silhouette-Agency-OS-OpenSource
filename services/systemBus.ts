
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
    REMEDIATION = 'REMEDIATION',              // Self-healing/recovery events
    DEBATE = 'DEBATE'                        // Multi-agent debate message
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

type EventHandler = (event: ProtocolEvent) => unknown;

class SystemBus {
    private adapter: IBusAdapter;
    private eventLog: ProtocolEvent[] = [];
    private pendingRequests: Map<string, { resolve: (data: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }> = new Map();

    constructor() {
        // Default to Memory Adapter (Safe for Browser & Server Init)
        console.log("[SYSTEM BUS] Initializing Memory Adapter (Default)...");
        this.adapter = new MemoryBusAdapter();


    }

    private closing = false;
    private startTask?: Promise<void>;
    private closeTask?: Promise<{ workFailures: unknown[]; cleanupFailures: unknown[]; degraded: unknown[] }>;
    private readonly active = new Set<Promise<unknown>>();
    private readonly workFailures: unknown[] = [];
    private readonly cleanupFailures: unknown[] = [];
    private readonly degraded: unknown[] = [];
    private readonly adapters = new Set<IBusAdapter>();
    private readonly wrapped = new Map<EventHandler, EventHandler>();
    private readonly backoffs = new Map<ReturnType<typeof setTimeout>, () => void>();
    public start(): Promise<void> {
        this.assertOpen();
        if (!this.startTask) this.startTask = this.track(this.upgradeToRedis());
        return this.startTask;
    }
    private assertOpen(): void { if (this.closing) throw new Error('SystemBus closed'); }
    private track<T>(task: Promise<T>): Promise<T> {
        this.active.add(task);
        void task.then(() => this.active.delete(task), error => { this.active.delete(task); this.workFailures.push(error); });
        return task;
    }
    public shutdown() {
        if (this.closeTask) return this.closeTask;
        this.closing = true;
        this.adapters.add(this.adapter);
        for (const { timer, reject } of this.pendingRequests.values()) { clearTimeout(timer); reject(new Error('SystemBus request stopped at shutdown')); }
        this.pendingRequests.clear();
        for (const [timer, resolve] of this.backoffs) { clearTimeout(timer); resolve(); }
        this.backoffs.clear();
        for (const [protocol, handlers] of this.handlers) for (const handler of handlers) {
            for (const adapter of this.adapters) adapter.unsubscribe(protocol, this.wrapped.get(handler)!);
        }
        this.closeTask = (async () => {
            while (this.active.size) await Promise.allSettled([...this.active]);
            for (const adapter of this.adapters) {
                try { await adapter.disconnect(); } catch (error) { this.cleanupFailures.push(error); }
            }
            this.handlers.clear(); this.wrapped.clear();
            return { workFailures: [...this.workFailures], cleanupFailures: [...this.cleanupFailures], degraded: [...this.degraded] };
        })();
        return this.closeTask;
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
                this.assertOpen();
                const redisAdapter = new RedisBusAdapter();
                this.adapters.add(redisAdapter);
                try { await redisAdapter.connect(); this.assertOpen(); }
                catch (error) {
                    try { await redisAdapter.disconnect(); this.adapters.delete(redisAdapter); } catch (cleanup) { this.cleanupFailures.push(cleanup); }
                    throw error;
                }
                try {
                    // Subscription registration is synchronous for both actual adapters;
                    // move the complete set without an await/interleaving publication gap.
                    for (const [protocol, handlers] of this.handlers) for (const handler of handlers) {
                        redisAdapter.subscribe(protocol, this.wrapped.get(handler)!);
                    }
                    const previous = this.adapter;
                    this.adapters.add(previous);
                    this.adapter = redisAdapter;
                    for (const [protocol, handlers] of this.handlers) for (const handler of handlers) {
                        previous.unsubscribe(protocol, this.wrapped.get(handler)!);
                    }
                    console.log('[SYSTEM BUS] Upgraded to Redis Adapter.');
                } catch (error) {
                    try { await redisAdapter.disconnect(); this.adapters.delete(redisAdapter); } catch (cleanup) { this.cleanupFailures.push(cleanup); }
                    throw error;
                }
            } catch (err) {
                this.degraded.push({ error: err, originalCapability: 'UNAVAILABLE', disposition: 'DEGRADED_FALLBACK' });
                console.error("[SYSTEM BUS] Failed to upgrade to Redis, staying on Memory", err);
            }
        }
    }

    private handlers: Map<SystemProtocol, Set<EventHandler>> = new Map();

    public subscribe(protocol: SystemProtocol, handler: EventHandler) {
        this.assertOpen();
        if (!this.handlers.has(protocol)) this.handlers.set(protocol, new Set());
        const set = this.handlers.get(protocol)!;
        if (!set.has(handler)) {
            set.add(handler);
            let wrapper = this.wrapped.get(handler);
            if (!wrapper) {
                wrapper = event => {
                    if (this.closing) return;
                    // Invoke synchronously as before; retain any returned async work.
                    try { this.track(Promise.resolve(handler(event))); }
                    catch (error) { this.workFailures.push(error); }
                };
                this.wrapped.set(handler, wrapper);
            }
            this.adapter.subscribe(protocol, wrapper);
        }
        return () => {
            if (!set.delete(handler)) return;
            for (const adapter of this.adapters) adapter.unsubscribe(protocol, this.wrapped.get(handler)!);
            this.adapter.unsubscribe(protocol, this.wrapped.get(handler)!);
        };
    }

    public emit(protocol: SystemProtocol, payload: any, initiator: string = 'SYSTEM') {
        this.assertOpen();
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

        void this.track(this.adapter.publish(event));
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
        this.assertOpen();
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

        void this.track(this.adapter.send(message));

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
     * Uses adaptive timeout based on protocol type and supports retries.
     * 
     * @param timeoutMs Override timeout. Defaults are per-protocol:
     *   - RESEARCH_REQUEST / SYNTHESIS_REQUEST: 60s
     *   - TASK_ASSIGNMENT / HELP_PROTOCOL: 45s
     *   - Default: 30s
     */
    public async request(
        targetId: string,
        protocol: SystemProtocol,
        payload: any,
        traceId: string,
        timeoutMs?: number,
        maxRetries: number = 2
    ): Promise<InterAgentMessage> {
        return this.track((async () => {

        this.assertOpen();
        // Adaptive timeout based on protocol complexity
        const effectiveTimeout = timeoutMs || this.getProtocolTimeout(protocol);

        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            this.assertOpen();
            try {
                return await this._singleRequest(targetId, protocol, payload, traceId, effectiveTimeout, attempt);
            } catch (err: any) {
                lastError = err;
                if (this.closing) throw err;
                if (attempt < maxRetries) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                    console.warn(`[BUS] ⏳ Request to ${targetId} timed out (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${backoffMs}ms...`);

                    // Emit warning event instead of silently failing
                    this.emit(SystemProtocol.SYSTEM_ALERT, {
                        type: 'TIMEOUT_WARNING',
                        targetId,
                        protocol,
                        attempt: attempt + 1,
                        maxRetries: maxRetries + 1,
                        timeoutMs: effectiveTimeout
                    }, 'SYSTEM_BUS');

                    await new Promise<void>(resolve => {
                        const timer = setTimeout(() => { this.backoffs.delete(timer); resolve(); }, backoffMs);
                        this.backoffs.set(timer, resolve);
                    });
                }
            }
        }

        throw lastError || new Error(`Request to ${targetId} exhausted all retries.`);
    
        })());
    }

    private getProtocolTimeout(protocol: SystemProtocol): number {
        const timeoutMap: Partial<Record<SystemProtocol, number>> = {
            [SystemProtocol.RESEARCH_REQUEST]: 60000,
            [SystemProtocol.SYNTHESIS_REQUEST]: 60000,
            [SystemProtocol.PAPER_GENERATION_REQUEST]: 60000,
            [SystemProtocol.TASK_ASSIGNMENT]: 45000,
            [SystemProtocol.HELP_REQUEST]: 45000,
            [SystemProtocol.EPISTEMIC_GAP_DETECTED]: 45000,
        };
        return timeoutMap[protocol] || 30000;
    }

    private _singleRequest(
        targetId: string,
        protocol: SystemProtocol,
        payload: any,
        traceId: string,
        timeoutMs: number,
        attempt: number
    ): Promise<InterAgentMessage> {
        const requestId = crypto.randomUUID();
        const message: InterAgentMessage = {
            id: requestId,
            traceId: traceId,
            senderId: 'SYSTEM',
            targetId: targetId,
            type: 'REQUEST',
            protocol: protocol,
            payload: { ...payload, correlationId: requestId, attempt },
            timestamp: Date.now(),
            priority: 'NORMAL'
        };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Request ${requestId} to ${targetId} timed out after ${timeoutMs}ms (attempt ${attempt + 1})`));
                }
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer });
            this.send(message);
        });
    }

    public async checkMailbox(agentId: string): Promise<InterAgentMessage[]> {
        this.assertOpen();
        return this.track(this.adapter.checkMailbox(agentId));
    }

    public async hasMail(agentId: string): Promise<boolean> {
        this.assertOpen();
        return this.track(this.adapter.hasMail(agentId));
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
