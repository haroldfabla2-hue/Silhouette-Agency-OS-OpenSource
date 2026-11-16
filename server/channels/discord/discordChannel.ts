import { ResourceScope, ScopeClosingError, type ScopeReport } from '../../runtime/resourceScope';
// =============================================================================
// DISCORD CHANNEL V2
// Discord bot integration using discord.js.
// Production: continuous typing, message chunking (2000 char limit),
// error feedback, embed support, thought filtering.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';

// ═══════ UTILITIES ═══════

class TypingIndicator {
    private interval:NodeJS.Timeout|null=null;
    private release?:()=>Promise<void>;
    constructor(private readonly owner:ResourceScope){}
    start(channel:any){
        this.owner.assertAccepting();if(this.interval)return;
        if(channel&&'sendTyping' in channel){
            const send=()=>{if(this.owner.accepting)void this.owner.run('discord-typing',()=>channel.sendTyping()).catch(()=>{/* retained */});};
            send();this.interval=setInterval(send,9000);const timer=this.interval;
            this.release=this.owner.own({name:'discord-typing-timer',stopIntake:()=>clearInterval(timer),close:()=>clearInterval(timer)});
        }
    }
    stop(){if(this.interval){clearInterval(this.interval);this.interval=null;}if(this.release){void this.release();this.release=undefined;}}
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

const _INTERNAL_PATTERNS = [
    /^\[THOUGHT\]/i, /^\[INTERNAL\]/i, /^Introspection:/i, /^<think>/i,
    /^SYSTEM:/, /^\[REFLECTIVE\]/i, /^\[COGNITIVE\]/i, /^\[SELF-HEAL\]/i,
    /^\[BUS\]/i, /^\[DAEMON\]/i,
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

// ═══════ DISCORD CHANNEL ═══════

class DiscordChannel implements IChannel {
    readonly name='discord';
    private closeReport?:ScopeReport;
    private readonly operations=new ResourceScope('discord-channel');
    private connecting?:Promise<void>;
    private destroying?:Promise<void>;
    public getLifecycleStatus(){return {closeReport:this.closeReport,diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    private destroy(client:any):Promise<void>{if(!this.destroying)this.destroying=Promise.resolve().then(()=>client.destroy());return this.destroying;}
    private pause(ms:number):Promise<void>{
        this.operations.signal.throwIfAborted();
        return new Promise<void>((resolve,reject)=>{
            const done=()=>{clearTimeout(timer);this.operations.signal.removeEventListener('abort',abort);};
            const abort=()=>{done();reject(this.operations.signal.reason??new ScopeClosingError('discord-channel'));};
            const timer=setTimeout(()=>{done();resolve();},ms);
            this.operations.signal.addEventListener('abort',abort,{once:true});if(this.operations.signal.aborted)abort();
        });
    }

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

    connect():Promise<void>{if(!this.connecting)this.connecting=this.connectOnce();return this.connecting;}
    private async connectOnce():Promise<void>{
        return this.operations.run('connectOnce',async()=>{

        try {
            const { Client, GatewayIntentBits } = await import('discord.js');

            this.operations.assertAccepting();
            const client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.DirectMessages,
                ],
            });

            this.client=client;
            const listeners:Array<{event:string,handler:(...args:any[])=>void}>=[];
            const on=(event:string,handler:(...args:any[])=>void)=>{
                listeners.push({event,handler});client.on(event,handler);
            };
            this.operations.own({name:'discord-sdk',stopIntake:()=>{
                this.connected=false;for(const l of listeners)if(l.event!=='error')client.off(l.event,l.handler);
                // destroy initiates transport closure; do not wait for all SDK
                // work here before the application drain can progress.
                void this.destroy(client).catch(error=>this.operations.recordFailure('discord-destroy-initiation',error));
            },close:async()=>{
                await this.destroy(client);for(const l of listeners)if(l.event==='error')client.off(l.event,l.handler);if(this.client===client)this.client=null;
                return {state:'UNVERIFIED',detail:'Client.destroy awaited; active SDK REST/retry work and HTTP pool release not exposed by this receipt'};
            }});
            on('ready', () => {
                if(!this.operations.accepting)return;
                this.connected = true;
                this.connectTime = Date.now();
                console.log(`[Discord] ✅ Bot is online as ${this.client.user?.tag}`);
            });

            on('messageCreate', (msg:any) => {
                if(!this.operations.accepting)return;
                void this.operations.run('discord-incoming',async()=>{
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
                const typing = new TypingIndicator(this.operations);
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
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

                            console.error('[Discord] Handler error:', err);
                        }
                    }
                } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

                    console.error(`[Discord] Processing failed:`, err.message);
                    try {
                        await msg.channel.send('❌ Error procesando tu mensaje.');
                    } catch { /* silent */ }
                } finally {
                    typing.stop();
                }
                }).catch(()=>{/* retained */});
            });

            on('error', (err: Error) => {
                this.operations.recordDiagnostic('discord-sdk-error',err,'UNCLASSIFIED','UNVERIFIED');
                console.error('[Discord] Client error:', err.message);
            });

            await client.login(this.config.botToken);
            if(!this.operations.accepting)throw new ScopeClosingError('discord-channel');

        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

            if (err.code === 'MODULE_NOT_FOUND') {
                console.warn('[Discord] ⚠️ discord.js not installed. Run: npm install discord.js');
            }
            throw err;
        }
    
        });
    }

    beginShutdown():void {void this.operations.close().then(report=>{this.closeReport=report;}).catch(error=>this.operations.recordFailure('channel-shutdown-initiation',error));}
    async disconnect():Promise<void>{
        const report=await this.operations.close();this.closeReport=report;
        if(report.state==='FAILED')throw new AggregateError(report.failures.map(f=>f.error),'Discord close failed');
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        return this.operations.run('send',async()=>{

        if (!this.client || !this.connected) return null;

        message.text = stripInternalThoughts(message.text || '');
        if (!message.text && (!message.media || message.media.length === 0)) return null;

        try {
            const channel = await this.client.channels.fetch(message.chatId);
            if (!channel || !('send' in channel)) return null;

            // Continuous typing while sending
            if (message.showTyping && 'sendTyping' in channel) {
                await (channel as any).sendTyping();
                await this.pause(500);
            }

            // Media attachments
            if (message.media && message.media.length > 0) {
                for (const media of message.media) {
                    try {
                        if (media.url) {
                            await (channel as any).send({ files: [{ attachment: media.url, name: media.filename }] });
                        }
                    } catch (mediaErr: any) {
            this.operations.recordDiagnostic('send',mediaErr,'DEGRADED_FALLBACK','UNVERIFIED');

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
                    if (chunks.length > 1) await this.pause(300);
                }
                return lastId;
            }

            return 'media-sent';
        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('send',err,'DEGRADED_FALLBACK','UNVERIFIED');

            console.error('[Discord] Send error:', err.message);
            return null;
        }
    
        });
    }

    onMessage(handler:MessageHandler):()=>void{
        this.operations.assertAccepting();this.handlers.push(handler);
        return ()=>{const i=this.handlers.indexOf(handler);if(i>=0)this.handlers.splice(i,1);};
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

    isConnected(): boolean { return this.connected; }
}

export { DiscordChannel };
