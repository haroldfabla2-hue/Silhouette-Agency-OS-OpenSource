import { Bot, Context, InputFile } from 'grammy';
import { configLoader } from '../../server/config/configLoader';
import { logger } from '../../services/logger';
import { orchestrator } from '../orchestrator';

// ═══════════════════════════════════════════════════════════════
// UTILITY: Continuous Typing (Telegram expires typing after ~5s)
// ═══════════════════════════════════════════════════════════════

class TypingIndicator {
    private interval: NodeJS.Timeout | null = null;
    start(bot: Bot, chatId: string | number) {
        const id = String(chatId);
        bot.api.sendChatAction(id, 'typing').catch(() => { });
        this.interval = setInterval(() => {
            bot.api.sendChatAction(id, 'typing').catch(() => { });
        }, 4000);
    }
    stop() {
        if (this.interval) { clearInterval(this.interval); this.interval = null; }
    }
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: Message Chunking (4096 char Telegram limit)
// ═══════════════════════════════════════════════════════════════

const MAX_LEN = 4000;

function chunkMessage(text: string): string[] {
    if (text.length <= MAX_LEN) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX_LEN) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n\n', MAX_LEN);
        if (splitAt < MAX_LEN * 0.3) splitAt = remaining.lastIndexOf('\n', MAX_LEN);
        if (splitAt < MAX_LEN * 0.3) { splitAt = remaining.lastIndexOf('. ', MAX_LEN); if (splitAt > 0) splitAt += 1; }
        if (splitAt < MAX_LEN * 0.3) splitAt = remaining.lastIndexOf(' ', MAX_LEN);
        if (splitAt <= 0) splitAt = MAX_LEN;
        chunks.push(remaining.substring(0, splitAt).trim());
        remaining = remaining.substring(splitAt).trim();
    }
    return chunks.filter(c => c.length > 0);
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: Safe Markdown Send (fallback to plain text)
// ═══════════════════════════════════════════════════════════════

async function safeSend(bot: Bot, chatId: string, text: string): Promise<void> {
    try {
        await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e: any) {
        if (e.error_code === 400 || e.description?.includes('parse')) {
            await bot.api.sendMessage(chatId, text).catch(() => { });
        } else { throw e; }
    }
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM SERVICE (Legacy — enhanced with UX fixes)
// ═══════════════════════════════════════════════════════════════

export class TelegramService {
    private bot: Bot;
    private allowedUserId: number | null = null;
    private swarm = orchestrator;

    constructor() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            throw new Error('Telegram Bot Token not found in environment');
        }

        this.bot = new Bot(token);

        // Parse whitelist
        if (process.env.TELEGRAM_ALLOWED_USER_ID) {
            this.allowedUserId = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID, 10);
        }

        this.initializeMiddleware();
    }

    public setOrchestrator(swarm: typeof orchestrator) {
        this.swarm = orchestrator;
    }

    private initializeMiddleware() {
        // AUTH MIDDLEWARE
        this.bot.use(async (ctx, next) => {
            if (!ctx.from) return;

            if (this.allowedUserId && ctx.from.id !== this.allowedUserId) {
                logger.warn({ id: ctx.from.id, user: ctx.from.username }, `[Telegram] Unauthorized access attempt`);
                return;
            }
            await next();
        });

        // TEXT HANDLER
        this.bot.on('message:text', async (ctx) => {
            const userId = ctx.from.id.toString();
            const text = ctx.message.text;
            const chatId = ctx.chat.id.toString();

            logger.info({ userId, text }, `[Telegram] Message received`);

            // Start continuous typing immediately
            const typing = new TypingIndicator();
            typing.start(this.bot, chatId);

            try {
                if (this.swarm) {
                    await this.swarm.handleUserMessage({
                        userId,
                        chatId,
                        text,
                        platform: 'telegram',
                        channelId: 'telegram'
                    });
                } else {
                    await ctx.reply("System Initializing... Please wait.");
                }
            } catch (err: any) {
                logger.error({ error: err.message }, `[Telegram] Processing failed`);
                await ctx.reply("❌ Error procesando tu mensaje. El sistema está reintentando automáticamente.").catch(() => { });
            } finally {
                typing.stop();
            }
        });

        // ERROR HANDLER
        this.bot.catch((err) => {
            logger.error({ error: err.message || err }, `[Telegram] Bot ERROR`);
        });
    }

    public async launch() {
        logger.info({}, '[Telegram] Launching Bot...');
        await this.bot.start({
            onStart: (botInfo) => {
                logger.info({ username: botInfo.username }, `[Telegram] Bot @${botInfo.username} is connected and polling.`);
            }
        });
    }

    public async sendMessage(chatId: string, text: string) {
        try {
            const chunks = chunkMessage(text);
            for (const chunk of chunks) {
                await safeSend(this.bot, chatId, chunk);
                if (chunks.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        } catch (error: any) {
            logger.error({ error: error.message || error, chatId }, `[Telegram] Failed to send message`);
        }
    }

    public async sendPhoto(chatId: string, url: string, caption?: string) {
        try {
            await this.bot.api.sendPhoto(chatId, url, { caption });
        } catch (error: any) {
            logger.error({ error: error.message || error, chatId }, `[Telegram] Failed to send photo`);
        }
    }

    public async sendVideo(chatId: string, url: string, caption?: string) {
        try {
            await this.bot.api.sendVideo(chatId, url, { caption });
        } catch (error: any) {
            logger.error({ error: error.message || error, chatId }, `[Telegram] Failed to send video`);
        }
    }
}
