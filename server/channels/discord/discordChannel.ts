// =============================================================================
// DISCORD CHANNEL
// Discord bot integration using discord.js.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';

/**
 * Discord channel implementation using discord.js.
 * 
 * NOTE: Requires `discord.js` package to be installed.
 * Install: npm install discord.js
 */
class DiscordChannel implements IChannel {
    readonly name = 'discord';

    private handlers: MessageHandler[] = [];
    private connected = false;
    private connectTime = 0;
    private lastMessageTime = 0;
    private client: any = null;
    private config: {
        botToken: string;
        allowedGuildIds?: string[];
        allowedChannelIds?: string[];
        accessMode?: 'open' | 'allowlist';
    };

    constructor(config: { botToken: string; allowedGuildIds?: string[]; allowedChannelIds?: string[]; accessMode?: 'open' | 'allowlist' }) {
        this.config = config;
    }

    async connect(): Promise<void> {
        try {
            const { Client, GatewayIntentBits } = await import('discord.js');

            this.client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.DirectMessages,
                ],
            });

            this.client.on('ready', () => {
                this.connected = true;
                this.connectTime = Date.now();
                console.log(`[Discord] ✅ Bot is online as ${this.client.user?.tag}`);
            });

            this.client.on('messageCreate', async (msg: any) => {
                // Ignore bot's own messages
                if (msg.author.bot) return;

                const accessMode = this.config.accessMode;

                // 1. OPEN MODE: Skip filters
                if (accessMode !== 'open') {
                    // 2. ALLOWLIST MODE (Strict)
                    // If allowedGuildIds is configured, must match
                    if (this.config.allowedGuildIds && this.config.allowedGuildIds.length > 0) {
                        if (msg.guild && !this.config.allowedGuildIds.includes(msg.guild.id)) return;
                    }

                    // If allowedChannelIds is configured, must match
                    if (this.config.allowedChannelIds && this.config.allowedChannelIds.length > 0) {
                        if (!this.config.allowedChannelIds.includes(msg.channel.id)) return;
                    }

                    // IF NO ALLOWLISTS CONFIGURED AT ALL IN ALLOWLIST MODE -> BLOCK EVERYTHING?
                    // To follow the pattern of other channels: Yes, secure by default.
                    // But for Discord, maybe we only block DMs if guilds are specified?
                    // Let's keep it simple: if allowlist mode and checklists exist, enforce them. 
                    // If NO checklists exist, maybe we should warn? 
                    // For now, let's just stick to "if list exists, enforce it".
                    // The other channels block if list is empty. Here we have TWO lists.
                    // Let's implement strict blocking if NO whitelist is present in allowlist mode.

                    if (
                        (!this.config.allowedGuildIds || this.config.allowedGuildIds.length === 0) &&
                        (!this.config.allowedChannelIds || this.config.allowedChannelIds.length === 0)
                    ) {
                        console.warn(`[Discord] ⛔ Blocked message (Secure Mode): Configure allowedGuildIds or allowedChannelIds, or set accessMode: 'open'.`);
                        return;
                    }
                }

                // Build media attachments
                const media = msg.attachments?.size > 0
                    ? Array.from(msg.attachments.values()).map((att: any) => ({
                        type: att.contentType?.startsWith('image/') ? 'image' as const
                            : att.contentType?.startsWith('video/') ? 'video' as const
                                : att.contentType?.startsWith('audio/') ? 'audio' as const
                                    : 'document' as const,
                        url: att.url,
                        mimeType: att.contentType ?? 'application/octet-stream',
                        filename: att.name,
                    }))
                    : undefined;

                const incoming: IncomingMessage = {
                    id: msg.id,
                    channel: 'discord',
                    senderId: msg.author.id,
                    senderName: msg.author.displayName ?? msg.author.username,
                    chatId: msg.channel.id,
                    text: msg.content ?? '',
                    timestamp: msg.createdTimestamp,
                    isGroup: msg.guild !== null,
                    replyTo: msg.reference?.messageId,
                    media,
                    raw: msg,
                };

                if (!incoming.text && !media?.length) return; // Skip empty messages

                this.lastMessageTime = Date.now();
                for (const handler of this.handlers) {
                    try { await handler(incoming); } catch (err) {
                        console.error('[Discord] Handler error:', err);
                    }
                }
            });

            this.client.on('error', (err: Error) => {
                console.error('[Discord] Client error:', err.message);
            });

            await this.client.login(this.config.botToken);

        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                console.warn('[Discord] ⚠️ discord.js not installed. Run: npm install discord.js');
            }
            throw err;
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.destroy();
            this.client = null;
        }
        this.connected = false;
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        if (!this.client || !this.connected) return null;

        try {
            const channel = await this.client.channels.fetch(message.chatId);
            if (!channel || !('send' in channel)) return null;

            if (message.showTyping && 'sendTyping' in channel) {
                await (channel as any).sendTyping();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const options: any = { content: message.text };
            if (message.replyToId) {
                options.reply = { messageReference: message.replyToId };
            }

            const sent = await (channel as any).send(options);
            return sent.id;
        } catch (err) {
            console.error('[Discord] Send error:', err);
            return null;
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    getStatus(): ChannelStatus {
        return {
            channel: 'discord',
            connected: this.connected,
            uptime: this.connected ? Date.now() - this.connectTime : 0,
            lastMessage: this.lastMessageTime || undefined,
            metadata: {
                guilds: this.client?.guilds?.cache?.size ?? 0,
                tag: this.client?.user?.tag,
            },
        };
    }

    isConnected(): boolean {
        return this.connected;
    }
}

export { DiscordChannel };
