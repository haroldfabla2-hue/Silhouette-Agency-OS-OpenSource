// =============================================================================
// CHANNEL ROUTER
// Central hub that manages all messaging channels and routes messages
// between external platforms and the Silhouette agent.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from './channelInterface';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';
import { sessionManager } from '../gateway/sessionManager';
import { gateway } from '../gateway/wsGateway';

// ─── Channel Router ──────────────────────────────────────────────────────────

class ChannelRouter {
    private channels: Map<string, IChannel> = new Map();
    private messageHandlers: MessageHandler[] = [];
    private chatToSession: Map<string, string> = new Map(); // chatId → sessionId

    // ── Registration ──────────────────────────────────────────────────────

    /**
     * Register a channel implementation.
     */
    register(channel: IChannel): void {
        this.channels.set(channel.name, channel);

        // Wire up the message handler to route to Silhouette
        channel.onMessage(async (msg: IncomingMessage) => {
            await this.handleIncoming(msg);
        });

        console.log(`[ChannelRouter] 📡 Registered channel: ${channel.name}`);
    }

    // ── Connection Lifecycle ──────────────────────────────────────────────

    /**
     * Connect all registered channels.
     */
    async connectAll(): Promise<void> {
        const results = await Promise.allSettled(
            Array.from(this.channels.values()).map(async (ch) => {
                try {
                    await ch.connect();
                    console.log(`[ChannelRouter] ✅ ${ch.name} connected`);
                    systemBus.emit(SystemProtocol.CONNECTION_RESTORED, {
                        service: `channel:${ch.name}`,
                        timestamp: Date.now(),
                    }, 'ChannelRouter');
                } catch (err: any) {
                    console.error(`[ChannelRouter] ❌ ${ch.name} failed:`, err.message);
                    systemBus.emit(SystemProtocol.CONNECTION_LOST, {
                        service: `channel:${ch.name}`,
                        error: err.message,
                    }, 'ChannelRouter');
                }
            })
        );

        const connected = results.filter(r => r.status === 'fulfilled').length;
        console.log(`[ChannelRouter] ${connected}/${this.channels.size} channels connected`);
    }

    /**
     * Disconnect all channels gracefully.
     */
    async disconnectAll(): Promise<void> {
        await Promise.allSettled(
            Array.from(this.channels.values()).map(ch => ch.disconnect())
        );
        console.log(`[ChannelRouter] All channels disconnected`);
    }

    // ── Incoming Message Handling ─────────────────────────────────────────

    /**
     * Handle an incoming message from any channel.
     * Routes it to the appropriate session and forwards to the agent.
     */
    private async handleIncoming(msg: IncomingMessage): Promise<void> {
        try {
            // 1. Get or create a session for this chat
            const sessionId = this.getOrCreateSessionForChat(msg);

            // 2. Add message to session history
            sessionManager.addMessage(sessionId, {
                role: 'user',
                content: msg.text,
                metadata: {
                    channel: msg.channel,
                    agentId: msg.senderId,
                },
            });

            // 3. Forward to SystemBus for orchestrator pickup
            systemBus.emit(SystemProtocol.USER_MESSAGE, {
                sessionId,
                message: msg.text,
                channel: msg.channel,
                senderId: msg.senderId,
                senderName: msg.senderName,
                chatId: msg.chatId,
                isGroup: msg.isGroup,
                media: msg.media,
                timestamp: msg.timestamp,
            }, `channel:${msg.channel}`);

            // 4. Notify WS clients about the channel message
            gateway.broadcast('channel.message', {
                channel: msg.channel,
                sessionId,
                senderId: msg.senderId,
                text: msg.text,
                timestamp: msg.timestamp,
            });

            // 5. Call registered handlers
            for (const handler of this.messageHandlers) {
                try {
                    await handler(msg);
                } catch (err) {
                    console.error(`[ChannelRouter] Handler error:`, err);
                }
            }

            console.log(`[ChannelRouter] 📨 ${msg.channel}: ${msg.senderName ?? msg.senderId} → session ${sessionId.slice(0, 8)}`);
        } catch (err) {
            console.error(`[ChannelRouter] Failed to handle incoming message:`, err);
        }
    }

    private getOrCreateSessionForChat(msg: IncomingMessage): string {
        const chatKey = `${msg.channel}:${msg.chatId}`;
        let sessionId = this.chatToSession.get(chatKey);

        if (sessionId) {
            const session = sessionManager.getSession(sessionId);
            if (session && session.status !== 'closed') {
                return sessionId;
            }
        }

        // Create new session
        const session = sessionManager.createSession({
            channel: msg.channel,
            clientId: msg.senderId,
            title: `${msg.channel} - ${msg.senderName ?? msg.senderId}`,
        });

        this.chatToSession.set(chatKey, session.id);
        return session.id;
    }

    // ── Outgoing Messages ─────────────────────────────────────────────────

    /**
     * Send a message via a specific channel.
     */
    async send(channelName: string, message: OutgoingMessage): Promise<string | null> {
        const channel = this.channels.get(channelName);
        if (!channel) {
            console.error(`[ChannelRouter] Channel "${channelName}" not found`);
            return null;
        }
        if (!channel.isConnected()) {
            console.error(`[ChannelRouter] Channel "${channelName}" is not connected`);
            return null;
        }

        if (message.media && message.media.length > 0) {
            console.log(`[ChannelRouter] 📤 Sending ${message.media.length} media items to ${channelName}`);
        }

        return channel.send(message);
    }

    /**
     * Reply to a message using the same channel it came from.
     */
    async reply(originalMessage: IncomingMessage, text: string, media?: OutgoingMessage['media']): Promise<string | null> {
        return this.send(originalMessage.channel, {
            chatId: originalMessage.chatId,
            text,
            replyToId: originalMessage.id,
            media,
        });
    }

    /**
     * Broadcast a message to all connected channels (or specific ones).
     */
    async broadcast(text: string, channelNames?: string[]): Promise<void> {
        const targets = channelNames
            ? channelNames.map(n => this.channels.get(n)).filter(Boolean) as IChannel[]
            : Array.from(this.channels.values());

        await Promise.allSettled(
            targets.filter(ch => ch.isConnected()).map(ch => {
                // For broadcast, we need a chatId — this is channel-specific
                // Each channel should handle broadcast differently
                console.log(`[ChannelRouter] Broadcast to ${ch.name}: ${text.slice(0, 50)}...`);
                return Promise.resolve(); // Placeholder — channels define their own broadcast
            })
        );
    }

    // ── External Handlers ─────────────────────────────────────────────────

    /**
     * Register a handler for all incoming messages.
     */
    onMessage(handler: MessageHandler): void {
        this.messageHandlers.push(handler);
    }

    // ── Status ────────────────────────────────────────────────────────────

    /**
     * Get status of all channels.
     */
    getStatus(): ChannelStatus[] {
        return Array.from(this.channels.values()).map(ch => ch.getStatus());
    }

    /**
     * Get a specific channel by name.
     */
    getChannel(name: string): IChannel | undefined {
        return this.channels.get(name);
    }

    /**
     * List all registered channel names.
     */
    listChannels(): string[] {
        return Array.from(this.channels.keys());
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const channelRouter = new ChannelRouter();
