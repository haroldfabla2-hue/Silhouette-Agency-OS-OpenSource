// =============================================================================
// WHATSAPP CHANNEL V2
// WhatsApp integration using Baileys (open-source, no Meta API needed).
// Production: continuous typing, chunking, error feedback, media support.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';

// ═══════ UTILITIES (shared patterns from Telegram hardening) ═══════

class TypingIndicator {
    private interval: NodeJS.Timeout | null = null;
    start(sock: any, chatId: string) {
        sock.presenceSubscribe(chatId).catch(() => { });
        sock.sendPresenceUpdate('composing', chatId).catch(() => { });
        this.interval = setInterval(() => {
            sock.sendPresenceUpdate('composing', chatId).catch(() => { });
        }, 4000);
    }
    stop(sock: any, chatId?: string) {
        if (this.interval) { clearInterval(this.interval); this.interval = null; }
        if (sock && chatId) sock.sendPresenceUpdate('paused', chatId).catch(() => { });
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

const INTERNAL_PATTERNS = [
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
    readonly name = 'whatsapp';

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

    async connect(): Promise<void> {
        try {
            const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
                await import('@whiskeysockets/baileys');

            const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionPath);

            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
            });

            this.sock.ev.on('connection.update', (update: any) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'close') {
                    const shouldReconnect =
                        (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
                    if (shouldReconnect) {
                        console.log('[WhatsApp] Reconnecting...');
                        this.connect();
                    } else {
                        console.log('[WhatsApp] Logged out, not reconnecting');
                        this.connected = false;
                    }
                } else if (connection === 'open') {
                    this.connected = true;
                    this.connectTime = Date.now();
                    console.log('[WhatsApp] ✅ Connected');
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('messages.upsert', async (m: any) => {
                if (m.type !== 'notify') return;

                for (const msg of m.messages) {
                    if (msg.key.remoteJid === 'status@broadcast') continue;
                    if (msg.key.fromMe) continue;

                    const sender = msg.key.participant ?? msg.key.remoteJid ?? '';
                    const chatId = msg.key.remoteJid ?? '';

                    if (this.config.accessMode !== 'open') {
                        if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
                            const cleanSenderId = sender.replace(/@.*$/, '');
                            console.log(`[WhatsApp] 🛡️ First-contact secured! Trusting user ${cleanSenderId}`);
                            this.config.allowFrom = [cleanSenderId];
                            this.persistAllowedId(cleanSenderId);
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
                    const typing = new TypingIndicator();
                    typing.start(this.sock, chatId);

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
                                console.error('[WhatsApp] Handler error:', err);
                            }
                        }
                    } catch (err: any) {
                        console.error(`[WhatsApp] Processing failed for ${chatId}:`, err.message);
                        try {
                            await this.sock.sendMessage(chatId, { text: '❌ Error procesando tu mensaje.' });
                        } catch { /* silent */ }
                    } finally {
                        typing.stop(this.sock, chatId);
                    }
                }
            });

        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                console.warn('[WhatsApp] ⚠️ @whiskeysockets/baileys not installed. Run: npm install @whiskeysockets/baileys');
            }
            throw err;
        }
    }

    private async persistAllowedId(id: string) {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const envPath = path.join(process.cwd(), '.env.local');
            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf8');
                if (envContent.includes('WHATSAPP_ALLOWED_IDS=')) {
                    envContent = envContent.replace(/WHATSAPP_ALLOWED_IDS=.*/g, `WHATSAPP_ALLOWED_IDS=${id}`);
                } else {
                    envContent += `\nWHATSAPP_ALLOWED_IDS=${id}\n`;
                }
                fs.writeFileSync(envPath, envContent, 'utf8');
                console.log(`[WhatsApp] 🔒 Allowed ID ${id} saved to .env.local`);
            }
        } catch (e) {
            console.warn(`[WhatsApp] Failed to persist ID:`, e);
        }
    }

    async disconnect(): Promise<void> {
        for (const [chatId, typing] of this.activeTyping) {
            typing.stop(this.sock, chatId);
        }
        this.activeTyping.clear();
        if (this.sock) { this.sock.end(undefined); this.sock = null; }
        this.connected = false;
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        if (!this.sock || !this.connected) return null;

        message.text = stripInternalThoughts(message.text || '');
        if (!message.text && (!message.media || message.media.length === 0)) return null;

        try {
            // Typing indicator
            if (message.showTyping) {
                await this.sock.presenceSubscribe(message.chatId);
                await this.sock.sendPresenceUpdate('composing', message.chatId);
                await new Promise(resolve => setTimeout(resolve, 800));
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
                    if (chunks.length > 1) await new Promise(r => setTimeout(r, 300));
                }
                return lastId;
            }

            return 'media-sent';
        } catch (err: any) {
            console.error('[WhatsApp] Send error:', err.message);
            try {
                await this.sock.sendMessage(message.chatId, { text: '⚠️ Error enviando respuesta.' });
            } catch { /* silent */ }
            return null;
        }
    }

    onMessage(handler: MessageHandler): void { this.handlers.push(handler); }

    getStatus(): ChannelStatus {
        return {
            channel: 'whatsapp',
            connected: this.connected,
            uptime: this.connected ? Date.now() - this.connectTime : 0,
            lastMessage: this.lastMessageTime || undefined,
        };
    }

    isConnected(): boolean { return this.connected; }
}

export { WhatsAppChannel };
