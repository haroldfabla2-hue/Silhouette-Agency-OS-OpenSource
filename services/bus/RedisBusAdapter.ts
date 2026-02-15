import { IBusAdapter } from "./IBusAdapter";
import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../../types";
import { createClient, RedisClientType } from 'redis';

export class RedisBusAdapter implements IBusAdapter {
    private pubClient: RedisClientType;
    private subClient: RedisClientType;
    private isConnected: boolean = false;
    private listeners: Record<string, ((event: ProtocolEvent) => void)[]> = {};

    constructor(url?: string) {
        const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';
        this.pubClient = createClient({ url: redisUrl });
        this.subClient = createClient({ url: redisUrl });

        this.pubClient.on('error', (err) => console.error('[REDIS PUB ERROR]', err));
        this.subClient.on('error', (err) => console.error('[REDIS SUB ERROR]', err));
    }

    async connect(): Promise<void> {
        if (this.isConnected) return;
        await this.pubClient.connect();
        await this.subClient.connect();
        this.isConnected = true;
        console.log("[BUS] Redis Adapter Connected.");

        // Subscribe to global channel for events
        await this.subClient.subscribe('silhouette:events', (message) => {
            try {
                const event: ProtocolEvent = JSON.parse(message);
                this.handleIncomingEvent(event);
            } catch (e) {
                console.error("[REDIS] Failed to parse event", e);
            }
        });
    }

    private handleIncomingEvent(event: ProtocolEvent) {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(handler => handler(event));
        }
    }

    async disconnect(): Promise<void> {
        await this.pubClient.disconnect();
        await this.subClient.disconnect();
        this.isConnected = false;
    }

    async publish(event: ProtocolEvent): Promise<void> {
        if (!this.isConnected) await this.connect();
        // Publish to Redis Pub/Sub for real-time
        await this.pubClient.publish('silhouette:events', JSON.stringify(event));

        // Also store in Stream for history/replay if needed (Optional for V1)
        // await this.pubClient.xAdd('silhouette:stream', '*', { event: JSON.stringify(event) });
    }

    async subscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): Promise<void> {
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
