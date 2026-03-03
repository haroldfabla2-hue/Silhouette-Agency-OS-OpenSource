// =============================================================================
// DISCORD CHANNEL V2
// Discord bot integration using discord.js.
// Production: continuous typing, message chunking (2000 char limit),
// error feedback, embed support, thought filtering.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';

// ═══════ UTILITIES ═══════

class TypingIndicator {
    private interval: NodeJS.Timeout | null = null;
    start(channel: any) {
        // Discord typing lasts ~10s, renew every 9s
        if (channel && 'sendTyping' in channel) {
            channel.sendTyping().catch(() => { });
            this.interval = setInterval(() => {
                channel.sendTyping().catch(() => { });
            }, 9000);
        }
    }
    stop() {
        if (this.interval) { clearInterval(this.interval); this.interval = null; }
    }
}

const DISCORD_MAX_LEN = 1950; // Discord limit is 2000, leave margin

function chunkMessage(text: string, maxLen: number = DISCORD_MAX_LEN): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n\n', maxLen);
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
        if (splitAt < maxLen * 0.3) { splitAt = remaining.lastIndexOf('. ', maxLen); if (splitAt > 0) splitAt += 1; }
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
        if (splitAt <= 0) splitAt = maxLen;
        chunks.push(remaining.substring(0, splitAt).trim());
        remaining = remaining.substring(splitAt).trim();
    }
    return chunks.filter(c => c.length > 0);
}

const INTERNAL_PATTERNS = [
    /^\[THOUGHT\]/i, /^\[INTERNAL\]/i, /^Introspection:/i, /^<think>/i,
    /^SYSTEM:/, /^\[REFLECTIVE\]/i, /^\[COGNITIVE\]/i, /^\[SELF-HEAL\]/i,
    /^\[BUS\]/i, /^\[DAEMON\]/i,
];

function isInternalMessage(text: string): boolean {
    return INTERNAL_PATTERNS.some(p => p.test(text.trim()));
}

// ═══════ DISCORD CHANNEL ═══════

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
        responseMode?: 'auto-reply' | 'read-only';
    };

    constructor(config: { botToken: string; allowedGuildIds?: string[]; allowedChannelIds?: string[]; accessMode?: 'open' | 'allowlist'; responseMode?: 'auto-reply' | 'read-only' }) {
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
                if (msg.author.bot) return;

                // Access control
                if (this.config.accessMode !== 'open') {
                    if (this.config.allowedGuildIds?.length && msg.guild) {
                        if (!this.config.allowedGuildIds.includes(msg.guild.id)) return;
                    }
                    if (this.config.allowedChannelIds?.length) {
                        if (!this.config.allowedChannelIds.includes(msg.channel.id)) return;
                    }
                    if (!this.config.allowedGuildIds?.length && !this.config.allowedChannelIds?.length) {
                        console.warn(`[Discord] ⛔ Blocked (Secure Mode): Configure allowedGuildIds or set accessMode: 'open'`);
                        return;
                    }
                }

                // Start continuous typing
                const typing = new TypingIndicator();
                typing.start(msg.channel);

                try {
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
                        isReadOnly: this.config.responseMode === 'read-only'
                    };

                    if (!incoming.text && !media?.length) return;

                    this.lastMessageTime = Date.now();
                    for (const handler of this.handlers) {
                        try { await handler(incoming); } catch (err) {
                            console.error('[Discord] Handler error:', err);
                        }
                    }
                } catch (err: any) {
                    console.error(`[Discord] Processing failed:`, err.message);
                    try {
                        await msg.channel.send('❌ Error procesando tu mensaje.');
                    } catch { /* silent */ }
                } finally {
                    typing.stop();
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
        if (this.client) { await this.client.destroy(); this.client = null; }
        this.connected = false;
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        if (!this.client || !this.connected) return null;
        if (isInternalMessage(message.text)) return null;

        try {
            const channel = await this.client.channels.fetch(message.chatId);
            if (!channel || !('send' in channel)) return null;

            // Continuous typing while sending
            if (message.showTyping && 'sendTyping' in channel) {
                await (channel as any).sendTyping();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Media attachments
            if (message.media && message.media.length > 0) {
                for (const media of message.media) {
                    try {
                        if (media.url) {
                            await (channel as any).send({ files: [{ attachment: media.url, name: media.filename }] });
                        }
                    } catch (mediaErr: any) {
                        console.error(`[Discord] Media send failed: ${mediaErr.message}`);
                    }
                }
            }

            // Text with chunking (Discord limit: 2000 chars)
            if (message.text && message.text.trim().length > 0) {
                const chunks = chunkMessage(message.text);
                let lastId: string | null = null;

                for (let i = 0; i < chunks.length; i++) {
                    const options: any = { content: chunks[i] };
                    if (i === 0 && message.replyToId) {
                        options.reply = { messageReference: message.replyToId };
                    }
                    const sent = await (channel as any).send(options);
                    lastId = sent.id;
                    if (chunks.length > 1) await new Promise(r => setTimeout(r, 300));
                }
                return lastId;
            }

            return 'media-sent';
        } catch (err: any) {
            console.error('[Discord] Send error:', err.message);
            return null;
        }
    }

    onMessage(handler: MessageHandler): void { this.handlers.push(handler); }

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

    isConnected(): boolean { return this.connected; }
}

export { DiscordChannel };
