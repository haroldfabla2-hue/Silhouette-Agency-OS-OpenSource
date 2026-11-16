import { ResourceScope, ScopeClosingError, type ScopeReport } from '../../runtime/resourceScope';
// =============================================================================
// WHATSAPP CHANNEL V2
// WhatsApp integration using Baileys (open-source, no Meta API needed).
// Production: continuous typing, chunking, error feedback, media support.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';

// ═══════ UTILITIES (shared patterns from Telegram hardening) ═══════

class TypingIndicator {
    private interval:NodeJS.Timeout|null=null;
    private release?:()=>Promise<void>;
    constructor(private readonly owner:ResourceScope){}
    start(sock:any,chatId:string){
        this.owner.assertAccepting();if(this.interval)return;
        void this.owner.run('whatsapp-presence-subscribe',()=>sock.presenceSubscribe(chatId)).catch(()=>{/* retained */});
        const send=()=>{if(this.owner.accepting)void this.owner.run('whatsapp-typing',()=>sock.sendPresenceUpdate('composing',chatId)).catch(()=>{/* retained */});};
        send();this.interval=setInterval(send,4000);const timer=this.interval;
        this.release=this.owner.own({name:'whatsapp-typing-timer',stopIntake:()=>clearInterval(timer),close:()=>clearInterval(timer)});
    }
    stop(sock:any,chatId?:string){
        if(this.interval){clearInterval(this.interval);this.interval=null;}if(this.release){void this.release();this.release=undefined;}
        if(sock&&chatId&&this.owner.accepting)void this.owner.run('whatsapp-typing-paused',()=>sock.sendPresenceUpdate('paused',chatId)).catch(()=>{/* retained */});
    }
}

const WA_MAX_LEN = 4000; // WhatsApp supports ~65k, but chunk for readability

