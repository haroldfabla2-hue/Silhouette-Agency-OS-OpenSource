import type { Operation, ChildReservation } from './lifecycle/host';
import type { HelpRequest } from './communication/helpProtocol';
import { reserveCorrelatedHelpResponse } from './lifecycle/correlatedHelpResponse';
import { preserveOriginal } from './lifecycle/preserveOriginal';
import { systemBusOwner } from './lifecycle/preparationBindings';

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

type OriginalRequestBranch = { send: ChildReservation; response?: ChildReservation; responseTaken: boolean; timeout?: ChildReservation; warning?: ChildReservation; sendTaken: boolean; timeoutTaken: boolean; warningTaken: boolean };
type EventHandler = (event: ProtocolEvent) => void;

class SystemBus {
    private readonly ownership = systemBusOwner();
    private readonly upgradeOwner: Promise<void>;
    // Only subscriptions admitted during the actual original upgrade await.
    private upgradePending = false;
    private readonly upgradeSubscriptions = new Map<SystemProtocol, Map<EventHandler, ChildReservation>>();
    private adapter: IBusAdapter;
    private eventLog: ProtocolEvent[] = [];
    private pendingRequests: Map<string, { resolve: (data: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout, cancelTimeout: () => void, sendResponse: (message: InterAgentMessage) => void }> = new Map();

    constructor(construction: import('./lifecycle/host').Operation) {
        this.ownership.validateConstruction(construction);
        // Default to Memory Adapter (Safe for Browser & Server Init)
        console.log("[SYSTEM BUS] Initializing Memory Adapter (Default)...");
        this.adapter = new MemoryBusAdapter(this.ownership);

        // Attempt to upgrade to Redis if on Server
        this.upgradeOwner = this.ownership.invoke('original-upgrade', operation => this.upgradeToRedis(operation), construction);
    }

    private async upgradeToRedis(operation: import('./lifecycle/host').Operation) {
        // Check if we are in a Node.js environment and have Redis config
        const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
        if (!isNode) return; // Browser: Stay on Memory

        const useRedis = process.env.USE_REDIS === 'true' || process.env.REDIS_URL;

        if (useRedis) {
            let upgradeFailed = false, originalUpgradeError: unknown;
            try {
                console.log("[SYSTEM BUS] Detected Redis Config. Upgrading adapter...");
                // Dynamic Import to avoid bundling 'redis' in browser
                this.upgradePending = true;
                const { RedisBusAdapter } = await import("./bus/RedisBusAdapter");
                const redisAdapter = new RedisBusAdapter(undefined, this.ownership, operation);
                await redisAdapter.connect();
                this.adapter = redisAdapter;
                this.upgradePending = false;
                console.log("[SYSTEM BUS] ✅ Upgraded to Redis Adapter.");

                // Re-apply existing subscriptions to the new adapter
                for (const [protocol, handlers] of this.handlers.entries()) {
                    for (const handler of handlers) {
                        const byHandler = this.upgradeSubscriptions.get(protocol);
                        const child = byHandler?.get(handler);
                        if (!child) {
                            // No fabricated admission for a handler without its
                            // exact original subscribe-time reservation.
                            this.ownership.unknown('upgrade:SUBSCRIPTION_RESERVATION_MISSING', true);
                            throw new Error('Missing exact upgrade subscription reservation');
                        }
                        byHandler!.delete(handler);
                        this.ownership.invokeChild(child, () => this.subscribeOriginalOnAdapter(this.adapter, protocol, handler));
                    }
                }
            } catch (err) {
                upgradeFailed = true; originalUpgradeError = err;
                this.ownership.failure('systemBus:upgrade-fallback', err);
                console.error("[SYSTEM BUS] Failed to upgrade to Redis, staying on Memory", err);
            } finally {
                this.upgradePending = false;
                // Remaining handlers were removed by their original unsubscribe
                // or were not visited after an original upgrade failure. No
                // promise, native subscription or queued event is fabricated.
                for (const byHandler of this.upgradeSubscriptions.values()) {
                    for (const child of byHandler.values()) {
                        preserveOriginal(this.ownership, 'upgrade-original-subscription-not-selected', () => {
                            if (upgradeFailed) this.ownership.abandonChild(child, originalUpgradeError);
                            else this.ownership.skipChild(child, 'ORIGINAL_GUARD_NOT_SELECTED');
                        });
                    }
                }
                this.upgradeSubscriptions.clear();
            }
        }
    }

    private handlers: Map<SystemProtocol, Set<EventHandler>> = new Map();

    private readonly subscriptionAdapters = new Map<SystemProtocol, Map<EventHandler, Set<IBusAdapter>>>();

    private subscribeOriginalOnAdapter(adapter: IBusAdapter, protocol: SystemProtocol, handler: EventHandler): Promise<void> {
        // Capture the actual adapter at the original subscription call. A later
        // upgrade cannot transfer an unsubscribe to a different adapter only.
        const original = adapter.subscribe(protocol, handler);
        let byHandler = this.subscriptionAdapters.get(protocol);
        if (!byHandler) { byHandler = new Map(); this.subscriptionAdapters.set(protocol, byHandler); }
        let adapters = byHandler.get(handler);
        if (!adapters) { adapters = new Set(); byHandler.set(handler, adapters); }
        adapters.add(adapter);
        return original;
    }
    public subscribe(protocol: SystemProtocol, handler: EventHandler) {
        this.ownership.invoke('subscribe', operation => {
            let child: ChildReservation | undefined;
            if (this.upgradePending && !this.upgradeSubscriptions.get(protocol)?.has(handler)) {
                child = this.ownership.reserveChild(operation, 'original-upgrade-subscription:' + protocol);
                let byHandler = this.upgradeSubscriptions.get(protocol);
                if (!byHandler) { byHandler = new Map(); this.upgradeSubscriptions.set(protocol, byHandler); }
                byHandler.set(handler, child);
            }
            try { return this.subscribeOriginalOnAdapter(this.adapter, protocol, handler); }
            catch (original) {
                if (child) {
                    this.upgradeSubscriptions.get(protocol)?.delete(handler);
                    preserveOriginal(this.ownership, 'subscribe-before-upgrade-original-failed', () => this.ownership.abandonChild(child!, original));
                }
                throw original;
            }
        });

        // Keep the original Set behavior, including duplicate subscription
        // registration and identity-based unsubscribe of all local occurrences.
        if (!this.handlers.has(protocol)) this.handlers.set(protocol, new Set());
        this.handlers.get(protocol)!.add(handler);
        return () => {
            const protocolHandlers = this.handlers.get(protocol);
            if (!protocolHandlers) return;
            protocolHandlers.delete(handler);
            const upgradeChild = this.upgradeSubscriptions.get(protocol)?.get(handler);
            if (upgradeChild) {
                this.upgradeSubscriptions.get(protocol)!.delete(handler);
                preserveOriginal(this.ownership, 'unsubscribe-original-upgrade-guard', () => this.ownership.skipChild(upgradeChild, 'ORIGINAL_GUARD_NOT_SELECTED'));
            }
            const adapters = this.subscriptionAdapters.get(protocol)?.get(handler);
            // The original path addressed the current adapter. Include it even
            // when a previous partial subscription failed before bookkeeping.
            const targets = new Set(adapters ?? []); targets.add(this.adapter);
            for (const adapter of targets) {
                try { adapter.unsubscribe?.(protocol, handler); }
                catch (original) {
                    this.ownership.failure('subscription:LOCAL_UNSUBSCRIBE_FAILED', original);
                    throw original;
                }
            }
            this.subscriptionAdapters.get(protocol)?.delete(handler);
            if (!this.subscriptionAdapters.get(protocol)?.size) this.subscriptionAdapters.delete(protocol);
        };
    }

    public subscribeCorrelatedHelpResponse(requestId: string, handler: EventHandler): () => void {
        return this.ownership.invoke('original-help-response-subscription', operation => {
            const response = reserveCorrelatedHelpResponse(this.ownership, operation, requestId, handler);
            let unsubscribe: () => void;
            try { unsubscribe = this.subscribe(SystemProtocol.HELP_RESPONSE, response.handler); }
            catch (original) {
                preserveOriginal(this.ownership, 'help-response-subscribe-failed', response.cancel);
                throw original;
            }
            return () => { unsubscribe(); response.cancel(); };
        });
    }

    private buildOriginalEvent(protocol: SystemProtocol, payload: any, initiator: string): ProtocolEvent {
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

        return event;
    }
    public emit(protocol: SystemProtocol, payload: any, initiator: string = 'SYSTEM') {
        const event = this.buildOriginalEvent(protocol, payload, initiator);
        this.ownership.invoke('publish', () => this.adapter.publish(event));
    }

    public reserveOriginalHelpRouting(request: HelpRequest) {
        return this.ownership.invoke('original-help-routing-plan', operation => {
            const response = this.ownership.reserveChild(operation, 'original-help-routing-response');
            let route: import('./lifecycle/host').ChildReservation;
            try { route = this.ownership.reserveChild(operation, 'original-help-routing-request'); }
            catch (original) {
                preserveOriginal(this.ownership, 'help-route-partial-plan', () => this.ownership.abandonChild(response, original));
                throw original;
            }
            let responseTaken = false, routeTaken = false;
            return {
                respond: (helperId: string, solution: string, success: boolean): void => {
                    responseTaken = true;
                    this.ownership.invokeChild(response, () => this.adapter.publish(this.buildOriginalEvent(SystemProtocol.HELP_RESPONSE, {
                        requestId: request.requestId, requesterId: request.requesterId, helperId, solution, success
                    }, helperId)));
                },
                route: (helperId: string, context: unknown): void => {
                    routeTaken = true;
                    this.ownership.invokeChild(route, () => {
                        const message = this.createMessage(request.requesterId, helperId, SystemProtocol.HELP_REQUEST,
                            { ...request, context }, { tag: MessageTag.HELP_REQUEST, priority: request.priority || MessagePriority.HIGH, traceId: request.requestId });
                        this.logOriginalMessage(message);
                        // Original message is REQUEST, so the public send's
                        // RESPONSE pending-resolution branch was not selected.
                        return this.adapter.send(message);
                    });
                },
                finishOriginalGuards: (): void => {
                    if (!responseTaken) preserveOriginal(this.ownership, 'help-response-original-guard', () => this.ownership.skipChild(response, 'ORIGINAL_GUARD_NOT_SELECTED'));
                    if (!routeTaken) preserveOriginal(this.ownership, 'help-route-original-guard', () => this.ownership.skipChild(route, 'ORIGINAL_GUARD_NOT_SELECTED'));
                },
            };
        });
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
    private logOriginalMessage(message: InterAgentMessage | EnhancedInterAgentMessage): void {
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

    }

    public send(message: InterAgentMessage | EnhancedInterAgentMessage) {
        this.logOriginalMessage(message);

        // Only the exact original double-correlation guard can select a
        // pre-admitted response transport after seal. No generic send permit.
        const pending = !this.ownership.open && message.type === 'RESPONSE' && this.pendingRequests.has(message.traceId)
            && message.payload?.correlationId ? this.pendingRequests.get(message.payload.correlationId) : undefined;
        if (pending) pending.sendResponse(message);
        else this.ownership.invoke('send', () => this.adapter.send(message));

        // If it's a RESPONSE, check if we have a pending promise to resolve
        if (message.type === 'RESPONSE' && this.pendingRequests.has(message.traceId)) {
            const correlationId = message.payload?.correlationId;
            if (correlationId && this.pendingRequests.has(correlationId)) {
                const { resolve, timer, cancelTimeout } = this.pendingRequests.get(correlationId)!;
                clearTimeout(timer);
                cancelTimeout();
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
    public request(
        targetId: string,
        protocol: SystemProtocol,
        payload: any,
        traceId: string,
        timeoutMs?: number,
        maxRetries: number = 2
    ): Promise<InterAgentMessage> {
        return this.ownership.invoke('original-correlated-request', operation => this.requestOriginal(operation, targetId, protocol, payload, traceId, timeoutMs, maxRetries));
    }
    private async requestOriginal(operation: Operation, targetId: string, protocol: SystemProtocol,
        payload: any, traceId: string, timeoutMs: number | undefined, maxRetries: number): Promise<InterAgentMessage> {
        // Adaptive timeout based on protocol complexity
        const effectiveTimeout = timeoutMs || this.getProtocolTimeout(protocol);

        const branches: OriginalRequestBranch[] = [];
        let failed = false, originalError: unknown;
        try {
            // Mirror the original numeric loop condition, not a rounded/new bound.
            // Capacity refusal occurs before any timer, pending map or send effect.
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const send = this.ownership.reserveChild(operation, 'original-request-send:' + attempt);
                const branch: OriginalRequestBranch = { send, responseTaken: false, sendTaken: false, timeoutTaken: false, warningTaken: false };
                branches.push(branch);
                branch.response = this.ownership.reserveChild(operation, 'original-request-correlated-response-send:' + attempt);
                branch.timeout = this.ownership.reserveChild(operation, 'original-request-timeout:' + attempt);
                if (attempt < maxRetries) branch.warning = this.ownership.reserveChild(operation, 'original-request-timeout-warning:' + attempt);
            }
            let lastError: Error | null = null;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    return await this._singleRequest(targetId, protocol, payload, traceId, effectiveTimeout, attempt, branches[attempt]);
                } catch (err: any) {
                    lastError = err;
                    if (attempt < maxRetries) {
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                        console.warn(`[BUS] ⏳ Request to ${targetId} timed out (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${backoffMs}ms...`);

                        // Emit warning event instead of silently failing
                        const branch = branches[attempt];
                        const event = this.buildOriginalEvent(SystemProtocol.SYSTEM_ALERT, {
                            type: 'TIMEOUT_WARNING',
                            targetId,
                            protocol,
                            attempt: attempt + 1,
                            maxRetries: maxRetries + 1,
                            timeoutMs: effectiveTimeout
                        }, 'SYSTEM_BUS');
                        branch.warningTaken = true;
                        this.ownership.invokeChild(branch.warning!, () => this.adapter.publish(event));

                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                    }
                }
            }

            throw lastError || new Error(`Request to ${targetId} exhausted all retries.`);
        } catch (original) { failed = true; originalError = original; throw original; }
        finally {
            for (const branch of branches) {
                for (const child of [!branch.sendTaken ? branch.send : undefined, !branch.responseTaken ? branch.response : undefined, !branch.timeoutTaken ? branch.timeout : undefined, !branch.warningTaken ? branch.warning : undefined]) {
                    if (!child) continue;
                    preserveOriginal(this.ownership, 'request-original-branch-disposition', () => {
                        if (failed) this.ownership.abandonChild(child, originalError);
                        else this.ownership.skipChild(child, 'ORIGINAL_GUARD_NOT_SELECTED');
                    });
                }
            }
        }
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
        attempt: number,
        branch: OriginalRequestBranch
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
            let responseUsed = false;
            const cancelResponse = () => {
                if (responseUsed) return;
                preserveOriginal(this.ownership, 'request-original-no-reserved-response', () => {
                    this.ownership.skipChild(branch.response!, 'ORIGINAL_GUARD_NOT_SELECTED');
                    responseUsed = true;
                });
            };
            const timer = setTimeout(() => this.ownership.invokeChild(branch.timeout!, () => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    cancelResponse();
                    reject(new Error(`Request ${requestId} to ${targetId} timed out after ${timeoutMs}ms (attempt ${attempt + 1})`));
                }
            }), timeoutMs);
            // Timer now owns its exact reserved lifetime independently of an
            // earlier synchronous send error rejecting the request Promise.
            branch.timeoutTaken = true;
            const cancelTimeout = () => {
                preserveOriginal(this.ownership, 'request-correlated-response-timeout-guard', () => {
                    this.ownership.skipChild(branch.timeout!, 'ORIGINAL_GUARD_NOT_SELECTED');
                });
                cancelResponse();
            };
            const sendResponse = (response: InterAgentMessage): void => {
                responseUsed = true;
                this.ownership.invokeChild(branch.response!, () => this.adapter.send(response));
            };
            this.pendingRequests.set(requestId, { resolve, reject, timer, cancelTimeout, sendResponse });
            // Pending entry, not the potentially early-rejected request body,
            // owns response entitlement until actual response or actual timeout.
            branch.responseTaken = true;
            this.logOriginalMessage(message);
            branch.sendTaken = true;
            this.ownership.invokeChild(branch.send, () => this.adapter.send(message));
            // Original message is REQUEST, so public send's RESPONSE resolution
            // branch was not selected. Rejections stay side evidence; original
            // request still waits on its actual response/timeout, not send ack.
        });
    }

    public async checkMailbox(agentId: string): Promise<InterAgentMessage[]> {
        return this.ownership.invoke('original-check-mailbox', () => this.adapter.checkMailbox(agentId));
    }

    public async hasMail(agentId: string): Promise<boolean> {
        return this.ownership.invoke('original-has-mail', () => this.adapter.hasMail(agentId));
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

function constructOriginalSystemBus(): SystemBus {
    const owner = systemBusOwner();
    const operation = owner.beginConstruction();
    try {
        const instance = new SystemBus(operation);
        owner.constructed(operation, instance); return instance;
    } catch (original) {
        preserveOriginal(owner, 'construction-failure', () => owner.constructionFailed(operation, original)); throw original;
    }
}
export const systemBus = constructOriginalSystemBus();
