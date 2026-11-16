import { ResourceScope, ScopeClosingError, type ScopeReport } from '../../runtime/resourceScope';
// =============================================================================
// TELEGRAM CHANNEL V2
// Telegram bot integration using grammY framework.
// Production-grade: continuous typing, message chunking, error handling,
// Markdown fallback, enhanced thought filtering.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';
import type { Bot, Context } from 'grammy';
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
    private interval:NodeJS.Timeout|null=null;
    private release?:()=>Promise<void>;
    constructor(private readonly owner:ResourceScope){}
    start(bot:Bot,chatId:string) {
        this.owner.assertAccepting();
        if(this.interval)return;
        const send=()=>{if(this.owner.accepting)void this.owner.run('telegram-typing',()=>bot.api.sendChatAction(chatId,'typing')).catch(()=>{/* retained */});};
        send();this.interval=setInterval(send,4000);
        const timer=this.interval;
        this.release=this.owner.own({name:'telegram-typing-timer',stopIntake:()=>clearInterval(timer),close:()=>clearInterval(timer)});
    }
    stop(){if(this.interval){clearInterval(this.interval);this.interval=null;}if(this.release){void this.release();this.release=undefined;}}
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

const _INTERNAL_PATTERNS = [
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
    private readonly pendingPairings=new Map<string,{senderId:string,state:'PENDING_AUTHENTICATED_OWNER_APPROVAL',reason:string}>();
    public getPendingPairings(){return [...this.pendingPairings.values()].map(p=>({...p}));}
    private pendPairing(senderId:string):void {
        if(!this.pendingPairings.has(senderId))this.pendingPairings.set(senderId,{senderId,state:'PENDING_AUTHENTICATED_OWNER_APPROVAL',reason:'An empty allowlist and first contact are not approval; verify owner identity and exact channel sender binding before an allowlist/configuration change'});
    }

    private closeReport?:ScopeReport;
    private readonly operations=new ResourceScope('telegram-channel');
    private connecting?:Promise<void>;
    private polling?:Promise<void>;
    private stopping?:Promise<void>;
    public getLifecycleStatus(){return {closeReport:this.closeReport,pendingPairings:this.getPendingPairings(),diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    private stopPolling(bot:Bot):Promise<void>{
        if(!this.stopping)this.stopping=bot.stop();
        return this.stopping;
    }
    private async voiceBytes(url:string):Promise<ArrayBuffer>{
        this.operations.assertAccepting();
        const controller=new AbortController();
        const release=this.operations.own({name:'telegram-voice-http',stopIntake:()=>controller.abort(),close:()=>controller.abort()});
        let response:Response|undefined;
        try { response=await fetch(url,{signal:controller.signal});return await response.arrayBuffer(); }
        finally {
            if(response?.body&&!response.bodyUsed)try {await response.body.cancel();}catch(error){this.operations.recordFailure('telegram-voice-body-cleanup',error);}
            await release();
        }
    }
    private pause(ms:number):Promise<void>{
        this.operations.signal.throwIfAborted();
        return new Promise<void>((resolve,reject)=>{
            const done=()=>{clearTimeout(timer);this.operations.signal.removeEventListener('abort',abort);};
            const abort=()=>{done();reject(this.operations.signal.reason??new ScopeClosingError('telegram-channel'));};
            const timer=setTimeout(()=>{done();resolve();},ms);
            this.operations.signal.addEventListener('abort',abort,{once:true});
            if(this.operations.signal.aborted)abort();
        });
    }
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

    connect():Promise<void>{
        if(this.connecting)return this.connecting;
        this.connecting=this.connectOnce();return this.connecting;
    }
    private async connectOnce():Promise<void>{
        return this.operations.run('connectOnce',async()=>{

        try {
            logger.info('[Telegram] Connecting...');
            const {Bot}=await import('grammy');
            this.operations.assertAccepting();
            const bot=new Bot(this.config.botToken);this.bot=bot;
            this.operations.own({name:'telegram-bot',stopIntake:()=>this.stopPolling(bot),close:async()=>{
                await this.stopPolling(bot);await this.polling;
                this.connected=false;if(this.bot===bot)this.bot=null;
                return {state:'UNVERIFIED',detail:'Actual polling/middleware completed; underlying API HTTP agent/socket pool release not established'};
            }});
            // Every SDK middleware continuation belongs to the actual generation.
            bot.use((ctx,next)=>{
                if(!this.operations.accepting)return Promise.resolve();
                return this.operations.run('telegram-middleware',()=>next());
            });

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

                // Empty configured allowlist is closed, not first-contact trust.
                // Preserve pairing as a pending owner decision, without replying
                // to the sender or writing allowlist/configuration automatically.
                if(!this.config.allowedChatIds || this.config.allowedChatIds.length===0) {
                    this.pendPairing(String(userId));
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

            // start() is the REAL polling/middleware completion receipt, not
            // the readiness promise. stop() alone does not wait middleware.
            let readyResolve!:()=>void,readyReject!:(error:unknown)=>void;
            const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
            const onAbort=()=>readyReject(this.operations.signal.reason??new ScopeClosingError('telegram-channel'));
            this.operations.signal.addEventListener('abort',onAbort,{once:true});
            this.polling=this.operations.run('telegram-polling',()=>{this.operations.assertAccepting();return bot.start({onStart:async botInfo=>{
                if(!this.operations.accepting)throw new ScopeClosingError('telegram-channel');
                this.connected=true;this.connectTime=Date.now();
                logger.info(`[Telegram] Bot @${botInfo.username} is polling.`);
                readyResolve();
                // Existing configured boot-message capability, not authority to
                // send during this source-only task. Actual promise is owned.
                if(!this.hasSentBootMessage&&this.config.allowedChatIds?.length){
                    this.hasSentBootMessage=true;
                    await this.operations.run('telegram-boot-message',()=>bot.api.sendMessage(this.config.allowedChatIds![0],'🤖 Silhouette OS: Telegram Uplink Online'));
                }
            }});});
            void this.polling.then(()=>{
                this.connected=false;readyReject(new Error('Polling ended before or after readiness'));
            },error=>{this.connected=false;readyReject(error);});
            try {await ready;} finally {this.operations.signal.removeEventListener('abort',onAbort);}

        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

            logger.error('[Telegram] Failed to connect:', err);
            throw err;
        }
    
        });
    }

    // ─── INCOMING MESSAGE HANDLER ────────────────────────────────────────────

    private async handleIncoming(ctx: Context) {
        return this.operations.run('handleIncoming',async()=>{

        if (!ctx.message || !ctx.from) return;

        const chatId = ctx.chat?.id.toString() || String(ctx.from.id);

        // START typing immediately — user sees "typing..." right away
        const typing = new TypingIndicator(this.operations);
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
            this.operations.recordDiagnostic('handleIncoming',err,'DEGRADED_FALLBACK','UNVERIFIED');

                    logger.error('[Telegram] Handler error:', err);
                }
            }
        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('handleIncoming',err,'DEGRADED_FALLBACK','UNVERIFIED');

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
    
        });
    }

    beginShutdown():void {void this.operations.close().then(report=>{this.closeReport=report;}).catch(error=>this.operations.recordFailure('channel-shutdown-initiation',error));}
    async disconnect():Promise<void>{
        for(const typing of this.activeTyping.values())typing.stop();
        this.activeTyping.clear();
        const report=await this.operations.close();this.closeReport=report;
        if(report.state==='FAILED')throw new AggregateError(report.failures.map(f=>f.error),'Telegram close failed');
    }

    // ─── SEND MESSAGE (Production Quality) ───────────────────────────────────

    async send(message: OutgoingMessage): Promise<string | null> {
        return this.operations.run('send',async()=>{

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
                await this.bot.api.sendChatAction(chatId, 'typing').catch(error=>{this.operations.recordDiagnostic('telegram-send-typing',error,'DEGRADED_FALLBACK','UNAVAILABLE');});
            }

            // Return only a real provider message ID after every requested
            // part has a receipt. Partial delivery remains unverified: never
            // manufacture 'sent'/'media-sent' or issue a second error message.
            let lastMessageId: number | null = null;
            if (message.media && message.media.length > 0) {
                for (const media of message.media) {
                    let sent;
                    if (media.type === 'image' && media.url) {
                        sent = await this.bot.api.sendPhoto(chatId, media.url, { caption: media.caption });
                    } else if (media.type === 'video' && media.url) {
                        sent = await this.bot.api.sendVideo(chatId, media.url, { caption: media.caption });
                    } else {
                        logger.error('[Telegram] Unsupported media; delivery unverified. Do not resend completed parts.');
                        return null;
                    }
                    if (!Number.isInteger(sent.message_id) || sent.message_id <= 0) return null;
                    lastMessageId = sent.message_id;
                }
            }

            // Text may span several provider messages. An accepted last chunk
            // cannot certify earlier chunks that failed.
            if (message.text && message.text.trim().length > 0) {
                const chunks = chunkMessage(message.text);
                for (const chunk of chunks) {
                    const msgId = await safeSendMessage(this.bot, chatId, chunk);
                    if (!msgId || !Number.isInteger(msgId) || msgId <= 0) return null;
                    lastMessageId = msgId;
                    if (chunks.length > 1) await this.pause(300);
                }
            }
            return lastMessageId === null ? null : String(lastMessageId);
        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('send',err,'DEGRADED_FALLBACK','UNVERIFIED');

            // The request may have reached Telegram before its response was
            // lost. Another send here risks duplicate user-facing delivery.
            logger.error(`[Telegram] Delivery unverified for ${chatId}; do not resend:`, err.message);
            return null;
        }
    
        });
    }

    // ─── PUBLIC TYPING CONTROL ───────────────────────────────────────────────
    // Called externally to start/stop typing for a specific chat
    // (useful when Orchestrator is processing and wants to signal activity)

    startTypingFor(chatId: string) {
        this.operations.assertAccepting();

        if (!this.bot) return;
        const existing = this.activeTyping.get(chatId);
        if (existing) return; // Already typing

        const typing = new TypingIndicator(this.operations);
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

    onMessage(handler:MessageHandler):()=>void{
        this.operations.assertAccepting();this.handlers.push(handler);
        return ()=>{const i=this.handlers.indexOf(handler);if(i>=0)this.handlers.splice(i,1);};
    }

    getStatus(): ChannelStatus {
        return {
            channel: 'telegram',
            connected: this.connected,
            uptime: this.connected ? Date.now() - this.connectTime : 0,
            lastMessage: this.lastMessageTime || undefined,
            metadata: {
                pendingPairingCount:this.pendingPairings.size,
                activeTypingChats: this.activeTyping.size,
            }
        };
    }

    isConnected(): boolean {
        return this.connected;
    }

    // ─── VOICE MESSAGE HANDLER ───────────────────────────────────────────────

    private async handleVoiceMessage(ctx: Context) {
        return this.operations.run('handleVoiceMessage',async()=>{

        if (!ctx.message?.voice) return;

        const chatId = ctx.chat?.id.toString() || String(ctx.from?.id);
        const typing = new TypingIndicator(this.operations);

        try {
            if (this.bot) typing.start(this.bot, chatId);

            // 1. Get File Info
            const file = await ctx.getFile();
            const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;

            // 2. Download and convert to Base64
            const buffer = await this.voiceBytes(fileUrl);
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
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('handleVoiceMessage',err,'DEGRADED_FALLBACK','UNVERIFIED');

            logger.error('[Telegram] Voice processing failed:', err.message);
            await ctx.reply("⚠️ No pude procesar tu mensaje de voz. Intenta enviarlo de nuevo.");
        } finally {
            typing.stop();
        }
    
        });
    }
}
