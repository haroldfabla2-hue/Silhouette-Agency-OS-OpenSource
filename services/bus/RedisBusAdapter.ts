import { IBusAdapter } from "./IBusAdapter";
import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../../types";
// TYPE-ONLY import: the 'redis' package module must NOT be evaluated when
// this module loads. The driver is imported dynamically inside doConnect(),
// AFTER the acceptance guard, so the package boundary sits behind the policy
// barrier instead of ahead of it. Declared limit: this only governs THIS
// module's own import edge; it is not a statement about what evaluating the
// 'redis' package itself would do (no package-source proof).
import type { createClient } from 'redis';
import { acceptanceBoot } from '../security/bootMode';

/**
 * Redis-backed bus adapter.
 *
 * OWNERSHIP CONTRACT (clients are created lazily in connect(), so this
 * contract is what makes the lazy change safe):
 * - A client pair is created at most once per connect attempt and is NEVER
 *   overwritten: a new pair is created only after the previous one was
 *   confirmed closed (both clients) or explicitly retained with a latched
 *   failed-close receipt.
 * - isConnected is set ONLY after BOTH clients are connected AND the global
 *   subscription is active - never between partial steps.
 * - A partial connect/subscribe failure closes BOTH clients independently
 *   (a failing pub close never skips the sub close); if any close fails the
 *   pair is RETAINED with closeFailed=true and later connects refuse to
 *   recreate until a disconnect retry confirms the close.
 * - connect() and disconnect() are each single-flight; connect fences
 *   against an in-flight close instead of riding a closing pair.
 * - disconnect() has NO policy guard: the barrier blocks acquisition and
 *   commands, never close.
 *
 * POLICY SCOPE: boot-stable. Fences exist at operation entry and across the
 * driver-import await; between individual commands of one operation the
 * mode cannot change (SILHOUETTE_BOOT_MODE is process-start policy), and no
 * hot-toggle contract is offered or claimed.
 */
export class RedisBusAdapter implements IBusAdapter {
    private pubClient: ReturnType<typeof createClient> | null = null;
    private subClient: ReturnType<typeof createClient> | null = null;
    private isConnected: boolean = false;
    private listeners: Record<string, ((event: ProtocolEvent) => void)[]> = {};
    private readonly redisUrl: string;
    // Single-flight connect: concurrent connect() callers share one attempt
    // instead of each creating and connecting their own client pair.
    private connectTask: Promise<void> | null = null;
    // Single-flight disconnect: concurrent disconnect() callers share one
    // close of the same pair, and connect() waits out an in-flight close so
    // no operation rides a closing handle.
    private disconnectTask: Promise<void> | null = null;
    // Failed-close receipt: set when a close of a client throws. The pair
    // stays OWNED (never silently discarded or overwritten); the next
    // disconnect() retries the close, and connect() refuses to recreate
    // until that retry confirms it.
    private closeFailed: boolean = false;

    constructor(url?: string) {
        // Acceptance barrier: construction itself is REJECTED with an
        // identifiable error - no half-usable instance ever exists in this
        // mode (a returned instance with null clients would still accept
        // subscribe() calls and resolve connect() as if it had completed).
        if (acceptanceBoot()) {
            throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        }
        this.redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';
    }

    async connect(): Promise<void> {
        // Policy denial THROWS: connect must never resolve as if it had
        // succeeded in this mode.
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        // Never ride a closing pair: an in-flight close settles first. A
        // latched failed close gets ONE retry here; if it still fails the
        // retained pair is uncertain and connect refuses - recreating would
        // overwrite handles that may still be open.
        if (this.disconnectTask) {
            try { await this.disconnectTask; } catch { /* latched + owned at source */ }
        }
        if (this.closeFailed) {
            try { await this.disconnect(); } catch { /* latched + owned at source */ }
        }
        if (this.closeFailed) {
            throw new Error('REDIS_BUS_CLOSE_FAILED: retained client pair whose close failed is not reusable; close must be confirmed before recreating.');
        }
        if (this.isConnected) return;
        if (this.connectTask) return this.connectTask;
        this.connectTask = this.doConnect();
        try {
            await this.connectTask;
        } finally {
            this.connectTask = null;
        }
    }

