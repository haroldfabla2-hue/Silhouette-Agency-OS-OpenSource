import { IBusAdapter } from "./IBusAdapter";
import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../../types";
import { createClient, RedisClientType } from 'redis';

export class RedisBusAdapter implements IBusAdapter {
    private pubClient: RedisClientType;
    private subClient: RedisClientType;
    private isConnected: boolean = false;
    private closing = false;
    private connectionTask?: Promise<void>;
    private closingTask?: Promise<void>;
    private readonly diagnostics: unknown[] = [];
    public getDiagnostics(): readonly unknown[] { return [...this.diagnostics]; }
    private listeners: Record<string, ((event: ProtocolEvent) => void)[]> = {};

    constructor(url?: string) {
        const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';

        const redisOptions = {
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries: number) => {
                    if (retries > 3) return new Error('Max retries reached');
                    return Math.min(retries * 50, 500);
                }
            }
        };

        this.pubClient = createClient(redisOptions);
        this.subClient = createClient(redisOptions);

        this.pubClient.on('error', (err) => {
            this.diagnostics.push({ resource: 'redis-bus-pub', error: err });
            // Uncomment to debug detailed Redis connection errors
            // console.error('[REDIS PUB ERROR]', err.message)
        });
        this.subClient.on('error', (err) => {
            this.diagnostics.push({ resource: 'redis-bus-sub', error: err });
            // console.error('[REDIS SUB ERROR]', err.message)
        });
    }

    connect(): Promise<void> {
        if (this.closing) return Promise.reject(new Error('RedisBusAdapter closed'));
        if (this.isConnected) return Promise.resolve();
        if (this.connectionTask) return this.connectionTask;
        this.connectionTask = this.connectOnce().finally(() => { this.connectionTask = undefined; });
        return this.connectionTask;
    }
    private async connectOnce(): Promise<void> {
        await this.pubClient.connect();
        if (this.closing) throw new Error('Redis bus closed during connect');
        await this.subClient.connect();
        console.log("[BUS] Redis Adapter Connected.");

        // Subscribe to global channel for events
        await this.subClient.subscribe('silhouette:events', (message) => {
            if (this.closing) return;
            try {
                const event: ProtocolEvent = JSON.parse(message);
                this.handleIncomingEvent(event);
            } catch (e) {
                console.error("[REDIS] Failed to parse event", e);
            }
        });
        if (this.closing) throw new Error('Redis bus closed during subscribe');
        this.isConnected = true;
    }

    private handleIncomingEvent(event: ProtocolEvent) {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(handler => handler(event));
        }
    }

    disconnect(): Promise<void> {
        if (this.closingTask) return this.closingTask;
        this.closing = true;
        this.closingTask = (async () => {
            if (this.connectionTask) await this.connectionTask.catch(() => undefined);
            const results = await Promise.allSettled([this.pubClient, this.subClient].map(async client => {
                if (client.isOpen) await client.disconnect();
            }));
            this.isConnected = false;
            this.listeners = {};
            const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason);
            if (errors.length) throw new AggregateError(errors, 'Redis bus clients failed closure');
        })();
        return this.closingTask;
    }
    unsubscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): void {
        this.listeners[protocol] = (this.listeners[protocol] || []).filter(listener => listener !== handler);
    }

    async publish(event: ProtocolEvent): Promise<void> {
        if (!this.isConnected) await this.connect();
        // Publish to Redis Pub/Sub for real-time
        await this.pubClient.publish('silhouette:events', JSON.stringify(event));

        // Also store in Stream for history/replay if needed (Optional for V1)
        // await this.pubClient.xAdd('silhouette:stream', '*', { event: JSON.stringify(event) });
    }

    subscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): void {
        if (this.closing) throw new Error('RedisBusAdapter closed');
        if (!this.listeners[protocol]) {
            this.listeners[protocol] = [];
        }
        this.listeners[protocol].push(handler);
    }

    async send(message: InterAgentMessage): Promise<void> {
        if (!this.isConnected) await this.connect();

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
        if (!this.isConnected) await this.connect();

        const key = `mailbox:${agentId}`;
        const messages: InterAgentMessage[] = [];

        // Pop all messages atomically? 
        // For now, we pop one by one or get range and del.
        // RPOP is standard queue behavior.

        // Let's fetch all current items
        const len = await this.pubClient.lLen(key);
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
        if (!this.isConnected) await this.connect();
        const len = await this.pubClient.lLen(`mailbox:${agentId}`);
        return len > 0;
    }
}
