import { Bot, Context, InputFile } from 'grammy';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { orchestrator } from '../orchestrator';

export class TelegramService {
    private bot: Bot;
    private allowedUserId: number | null = null;
    private swarm = orchestrator;

    constructor() {
        const token = env.TELEGRAM_BOT_TOKEN;
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
                logger.warn(`[Telegram] Unauthorized access attempt from: ${ctx.from.id} (@${ctx.from.username})`);
                // Silent drop or generic reply
                return;
            }
            await next();
        });

        // TEXT HANDLER
        this.bot.on('message:text', async (ctx) => {
            const userId = ctx.from.id.toString();
            const text = ctx.message.text;

            logger.info(`[Telegram] Message from ${userId}: ${text}`);

            if (this.swarm) {
                // Determine chat ID for routing
                const chatId = ctx.chat.id.toString();

                // Indicate typing
                await ctx.replyWithChatAction('typing');

                // Send to Orchestrator (which uses logic to call tools/LLM)
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
        });

        // ERROR HANDLER
        this.bot.catch((err) => {
            logger.error(`[Telegram] Bot Erorr: ${err.message}`, err);
        });
    }

    public async launch() {
        logger.info('[Telegram] Launching Bot...');
        await this.bot.start({
            onStart: (botInfo) => {
                logger.info(`[Telegram] Bot @${botInfo.username} is connected and polling.`);
            }
        });
    }

    public async sendMessage(chatId: string, text: string) {
        try {
            await this.bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            logger.error(`[Telegram] Failed to send message to ${chatId}:`, error);
        }
    }

    public async sendPhoto(chatId: string, url: string, caption?: string) {
        try {
            await this.bot.api.sendPhoto(chatId, url, { caption });
        } catch (error) {
            logger.error(`[Telegram] Failed to send photo to ${chatId}:`, error);
        }
    }

    public async sendVideo(chatId: string, url: string, caption?: string) {
        try {
            await this.bot.api.sendVideo(chatId, url, { caption });
        } catch (error) {
            logger.error(`[Telegram] Failed to send video to ${chatId}:`, error);
        }
    }
}