    private async doConnect(): Promise<void> {
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        // Defensive ownership fence: a retained pair from a previous partial
        // failure or failed close must be confirmed closed before any new
        // pair is created - never overwritten.
        if (this.pubClient || this.subClient) {
            await this.doDisconnect();
        }
        // Dynamic import AFTER the guard: the driver module is evaluated only
        // when a connection is actually requested outside acceptance.
        const { createClient } = await import('redis');
        // Recheck across the await: never create clients under policy.
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');

        const redisOptions = {
            url: this.redisUrl,
            socket: {
                reconnectStrategy: (retries: number) => {
                    if (retries > 3) return new Error('Max retries reached');
                    return Math.min(retries * 50, 500);
                }
            }
        };

        // Local refs until FULLY ready: the instance fields only ever point
        // at a live, serving pair (or at a retained failed-close pair).
        const pub = createClient(redisOptions);
        const sub = createClient(redisOptions);

        pub.on('error', (err) => {
            // Uncomment to debug detailed Redis connection errors
            // console.error('[REDIS PUB ERROR]', err.message)
        });
        sub.on('error', (err) => {
            // console.error('[REDIS SUB ERROR]', err.message)
        });

        try {
            await pub.connect();
            await sub.connect();
            // Subscribe to global channel for events. isConnected is set ONLY
            // after this succeeds: connected-before-subscribed would silently
            // drop events the adapter claims to deliver.
            await sub.subscribe('silhouette:events', (message) => {
                try {
                    const event: ProtocolEvent = JSON.parse(message);
                    this.handleIncomingEvent(event);
                } catch (e) {
                    console.error("[REDIS] Failed to parse event", e);
                }
            });
        } catch (connectErr) {
            // Partial failure: close BOTH clients independently - a failing
            // pub close never skips the sub close. If any close fails, the
            // pair is RETAINED with the receipt latched (ownership preserved
            // for retry/cleanup); otherwise the refs are dropped and the next
            // attempt starts clean.
            const closeErrors: any[] = [];
            if ((pub as any).isOpen) {
                try { await pub.disconnect(); } catch (e) { closeErrors.push(e); }
            }
            if ((sub as any).isOpen) {
                try { await sub.disconnect(); } catch (e) { closeErrors.push(e); }
            }
            if (closeErrors.length > 0) {
                this.pubClient = pub;
                this.subClient = sub;
                this.closeFailed = true;
            }
            throw connectErr;
        }

        this.pubClient = pub;
        this.subClient = sub;
        this.isConnected = true;
        console.log("[BUS] Redis Adapter Connected.");
    }

