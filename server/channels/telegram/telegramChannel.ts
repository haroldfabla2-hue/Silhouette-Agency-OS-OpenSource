// =============================================================================
// TELEGRAM CHANNEL V2
// Telegram bot integration using grammY framework.
// Production-grade: continuous typing, message chunking, error handling,
// Markdown fallback, enhanced thought filtering.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';
import { Bot, Context, InputFile } from 'grammy';
import { geminiService } from '../../../services/geminiService';
import fs from 'fs';
import path from 'path';

const logger = {
    info: (msg: string, ...args: any[]) => console.log(`[Telegram] ℹ️ ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[Telegram] ⚠️ ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`[Telegram] ❌ ${msg}`, ...args),
};

// ═══════════════════════════════════════════════════════════════
// UTILITY: Continuous Typing Indicator
// Telegram expires `sendChatAction('typing')` after ~5s.
// This renews it every 4s until explicitly stopped.
// ═══════════════════════════════════════════════════════════════

class TypingIndicator {
    private interval: NodeJS.Timeout | null = null;

    start(bot: Bot, chatId: string) {
        // Send immediately
        bot.api.sendChatAction(chatId, 'typing').catch(() => { });
        // Renew every 4s
        this.interval = setInterval(() => {
            bot.api.sendChatAction(chatId, 'typing').catch(() => { });
        }, 4000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: Message Chunking (4096 char Telegram limit)
// ═══════════════════════════════════════════════════════════════

const TELEGRAM_MAX_LENGTH = 4000; // Leave 96 chars margin for safety

function chunkMessage(text: string, maxLen: number = TELEGRAM_MAX_LENGTH): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        // Try to split at paragraph boundary
        let splitAt = remaining.lastIndexOf('\n\n', maxLen);
        if (splitAt < maxLen * 0.3) {
            // Too early — try newline
            splitAt = remaining.lastIndexOf('\n', maxLen);
        }
        if (splitAt < maxLen * 0.3) {
            // Still too early — try sentence
            splitAt = remaining.lastIndexOf('. ', maxLen);
            if (splitAt > 0) splitAt += 1; // Include the period
        }
        if (splitAt < maxLen * 0.3) {
            // Last resort: hard split at space
            splitAt = remaining.lastIndexOf(' ', maxLen);
        }
        if (splitAt <= 0) {
            // No boundary found: hard cut
            splitAt = maxLen;
        }

        chunks.push(remaining.substring(0, splitAt).trim());
        remaining = remaining.substring(splitAt).trim();
    }

    return chunks.filter(c => c.length > 0);
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: Internal Thought Filtering
// ═══════════════════════════════════════════════════════════════

const INTERNAL_PATTERNS = [
    /^\[THOUGHT\]/i,
    /^\[INTERNAL\]/i,
    /^Introspection:/i,
    /^<think>/i,
    /^SYSTEM:/,
    /^\[REFLECTIVE\]/i,
    /^\[COGNITIVE\]/i,
    /^\[SELF-HEAL\]/i,
    /^\[BUS\]/i,
    /^\[DAEMON\]/i,
];

function stripInternalThoughts(text: string): string {
    if (!text) return '';
    let result = text;
    // Remove <think>...</think>
    result = result.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Remove [THOUGHT]...[/THOUGHT] and similar pairs
    result = result.replace(/\[(?:THOUGHT|INTERNAL|REFLECTIVE|COGNITIVE|SELF-HEAL)\][\s\S]*?\[\/(?:THOUGHT|INTERNAL|REFLECTIVE|COGNITIVE|SELF-HEAL)\]/gi, '');

    // Fallback if the LLM forgot the closing tag but started with one
    if (/^(\[THOUGHT\]|<think>|Introspection:|SYSTEM:|\[BUS\]|\[DAEMON\])/i.test(result.trim())) {
        const parts = result.trim().split(/\n\n+/);
        if (parts.length > 1) {
            parts.shift(); // Remove the first block
            result = parts.join('\n\n');
        } else {
            return ''; // The entire message is an unclosed thought block
        }
    }
    return result.trim();
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: Safe Markdown Send
// Tries Markdown first, falls back to plain text.
// ═══════════════════════════════════════════════════════════════

async function safeSendMessage(bot: Bot, chatId: string | number, text: string): Promise<number | null> {
    const targetId = typeof chatId === 'string' && /^-?\d+$/.test(chatId) ? parseInt(chatId, 10) : chatId;
    try {
        const sent = await bot.api.sendMessage(targetId, text, { parse_mode: 'Markdown' });
        return sent.message_id;
    } catch (mdError: any) {
        // Markdown parsing failed — retry as plain text
        if (mdError.description?.includes('parse') || mdError.description?.includes('entities') || mdError.error_code === 400) {
            logger.warn(`Markdown failed for chatId ${targetId}, retrying as plain text`);
            try {
                const sent = await bot.api.sendMessage(targetId, text);
                return sent.message_id;
            } catch (plainError: any) {
                logger.error(`Plain text send also failed: ${plainError.message}`);
                return null;
            }
        }
        throw mdError;
    }
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM CHANNEL (Production)
// ═══════════════════════════════════════════════════════════════

export class TelegramChannel implements IChannel {
    readonly name = 'telegram';

    private handlers: MessageHandler[] = [];
    private connected = false;
    private connectTime = 0;
    private lastMessageTime = 0;
    private hasSentBootMessage = false;
    private bot: Bot | null = null;
    private activeTyping: Map<string, TypingIndicator> = new Map(); // chatId → indicator
    private config: {
        botToken: string;
        allowedChatIds?: number[];
        accessMode?: 'open' | 'allowlist';
        responseMode?: 'auto-reply' | 'read-only';
    };

    constructor(config: { botToken: string; allowedChatIds?: number[]; accessMode?: 'open' | 'allowlist'; responseMode?: 'auto-reply' | 'read-only' }) {
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
                if (this.config.allowedChatIds && this.config.allowedChatIds.includes(userId)) {
                    await next();
                    return;
                }

                // 2.5 FIRST-CONTACT AUTO-TRUST
                if (!this.config.allowedChatIds || this.config.allowedChatIds.length === 0) {
                    logger.info(`🛡️ First-contact secured! Trusting user ${userId} (@${ctx.from.username || 'unknown'}) as Primary Admin.`);
                    this.config.allowedChatIds = [userId];

                    // Persist to .env.local to survive reboots
                    try {
                        const envPath = path.join(process.cwd(), '.env.local');
                        if (fs.existsSync(envPath)) {
                            let envContent = fs.readFileSync(envPath, 'utf8');
                            if (envContent.includes('TELEGRAM_ALLOWED_IDS=')) {
                                envContent = envContent.replace(/TELEGRAM_ALLOWED_IDS=.*/g, `TELEGRAM_ALLOWED_IDS=${userId}`);
                            } else {
                                envContent += `\nTELEGRAM_ALLOWED_IDS=${userId}\n`;
                            }
                            fs.writeFileSync(envPath, envContent, 'utf8');
                            logger.info(`🔒 Allowed ID ${userId} permanently saved to .env.local`);
                        }
                    } catch (e) {
                        logger.warn(`Failed to persist ID to .env.local:`, e);
                    }

                    await next();
                    return;
                }

                // 3. BLOCKED
                logger.warn(`⛔ Unauthorized access blocked: ${userId} (@${ctx.from.username || 'unknown'})`);
                return;
            });

            // ERROR HANDLER
            this.bot.catch((err) => {
                logger.error(`[Telegram] Bot error: ${err.message}`, err);
            });

            // TEXT HANDLER
            this.bot.on('message:text', async (ctx: Context) => {
                await this.handleIncoming(ctx);
            });

            // PHOTO HANDLER
            this.bot.on('message:photo', async (ctx: Context) => {
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

                    // Notify admin of startup (only once per instance lifetime)
                    if (!this.hasSentBootMessage && this.config.allowedChatIds && this.config.allowedChatIds.length > 0) {
                        this.hasSentBootMessage = true;
                        this.bot?.api.sendMessage(this.config.allowedChatIds[0], "🤖 Silhouette OS: Telegram Uplink Online").catch(() => { });
                    }
                },
            }).catch((err) => {
                logger.error('[Telegram] Polling error:', err);
                this.connected = false;
            });

            this.connected = true;

        } catch (err: any) {
            logger.error('[Telegram] Failed to connect:', err);
            throw err;
        }
    }

    // ─── INCOMING MESSAGE HANDLER ────────────────────────────────────────────

    private async handleIncoming(ctx: Context) {
        if (!ctx.message || !ctx.from) return;

        const chatId = ctx.chat?.id.toString() || String(ctx.from.id);

        // START typing immediately — user sees "typing..." right away
        const typing = new TypingIndicator();
        if (this.bot) {
            typing.start(this.bot, chatId);
            this.activeTyping.set(chatId, typing);
        }

        try {
            logger.info(`[Telegram] 📥 Received message from ${ctx.from.id} (@${ctx.from.username || 'unknown'}): "${ctx.message.text}"`);
            const incoming: IncomingMessage = {
                id: String(ctx.message.message_id),
                channel: 'telegram',
                senderId: String(ctx.from.id),
                senderName: ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : ''),
                chatId: chatId,
                text: ctx.message.text || '',
                timestamp: ctx.message.date * 1000,
                isGroup: ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup',
                isReadOnly: this.config.responseMode === 'read-only'
            };

            this.lastMessageTime = Date.now();

            // Dispatch to Orchestrator via Router
            for (const handler of this.handlers) {
                try { await handler(incoming); } catch (err) {
                    logger.error('[Telegram] Handler error:', err);
                }
            }
        } catch (err: any) {
            // ERROR FEEDBACK: User gets a clear error message
            logger.error(`[Telegram] Processing failed for ${chatId}:`, err.message);
            try {
                await ctx.reply("❌ Error procesando tu mensaje. El sistema está reintentando automáticamente.");
            } catch { /* If even the error message fails, nothing we can do */ }
        } finally {
            // ALWAYS stop typing when done
            typing.stop();
            this.activeTyping.delete(chatId);
        }
    }

    async disconnect(): Promise<void> {
        // Stop all active typing indicators
        for (const [, typing] of this.activeTyping) {
            typing.stop();
        }
        this.activeTyping.clear();

        if (this.bot) {
            await this.bot.stop();
            this.bot = null;
        }
        this.connected = false;
        logger.info('[Telegram] Disconnected.');
    }

    // ─── SEND MESSAGE (Production Quality) ───────────────────────────────────

    async send(message: OutgoingMessage): Promise<string | null> {
        if (!this.bot || !this.connected) {
            logger.warn('[Telegram] Cannot send: Bot not connected.');
            return null;
        }

        const chatId = /^-?\d+$/.test(message.chatId) ? parseInt(message.chatId, 10) : message.chatId;

        // 1. FILTER INTERNAL THOUGHTS (enhanced)
        message.text = stripInternalThoughts(message.text || '');
        if (!message.text && (!message.media || message.media.length === 0)) {
            logger.warn(`[Telegram] 🛑 Message dropped by internal filter (no user-facing content left).`);
            return null;
        }

        try {
            logger.info(`[Telegram] 📤 Preparing to send message to ${chatId}. Length: ${message.text?.length || 0}`);
            // 2. SEND TYPING if requested or message is long
            if (message.showTyping || message.text.length > 50) {
                await this.bot.api.sendChatAction(chatId, 'typing').catch(() => { });
            }

            // 3. HANDLE MEDIA
            if (message.media && message.media.length > 0) {
                for (const media of message.media) {
                    try {
                        if (media.type === 'image' && media.url) {
                            await this.bot.api.sendPhoto(chatId, media.url, { caption: media.caption });
                        } else if (media.type === 'video' && media.url) {
                            await this.bot.api.sendVideo(chatId, media.url, { caption: media.caption });
                        }
                    } catch (mediaErr: any) {
                        logger.error(`[Telegram] Media send failed: ${mediaErr.message}`);
                    }
                }
            }

            // 4. SEND TEXT with chunking + Markdown fallback
            if (message.text && message.text.trim().length > 0) {
                const chunks = chunkMessage(message.text);
                let lastMessageId: number | null = null;

                for (const chunk of chunks) {
                    const msgId = await safeSendMessage(this.bot, chatId, chunk);
                    if (msgId) lastMessageId = msgId;

                    // Small delay between chunks to avoid rate limits
                    if (chunks.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }

                return lastMessageId ? String(lastMessageId) : 'sent';
            }

            return 'media-sent';

        } catch (err: any) {
            logger.error(`[Telegram] Send error to ${chatId}:`, err.message);

            // Try to notify user of error
            try {
                await this.bot.api.sendMessage(chatId, "⚠️ Error enviando la respuesta. Revisa los logs del sistema.");
            } catch { /* Silent */ }

            return null;
        }
    }

    // ─── PUBLIC TYPING CONTROL ───────────────────────────────────────────────
    // Called externally to start/stop typing for a specific chat
    // (useful when Orchestrator is processing and wants to signal activity)

    startTypingFor(chatId: string) {
        if (!this.bot) return;
        const existing = this.activeTyping.get(chatId);
        if (existing) return; // Already typing

        const typing = new TypingIndicator();
        typing.start(this.bot, chatId);
        this.activeTyping.set(chatId, typing);
    }

    stopTypingFor(chatId: string) {
        const typing = this.activeTyping.get(chatId);
        if (typing) {
            typing.stop();
            this.activeTyping.delete(chatId);
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
            metadata: {
                activeTypingChats: this.activeTyping.size,
            }
        };
    }

    isConnected(): boolean {
        return this.connected;
    }

    // ─── VOICE MESSAGE HANDLER ───────────────────────────────────────────────

    private async handleVoiceMessage(ctx: Context) {
        if (!ctx.message?.voice) return;

        const chatId = ctx.chat?.id.toString() || String(ctx.from?.id);
        const typing = new TypingIndicator();

        try {
            if (this.bot) typing.start(this.bot, chatId);

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

            // 4. Show transcription to user
            await safeSendMessage(this.bot!, chatId, `📝 _Transcrito:_ ${transcription}`);

            // 5. Inject as text and re-process
            ctx.message.text = transcription;
            return this.handleIncoming(ctx);

        } catch (err: any) {
            logger.error('[Telegram] Voice processing failed:', err.message);
            await ctx.reply("⚠️ No pude procesar tu mensaje de voz. Intenta enviarlo de nuevo.");
        } finally {
            typing.stop();
        }
    }
}
