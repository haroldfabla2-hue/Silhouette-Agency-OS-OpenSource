// =============================================================================
// TELEGRAM CHANNEL
// Telegram bot integration using grammY framework.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';
import { Bot, Context, InputFile } from 'grammy';
import { geminiService } from '../../../services/geminiService';

const logger = {
    info: (msg: string, ...args: any[]) => console.log(`[Telegram] ℹ️ ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[Telegram] ⚠️ ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`[Telegram] ❌ ${msg}`, ...args),
};

export class TelegramChannel implements IChannel {
    readonly name = 'telegram';

    private handlers: MessageHandler[] = [];
    private connected = false;
    private connectTime = 0;
    private lastMessageTime = 0;
    private bot: Bot | null = null;
    private config: {
        botToken: string;
        allowedChatIds?: number[];
        accessMode?: 'open' | 'allowlist';
    };

    constructor(config: { botToken: string; allowedChatIds?: number[]; accessMode?: 'open' | 'allowlist' }) {
        this.config = config;
    }

    async connect(): Promise<void> {
        try {
            logger.info('[Telegram] Connecting...');
            this.bot = new Bot(this.config.botToken);

            // AUTH MIDDLEWARE
            this.bot.use(async (ctx, next) => {
                if (!ctx.from) return;
                const userId = ctx.from.id;

                // 1. OPEN MODE: Everyone is allowed
                if (this.config.accessMode === 'open') {
                    await next();
                    return;
                }

                // 2. ALLOWLIST MODE (Default/Secure)
                // Must be explicitly in the allowedChatIds list
                if (this.config.allowedChatIds && this.config.allowedChatIds.includes(userId)) {
                    await next();
                    return;
                }

                // 3. BLOCKED
                logger.warn(`[Telegram] ⛔ Unauthorized access blocked: ${userId} (@${ctx.from.username})`);
                // Optional: Reply to user saying they are not authorized? 
                // Better to be silent to avoid spam/scanning.
                return;
            });

            // ERROR HANDLER
            this.bot.catch((err) => {
                logger.error(`[Telegram] Bot error: ${err.message}`, err);
            });

            // TEXT HANDLER
            this.bot.on('message:text', async (ctx: Context) => {
                this.handleIncoming(ctx);
            });

            // PHOTO HANDLER (Basic support to acknowledge)
            this.bot.on('message:photo', async (ctx: Context) => {
                // TODO: Implement image download/processing if needed
                await ctx.reply("📸 Image received (processing not yet implemented)");
            });

            // VOICE HANDLER
            this.bot.on('message:voice', async (ctx: Context) => {
                await this.handleVoiceMessage(ctx);
            });

            // START POLLING
            this.bot.start({
                onStart: (botInfo) => {
                    this.connected = true;
                    this.connectTime = Date.now();
                    logger.info(`[Telegram] ✅ Bot @${botInfo.username} is connected and polling.`);

                    // Notify admin of startup
                    if (this.config.allowedChatIds && this.config.allowedChatIds.length > 0) {
                        this.bot?.api.sendMessage(this.config.allowedChatIds[0], "🤖 Silhouette OS: Telegram Uplink Online").catch(() => { });
                    }
                },
            }).catch((err) => {
                logger.error('[Telegram] Polling error:', err);
                this.connected = false;
            });

            // Resolve immediately (non-blocking start)
            this.connected = true;

        } catch (err: any) {
            logger.error('[Telegram] Failed to connect:', err);
            throw err;
        }
    }

    private async handleIncoming(ctx: Context) {
        if (!ctx.message || !ctx.from) return;

        const chatId = ctx.chat?.id.toString();
        const incoming: IncomingMessage = {
            id: String(ctx.message.message_id),
            channel: 'telegram',
            senderId: String(ctx.from.id),
            senderName: ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : ''),
            chatId: chatId || String(ctx.from.id),
            text: ctx.message.text || '',
            timestamp: ctx.message.date * 1000,
            isGroup: ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup',
        };

        this.lastMessageTime = Date.now();

        // Dispatch to Orchestrator via Router
        for (const handler of this.handlers) {
            try { await handler(incoming); } catch (err) {
                logger.error('[Telegram] Handler error:', err);
            }
        }
    }

    async disconnect(): Promise<void> {
        if (this.bot) {
            await this.bot.stop();
            this.bot = null;
        }
        this.connected = false;
        logger.info('[Telegram] Disconnected.');
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        if (!this.bot || !this.connected) {
            logger.warn('[Telegram] Cannot send: Bot not connected.');
            return null;
        }

        const chatId = message.chatId;

        // 1. FILTER INTERNAL THOUGHTS
        if (message.text.includes('[THOUGHT]') || message.text.includes('Introspection:')) {
            return null;
        }

        try {
            // 2. SEND TYPING INDICATOR
            if (message.text.length > 50) {
                await this.bot.api.sendChatAction(chatId, 'typing').catch(() => { });
            }

            // 3. HANDLE MEDIA (Output from Tools)
            if (message.media && message.media.length > 0) {
                for (const media of message.media) {
                    if (media.type === 'image' && media.url) {
                        await this.bot.api.sendPhoto(chatId, media.url, { caption: media.caption });
                    }
                    else if (media.type === 'video' && media.url) {
                        await this.bot.api.sendVideo(chatId, media.url, { caption: media.caption });
                    }
                }
            }

            // 4. SEND TEXT (If present and not just a caption)
            // If we sent media, usually the text is the summary. We send it as well.
            if (message.text && message.text.trim().length > 0) {
                const sent = await this.bot.api.sendMessage(chatId, message.text, { parse_mode: 'Markdown' });
                return String(sent.message_id);
            }

            return 'media-sent';

        } catch (err) {
            logger.error(`[Telegram] Send error to ${chatId}:`, err);
            return null;
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    getStatus(): ChannelStatus {
        return {
            channel: 'telegram',
            connected: this.connected,
            uptime: this.connected ? Date.now() - this.connectTime : 0,
            lastMessage: this.lastMessageTime || undefined,
        };
    }

    isConnected(): boolean {
        return this.connected;
    }

    private async handleVoiceMessage(ctx: Context) {
        if (!ctx.message?.voice) return;

        try {
            await ctx.replyWithChatAction('typing');

            // 1. Get File Info
            const file = await ctx.getFile();
            const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;

            // 2. Download and convert to Base64
            const response = await fetch(fileUrl);
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');

            // 3. Transcribe via Gemini
            logger.info(`[Telegram] 🎤 Transcribing voice message from ${ctx.from?.id}`);
            const transcription = await geminiService.transcribeAudio(base64, 'audio/ogg');

            if (transcription.startsWith('[Transcription failed')) {
                await ctx.reply(`❌ ${transcription}`);
                return;
            }

            // 4. Inject as a text message
            ctx.message.text = transcription;
            await ctx.reply(`📝 _Transcrito:_ ${transcription}`, { parse_mode: 'Markdown' });

            // 5. Handle as if it were text
            return this.handleIncoming(ctx);

        } catch (err: any) {
            logger.error('[Telegram] Voice processing failed:', err.message);
            await ctx.reply("⚠️ No pude procesar tu mensaje de voz. Intenta enviarlo de nuevo.");
        }
    }
}