    private handleIncomingEvent(event: ProtocolEvent) {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(handler => handler(event));
        }
    }

    async disconnect(): Promise<void> {
        // Single-flight: every concurrent caller awaits the SAME close task
        // (each call returns its own Promise over that shared task - not the
        // identical Promise object).
        if (this.disconnectTask) return this.disconnectTask;
        this.disconnectTask = this.doDisconnect();
        try {
            await this.disconnectTask;
        } finally {
            this.disconnectTask = null;
        }
    }

    private async doDisconnect(): Promise<void> {
        // Settle an in-flight connect first: its outcome (ready pair or
        // cleaned failure) is owned here, never raced for the references.
        if (this.connectTask) {
            try { await this.connectTask; } catch { /* failure owned at source */ }
        }
        this.isConnected = false;
        const pub = this.pubClient;
        const sub = this.subClient;
        if (!pub && !sub) {
            this.closeFailed = false;
            return;
        }
        // Independent close attempts for BOTH: a failing pub never skips sub.
        const errors: any[] = [];
        if (pub && (pub as any).isOpen) {
            try { await pub.disconnect(); } catch (e) { errors.push(e); }
        }
        if (sub && (sub as any).isOpen) {
            try { await sub.disconnect(); } catch (e) { errors.push(e); }
        }
        if (errors.length > 0) {
            // Retain the pair and the receipt; a later disconnect() retries.
            this.closeFailed = true;
            throw errors.length === 1
                ? errors[0]
                : new AggregateError(errors, '[REDIS BUS] failed to close client pair');
        }
        // Both confirmed closed (or never open): release ownership.
        this.pubClient = null;
        this.subClient = null;
        this.closeFailed = false;
    }

    async publish(event: ProtocolEvent): Promise<void> {
        // Fence against an in-flight close, then connect if needed.
        if (this.disconnectTask) {
            try { await this.disconnectTask; } catch { /* latched + owned at source */ }
        }
        if (!this.isConnected) await this.connect();
        // Post-await fence: policy revalidated before any command is sent.
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        if (!this.pubClient) throw new Error('REDIS_BUS_UNAVAILABLE');
        // Publish to Redis Pub/Sub for real-time
        await this.pubClient.publish('silhouette:events', JSON.stringify(event));

        // Also store in Stream for history/replay if needed (Optional for V1)
        // await this.pubClient.xAdd('silhouette:stream', '*', { event: JSON.stringify(event) });
    }

    async subscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): Promise<void> {
        // Unreachable after a rejected construction (no instance exists), but
        // a listener registered under policy would silently never fire: deny
        // it identifiably rather than accept it.
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        if (!this.listeners[protocol]) {
            this.listeners[protocol] = [];
        }
        this.listeners[protocol].push(handler);
    }

    async send(message: InterAgentMessage): Promise<void> {
        if (this.disconnectTask) {
            try { await this.disconnectTask; } catch { /* latched + owned at source */ }
        }
        if (!this.isConnected) await this.connect();
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        if (!this.pubClient) throw new Error('REDIS_BUS_UNAVAILABLE');

        // Use Redis Lists as Mailboxes
        // Key: mailbox:{agentId}
        const key = `mailbox:${message.targetId}`;

        if (message.priority === 'CRITICAL') {
            await this.pubClient.lPush(key, JSON.stringify(message)); // Jump to front
        } else {
            await this.pubClient.rPush(key, JSON.stringify(message)); // Append to end
        }

        // Notify agent via Pub/Sub to wake up
        await this.pubClient.publish(`wake:${message.targetId}`, 'MAIL');
    }

    async checkMailbox(agentId: string): Promise<InterAgentMessage[]> {
        if (this.disconnectTask) {
            try { await this.disconnectTask; } catch { /* latched + owned at source */ }
        }
        if (!this.isConnected) await this.connect();
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        if (!this.pubClient) throw new Error('REDIS_BUS_UNAVAILABLE');

        const key = `mailbox:${agentId}`;
        const messages: InterAgentMessage[] = [];

        // Pop all messages atomically? 
        // For now, we pop one by one or get range and del.
        // RPOP is standard queue behavior.

        // Let's fetch all current items
        const rawLen = await this.pubClient.lLen(key);
        // Boundary check: redis v5 types this reply as number | `${number}` under the
        // inferred RESP 2|3 union, while the client contract (default TypeMapping,
        // runtime RESP2) always delivers a JS number. Fail loudly if that ever breaks.
        if (typeof rawLen !== 'number' || !Number.isInteger(rawLen) || rawLen < 0) {
            throw new Error('REDIS_BUS_UNEXPECTED_LLEN_REPLY');
        }
        const len = rawLen;
        if (len === 0) return [];

        // Transaction to get and clear
        // Ideally we use LPOP count in newer Redis, but let's be safe
        for (let i = 0; i < len; i++) {
            const msgStr = await this.pubClient.lPop(key);
            if (msgStr) {
                // In newer Redis types, lPop might return generic, casting to string to be safe
                messages.push(JSON.parse(msgStr as string));
            }
        }

        return messages;
    }

    async hasMail(agentId: string): Promise<boolean> {
        if (this.disconnectTask) {
            try { await this.disconnectTask; } catch { /* latched + owned at source */ }
        }
        if (!this.isConnected) await this.connect();
        if (acceptanceBoot()) throw new Error('REDIS_BUS_DISABLED_BY_POLICY');
        if (!this.pubClient) throw new Error('REDIS_BUS_UNAVAILABLE');
        const rawMailboxLen = await this.pubClient.lLen(`mailbox:${agentId}`);
        // Same LLEN boundary check as in fetchMessages: number per client contract.
        if (typeof rawMailboxLen !== 'number' || !Number.isInteger(rawMailboxLen) || rawMailboxLen < 0) {
            throw new Error('REDIS_BUS_UNEXPECTED_LLEN_REPLY');
        }
        return rawMailboxLen > 0;
    }
}
