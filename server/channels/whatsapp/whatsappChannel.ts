// =============================================================================
// WHATSAPP CHANNEL
// WhatsApp integration using Baileys (open-source, no Meta API needed).
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from '../channelInterface';

/**
 * WhatsApp channel implementation using Baileys.
 * 
 * NOTE: Requires `@whiskeysockets/baileys` package to be installed.
 * This is a lazy-loaded dependency — the channel won't crash if it's not installed.
 * 
 * Install: npm install @whiskeysockets/baileys
 */
class WhatsAppChannel implements IChannel {
    readonly name = 'whatsapp';

    private handlers: MessageHandler[] = [];
    private connected = false;
    private connectTime = 0;
    private lastMessageTime = 0;
    private sock: any = null;
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
            // Dynamic import to avoid hard dependency
            const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
                await import('@whiskeysockets/baileys');

            const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionPath);

            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
            });

            // Handle connection updates
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

            // Save credentials on update
            this.sock.ev.on('creds.update', saveCreds);

            // Handle incoming messages
            this.sock.ev.on('messages.upsert', async (m: any) => {
                if (m.type !== 'notify') return;

                for (const msg of m.messages) {
                    // Skip status broadcasts and own messages
                    if (msg.key.remoteJid === 'status@broadcast') continue;
                    if (msg.key.fromMe) continue;

                    // Filter by allowlist if configured (unless in OPEN mode)
                    const sender = msg.key.participant ?? msg.key.remoteJid ?? '';

                    if (this.config.accessMode !== 'open') {
                        // First-Contact Auto-Trust
                        if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
                            const cleanSenderId = sender.replace(/@.*$/, '');
                            console.log(`[WhatsApp] 🛡️ First-contact secured! Trusting user ${cleanSenderId} as Primary Admin.`);
                            this.config.allowFrom = [cleanSenderId];

                            try {
                                const fs = await import('fs');
                                const path = await import('path');
                                const envPath = path.join(process.cwd(), '.env.local');
                                if (fs.existsSync(envPath)) {
                                    let envContent = fs.readFileSync(envPath, 'utf8');
                                    if (envContent.includes('WHATSAPP_ALLOWED_IDS=')) {
                                        envContent = envContent.replace(/WHATSAPP_ALLOWED_IDS=.*/g, `WHATSAPP_ALLOWED_IDS=${cleanSenderId}`);
                                    } else {
                                        envContent += `\nWHATSAPP_ALLOWED_IDS=${cleanSenderId}\n`;
                                    }
                                    fs.writeFileSync(envPath, envContent, 'utf8');
                                    console.log(`[WhatsApp] 🔒 Allowed ID ${cleanSenderId} permanently saved to .env.local`);
                                }
                            } catch (e) {
                                console.warn(`[WhatsApp] Failed to persist ID to .env.local:`, e);
                            }
                        } else if (!this.config.allowFrom.some((n: string) => sender.includes(n))) {
                            console.warn(`[WhatsApp] ⛔ Blocked unauthorized sender: ${sender}`);
                            continue;
                        }
                    }

                    const text = msg.message?.conversation
                        ?? msg.message?.extendedTextMessage?.text
                        ?? '';

                    if (!text) continue;

                    const incoming: IncomingMessage = {
                        id: msg.key.id ?? `wa_${Date.now()}`,
                        channel: 'whatsapp',
                        senderId: sender.replace(/@.*$/, ''),
                        senderName: msg.pushName ?? undefined,
                        chatId: msg.key.remoteJid ?? '',
                        text,
                        timestamp: (msg.messageTimestamp ?? Date.now() / 1000) * 1000,
                        isGroup: msg.key.remoteJid?.endsWith('@g.us') ?? false,
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
                }
            });

        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                console.warn('[WhatsApp] ⚠️ @whiskeysockets/baileys not installed. Run: npm install @whiskeysockets/baileys');
            }
            throw err;
        }
    }

    async disconnect(): Promise<void> {
        if (this.sock) {
            this.sock.end(undefined);
            this.sock = null;
        }
        this.connected = false;
    }

    async send(message: OutgoingMessage): Promise<string | null> {
        if (!this.sock || !this.connected) return null;

        try {
            if (message.showTyping) {
                await this.sock.presenceSubscribe(message.chatId);
                await this.sock.sendPresenceUpdate('composing', message.chatId);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const sent = await this.sock.sendMessage(message.chatId, {
                text: message.text,
            }, message.replyToId ? { quoted: { key: { id: message.replyToId } } } : undefined);

            return sent?.key?.id ?? null;
        } catch (err) {
            console.error('[WhatsApp] Send error:', err);
            return null;
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    getStatus(): ChannelStatus {
        return {
            channel: 'whatsapp',
            connected: this.connected,
            uptime: this.connected ? Date.now() - this.connectTime : 0,
            lastMessage: this.lastMessageTime || undefined,
        };
    }

    isConnected(): boolean {
        return this.connected;
    }
}

export { WhatsAppChannel };