function chunkMessage(text: string, maxLen: number = WA_MAX_LEN): string[] {
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

// ═══════ WHATSAPP CHANNEL ═══════

class WhatsAppChannel implements IChannel {
    private readonly pendingPairings=new Map<string,{senderId:string,state:'PENDING_AUTHENTICATED_OWNER_APPROVAL',reason:string}>();
    public getPendingPairings(){return [...this.pendingPairings.values()].map(p=>({...p}));}
    private pendPairing(senderId:string):void {
        if(!this.pendingPairings.has(senderId))this.pendingPairings.set(senderId,{senderId,state:'PENDING_AUTHENTICATED_OWNER_APPROVAL',reason:'An empty allowlist and first contact are not approval; verify owner identity and exact channel sender binding before an allowlist/configuration change'});
    }

    readonly name='whatsapp';
    private closeReport?:ScopeReport;
    private readonly operations=new ResourceScope('whatsapp-channel');
    private connecting?:Promise<void>;
    private readonly reconnectRequests:Array<{reason:string,state:'PENDING_SDK_DRAIN_AND_ATTRIBUTION'}>=[];
    public getLifecycleStatus(){return {closeReport:this.closeReport,pendingPairings:this.getPendingPairings(),pendingReconnect:this.reconnectRequests,diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    private pause(ms:number):Promise<void>{
        this.operations.signal.throwIfAborted();
        return new Promise<void>((resolve,reject)=>{
            const done=()=>{clearTimeout(timer);this.operations.signal.removeEventListener('abort',abort);};
            const abort=()=>{done();reject(this.operations.signal.reason??new ScopeClosingError('whatsapp-channel'));};
            const timer=setTimeout(()=>{done();resolve();},ms);
            this.operations.signal.addEventListener('abort',abort,{once:true});if(this.operations.signal.aborted)abort();
        });
    }

    private handlers: MessageHandler[] = [];
    private connected = false;
    private connectTime = 0;
    private lastMessageTime = 0;
    private sock: any = null;
    private activeTyping: Map<string, TypingIndicator> = new Map();
    private config: {
        sessionPath: string;
        allowFrom?: string[];
        accessMode?: 'open' | 'allowlist';
        responseMode?: 'auto-reply' | 'read-only';
    };

    constructor(config?: { sessionPath?: string; allowFrom?: string[]; accessMode?: 'open' | 'allowlist'; responseMode?: 'auto-reply' | 'read-only' }) {
        this.config = {
            sessionPath: config?.sessionPath ?? './data/whatsapp-session',
            allowFrom: config?.allowFrom,
            accessMode: config?.accessMode ?? 'allowlist',
            responseMode: config?.responseMode ?? 'auto-reply',
        };
    }

    connect():Promise<void>{if(!this.connecting)this.connecting=this.connectOnce();return this.connecting;}
    private async connectOnce():Promise<void>{
        return this.operations.run('connectOnce',async()=>{

        try {
            const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
                await import('@whiskeysockets/baileys');

            this.operations.assertAccepting();
            const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionPath);

            this.operations.assertAccepting();
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
            });

            this.sock=sock;
            let readyResolve!:()=>void,readyReject!:(error:unknown)=>void;
            const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
            // Observe readiness failure immediately, including setup errors before
            // its await. It is not a second detached operation or a success receipt.
            void ready.catch(()=>{/* actual connectOnce awaits; retained there */});
            const listeners:Array<{event:string,handler:(...args:any[])=>void}>=[];
            const on=(event:string,handler:(...args:any[])=>void)=>{listeners.push({event,handler});sock.ev.on(event as any,handler);};
            let ended=false;
            const end=()=>{if(ended)return;ended=true;this.connected=false;
                readyReject(new ScopeClosingError('whatsapp-channel'));
                for(const l of listeners)sock.ev.off(l.event as any,l.handler);
                sock.end(undefined);
            };
            this.operations.own({name:'whatsapp-socket',stopIntake:end,close:()=>{
                end();if(this.sock===sock)this.sock=null;
                return {state:'UNVERIFIED',detail:'Baileys end is void and nulls/initiates socket close; hidden tasks and actual socket close are not awaited by its public receipt'};
            }});
            on('connection.update', (update:any) => {
                if(!this.operations.accepting)return;
                const { connection, lastDisconnect } = update;
                if (connection === 'close') {
                    this.connected=false;readyReject(new Error('WhatsApp closed before readiness or lost its connection'));
                    const shouldReconnect =
                        (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
                    if (shouldReconnect) {
                        console.log('[WhatsApp] Reconnect pending actual SDK drain/attribution; not started');
                        this.connected=false;
                        if(!this.reconnectRequests.length)this.reconnectRequests.push({reason:'SDK reported close; no new socket until real prior drain and attribution are established',state:'PENDING_SDK_DRAIN_AND_ATTRIBUTION'});
                    } else {
                        console.log('[WhatsApp] Logged out, not reconnecting');
                        this.connected = false;
                    }
                } else if (connection === 'open') {
                    this.connected = true;
                    this.connectTime = Date.now();
                    readyResolve();
                    console.log('[WhatsApp] ✅ Connected');
                }
            });

            on('creds.update',()=>{if(this.operations.accepting)void this.operations.run('whatsapp-save-creds',saveCreds).catch(()=>{/* retained */});});

            on('messages.upsert',(m:any)=>{
                if(!this.operations.accepting)return;
                void this.operations.run('whatsapp-incoming',async()=>{
                if (m.type !== 'notify') return;

                for (const msg of m.messages) {
                    if (msg.key.remoteJid === 'status@broadcast') continue;
                    if (msg.key.fromMe) continue;

                    const sender = msg.key.participant ?? msg.key.remoteJid ?? '';
                    const chatId = msg.key.remoteJid ?? '';

                    if (this.config.accessMode !== 'open') {
                        if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
                            this.pendPairing(sender);
                            continue;
                        } else if (!this.config.allowFrom.some((n: string) => sender.includes(n))) {
                            console.warn(`[WhatsApp] ⛔ Blocked unauthorized sender: ${sender}`);
                            continue;
                        }
                    }

                    const text = msg.message?.conversation
                        ?? msg.message?.extendedTextMessage?.text
                        ?? '';
                    if (!text) continue;

                    // Start continuous typing
                    const typing = new TypingIndicator(this.operations);
                    typing.start(sock, chatId);

                    try {
                        const incoming: IncomingMessage = {
                            id: msg.key.id ?? `wa_${Date.now()}`,
                            channel: 'whatsapp',
                            senderId: sender.replace(/@.*$/, ''),
                            senderName: msg.pushName ?? undefined,
                            chatId,
                            text,
                            timestamp: (msg.messageTimestamp ?? Date.now() / 1000) * 1000,
                            isGroup: chatId.endsWith('@g.us'),
                            replyTo: msg.message?.extendedTextMessage?.contextInfo?.stanzaId,
                            raw: msg,
                            isReadOnly: this.config.responseMode === 'read-only'
                        };

                        this.lastMessageTime = Date.now();
                        for (const handler of this.handlers) {
                            try { await handler(incoming); } catch (err) {
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

                                console.error('[WhatsApp] Handler error:', err);
                            }
                        }
                    } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

                        console.error(`[WhatsApp] Processing failed for ${chatId}:`, err.message);
                        try {
                            await this.sock.sendMessage(chatId, { text: '❌ Error procesando tu mensaje.' });
                        } catch { /* silent */ }
                    } finally {
                        typing.stop(sock, chatId);
                    }
                }
                }).catch(()=>{/* retained */});
            });
            await ready;

        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('connectOnce',err,'DEGRADED_FALLBACK','UNVERIFIED');

            if (err.code === 'MODULE_NOT_FOUND') {
                console.warn('[WhatsApp] ⚠️ @whiskeysockets/baileys not installed. Run: npm install @whiskeysockets/baileys');
            }
            throw err;
        }
    
        });
    }

    // Pairing execution is intentionally unwired until an authenticated owner
    // approval can bind the exact sender/account. No env write helper exists.

    beginShutdown():void {void this.operations.close().then(report=>{this.closeReport=report;}).catch(error=>this.operations.recordFailure('channel-shutdown-initiation',error));}
    async disconnect():Promise<void>{
        const report=await this.operations.close();this.closeReport=report;
        if(report.state==='FAILED')throw new AggregateError(report.failures.map(f=>f.error),'WhatsApp close failed');
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        return this.operations.run('send',async()=>{

        if (!this.sock || !this.connected) return null;

        message.text = stripInternalThoughts(message.text || '');
        if (!message.text && (!message.media || message.media.length === 0)) return null;

        try {
            // Typing indicator
            if (message.showTyping) {
                await this.sock.presenceSubscribe(message.chatId);
                await this.sock.sendPresenceUpdate('composing', message.chatId);
                await this.pause(800);
            }

            // Media attachments
            if (message.media && message.media.length > 0) {
                for (const media of message.media) {
                    try {
                        if (media.type === 'image' && media.url) {
                            await this.sock.sendMessage(message.chatId, { image: { url: media.url }, caption: media.caption });
                        } else if (media.type === 'video' && media.url) {
                            await this.sock.sendMessage(message.chatId, { video: { url: media.url }, caption: media.caption });
                        }
                    } catch (mediaErr: any) {
            this.operations.recordDiagnostic('send',mediaErr,'DEGRADED_FALLBACK','UNVERIFIED');

                        console.error(`[WhatsApp] Media send failed: ${mediaErr.message}`);
                    }
                }
            }

            // Text with chunking
            if (message.text && message.text.trim().length > 0) {
                const chunks = chunkMessage(message.text);
                let lastId: string | null = null;
                const quoteOpts = message.replyToId ? { quoted: { key: { id: message.replyToId } } } : undefined;

                for (let i = 0; i < chunks.length; i++) {
                    const sent = await this.sock.sendMessage(message.chatId, { text: chunks[i] }, i === 0 ? quoteOpts : undefined);
                    lastId = sent?.key?.id ?? null;
                    if (chunks.length > 1) await this.pause(300);
                }
                return lastId;
            }

            return 'media-sent';
        } catch (err: any) {
            if(this.operations.signal.aborted)throw err;
            this.operations.recordDiagnostic('send',err,'DEGRADED_FALLBACK','UNVERIFIED');

            console.error('[WhatsApp] Send error:', err.message);
            try {
                await this.sock.sendMessage(message.chatId, { text: '⚠️ Error enviando respuesta.' });
            } catch { /* silent */ }
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
            channel: 'whatsapp',
            connected: this.connected,
            uptime: this.connected ? Date.now() - this.connectTime : 0,
            lastMessage: this.lastMessageTime || undefined,
            metadata:{pendingPairingCount:this.pendingPairings.size},
        };
    }

    isConnected(): boolean { return this.connected; }
}

export { WhatsAppChannel };
