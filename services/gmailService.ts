// =============================================================================
// Gmail Service
// Email operations: read inbox, send emails, notifications
// =============================================================================

import { google, gmail_v1 } from 'googleapis';
import Database from 'better-sqlite3';
import * as path from 'path';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

const DB_PATH = path.join(process.cwd(), 'db', 'silhouette.sqlite');

// Email types
export interface EmailMessage {
    id: string;
    threadId: string;
    from: string;
    to: string;
    subject: string;
    snippet: string;
    body?: string;
    date: number;
    isUnread: boolean;
    labels: string[];
    attachments?: { filename: string; mimeType: string; size: number }[];
}

export interface SendEmailOptions {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    attachmentPath?: string;
    driveLink?: string;
}

class GmailService {
    private gmail: gmail_v1.Gmail | null = null;
    private db: Database.Database | null = null;
    private initialized = false;
    private pollingInterval: NodeJS.Timeout | null = null;
    private lastHistoryId: string | null = null;
    private cachedUnreadCount = 0;

    /**
     * Initialize Gmail service (requires driveService to be authenticated first)
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        // Import driveService to share OAuth client
        const { driveService } = await import('./driveService');
        await driveService.init();

        if (!driveService.isAuthenticated()) {
            console.warn('[GmailService] ⚠️ Not authenticated - waiting for OAuth');
            return;
        }

        // Get the shared OAuth client from driveService
        const oauth2Client = (driveService as any).oauth2Client;
        if (!oauth2Client) {
            console.warn('[GmailService] ⚠️ OAuth client not available');
            return;
        }

        this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Initialize DB for storing last history ID
        this.db = new Database(DB_PATH);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS gmail_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_history_id TEXT,
        last_check INTEGER,
        CHECK (id = 1)
      )
    `);

        // Load last history ID
        const state = this.db.prepare('SELECT * FROM gmail_state WHERE id = 1').get() as any;
        if (state?.last_history_id) {
            this.lastHistoryId = state.last_history_id;
        }

        this.initialized = true;
        console.log('[GmailService] ✅ Initialized');

        // Start polling for new emails
        this.startPolling();
    }

    /**
     * Start polling for new emails every 60 seconds
     */
    startPolling(): void {
        if (this.pollingInterval) return;

        // Initial check
        this.checkNewEmails();

        // Poll every 60 seconds
        this.pollingInterval = setInterval(() => {
            this.checkNewEmails();
        }, 60000);

        console.log('[GmailService] 🔄 Started email polling (60s interval)');
    }

    /**
     * Stop polling
     */
    stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Check for new emails and emit notifications
     * Uses persistent storage to track which emails have already been notified
     * Stores IMPORTANT emails in ContinuumMemory for Silhouette to learn from
     */
    async checkNewEmails(): Promise<void> {
        if (!this.gmail || !this.db) return;

        try {
            // Create table for tracking notified emails if it doesn't exist
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS gmail_notified (
                    email_id TEXT PRIMARY KEY,
                    notified_at INTEGER,
                    is_important INTEGER DEFAULT 0
                )
            `);

            // Get recent unread emails (limit 10 to avoid spam)
            const unreadEmails = await this.getInbox(10, 'is:unread');

            // Get already notified IDs
            const notifiedRows = this.db.prepare(
                'SELECT email_id FROM gmail_notified'
            ).all() as { email_id: string }[];
            const notifiedIds = new Set(notifiedRows.map(r => r.email_id));

            let newCount = 0;
            let importantCount = 0;

            for (const email of unreadEmails) {
                if (!notifiedIds.has(email.id)) {
                    // Check if email is important
                    const isImportant = this.classifyImportance(email);

                    // This is a genuinely new email - emit notification
                    systemBus.emit(SystemProtocol.PROTOCOL_EMAIL_RECEIVED, {
                        type: 'EMAIL_RECEIVED',
                        from: email.from,
                        subject: email.subject,
                        snippet: email.snippet,
                        id: email.id,
                        isImportant
                    }, 'GmailService');

                    console.log(`[GmailService] 📧 New email: ${email.subject}${isImportant ? ' ⭐' : ''}`);

                    // Mark as notified in database
                    this.db.prepare(
                        'INSERT OR IGNORE INTO gmail_notified (email_id, notified_at, is_important) VALUES (?, ?, ?)'
                    ).run(email.id, Date.now(), isImportant ? 1 : 0);

                    // Store IMPORTANT emails in ContinuumMemory for learning
                    if (isImportant) {
                        await this.storeInMemory(email);
                        importantCount++;
                    }

                    newCount++;
                }
            }

            if (newCount > 0) {
                console.log(`[GmailService] 📬 Notified ${newCount} new emails (${importantCount} important)`);
            }

            // Update cached unread count
            this.cachedUnreadCount = await this.getUnreadCount();

            // Cleanup: Remove old notified entries (older than 7 days)
            const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            this.db.prepare('DELETE FROM gmail_notified WHERE notified_at < ?').run(weekAgo);

        } catch (error: any) {
            console.error('[GmailService] Check failed:', error.message);
        }
    }

    /**
     * Classify email importance
     * Returns true for important emails, false for newsletters/spam
     */
    private classifyImportance(email: EmailMessage): boolean {
        const fromLower = email.from.toLowerCase();
        const subjectLower = email.subject.toLowerCase();

        // SPAM/NEWSLETTER DOMAINS - Never important
        const spamDomains = [
            'noreply', 'no-reply', 'newsletter', 'marketing',
            'updates@', 'promo', 'support@email.', 'info@',
            'masterclass.com', 'stellaconnect.net', 'email.masterclass.com',
            'googlecommunityteam', 'accounts.google.com'
        ];

        if (spamDomains.some(d => fromLower.includes(d))) {
            return false;
        }

        // IMPORTANT KEYWORDS - Likely important
        const importantKeywords = [
            'urgent', 'urgente', 'importante', 'action required',
            'invoice', 'factura', 'payment', 'pago',
            'meeting', 'reunión', 'interview', 'entrevista',
            'offer', 'oferta', 'contract', 'contrato',
            'deadline', 'fecha límite'
        ];

        if (importantKeywords.some(k => subjectLower.includes(k))) {
            return true;
        }

        // PERSONAL EMAILS - From known contacts or direct messages
        // Check for direct personal email format (not @company marketing)
        const directEmailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const parsedFrom = email.from.match(/<(.+?)>/) || [null, email.from];
        const senderEmail = parsedFrom[1] || email.from;

        // If it's from a personal email (not noreply/support), consider important
        if (directEmailPattern.test(senderEmail) &&
            !spamDomains.some(d => senderEmail.includes(d))) {
            return true;
        }

        return false;
    }

    /**
     * Store important email in ContinuumMemory for Silhouette to learn from
     */
    private async storeInMemory(email: EmailMessage): Promise<void> {
        try {
            const { continuum } = await import('./continuumMemory');

            // Extract sender name cleanly
            const senderName = email.from.split('<')[0].trim() || email.from;

            // [FIX] Store email from CREATOR's perspective, not as if it's for Silhouette
            // Pattern: "My creator received an email from X about Y"
            // This aligns with how models like Claude/Gemini reason about user context
            const memorySummary = `[CREATOR_EMAIL] Mi creador recibió un correo de ${senderName} con asunto: "${email.subject}". Resumen: ${email.snippet.substring(0, 150)}`;

            await continuum.store(
                memorySummary,
                undefined,
                ['EMAIL', 'IMPORTANT', 'CREATOR_INBOX', 'USER_CONTEXT', `from:${senderName}`]
            );

            console.log(`[GmailService] 🧠 Stored important email in memory: ${email.subject.substring(0, 50)}`);
        } catch (e: any) {
            console.warn('[GmailService] Failed to store email in memory:', e.message);
        }
    }

    /**
     * Get inbox emails
     */
    async getInbox(limit = 20, query?: string): Promise<EmailMessage[]> {
        if (!this.gmail) throw new Error('Gmail not initialized');

        const response = await this.gmail.users.messages.list({
            userId: 'me',
            maxResults: limit,
            q: query || 'in:inbox',
            labelIds: ['INBOX']
        });

        const messages = response.data.messages || [];
        const emails: EmailMessage[] = [];

        // Fetch details for each message (batch)
        for (const msg of messages.slice(0, limit)) {
            try {
                const detail = await this.getMessage(msg.id!);
                if (detail) emails.push(detail);
            } catch {
                // Skip failed messages
            }
        }

        return emails;
    }

    /**
     * Get single email message with full details
     */
    async getMessage(messageId: string): Promise<EmailMessage | null> {
        if (!this.gmail) throw new Error('Gmail not initialized');

        const response = await this.gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });

        const msg = response.data;
        const headers = msg.payload?.headers || [];

        const getHeader = (name: string) =>
            headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Decode body
        let body = '';
        if (msg.payload?.body?.data) {
            body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
        } else if (msg.payload?.parts) {
            const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
            if (textPart?.body?.data) {
                body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
            }
        }

        // Get attachments info
        const attachments: EmailMessage['attachments'] = [];
        if (msg.payload?.parts) {
            for (const part of msg.payload.parts) {
                if (part.filename && part.body?.attachmentId) {
                    attachments.push({
                        filename: part.filename,
                        mimeType: part.mimeType || 'application/octet-stream',
                        size: part.body.size || 0
                    });
                }
            }
        }

        return {
            id: msg.id || '',
            threadId: msg.threadId || '',
            from: getHeader('From'),
            to: getHeader('To'),
            subject: getHeader('Subject'),
            snippet: msg.snippet || '',
            body,
            date: parseInt(msg.internalDate || '0'),
            isUnread: msg.labelIds?.includes('UNREAD') || false,
            labels: msg.labelIds || [],
            attachments: attachments.length > 0 ? attachments : undefined
        };
    }

    /**
     * Send an email
     */
    async sendEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
        if (!this.gmail) throw new Error('Gmail not initialized');

        const { driveService } = await import('./driveService');
        const userEmail = driveService.getCurrentUser();

        try {
            // Build email content
            let emailContent = options.body;

            // Append Drive link if provided
            if (options.driveLink) {
                emailContent += `\n\n📎 Archivo adjunto: ${options.driveLink}`;
            }

            // Create MIME message
            const messageParts = [
                `From: ${userEmail}`,
                `To: ${options.to}`,
                `Subject: ${options.subject}`,
                `Content-Type: ${options.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
                '',
                emailContent
            ];

            const rawMessage = Buffer.from(messageParts.join('\r\n'))
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const response = await this.gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: rawMessage
                }
            });

            console.log(`[GmailService] ✉️ Sent email to ${options.to}: ${options.subject}`);

            return { success: true, messageId: response.data.id || undefined };

        } catch (error: any) {
            console.error('[GmailService] Send failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Mark email as read
     */
    async markAsRead(messageId: string): Promise<boolean> {
        if (!this.gmail) return false;

        try {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['UNREAD']
                }
            });

            this.cachedUnreadCount = Math.max(0, this.cachedUnreadCount - 1);
            return true;

        } catch (error: any) {
            console.error('[GmailService] Mark read failed:', error.message);
            return false;
        }
    }

    /**
     * Get unread email count
     */
    async getUnreadCount(): Promise<number> {
        if (!this.gmail) return 0;

        try {
            const response = await this.gmail.users.labels.get({
                userId: 'me',
                id: 'UNREAD'
            });

            return response.data.messagesUnread || 0;

        } catch {
            return 0;
        }
    }

    /**
     * Get cached unread count (sync, for UI)
     */
    getCachedUnreadCount(): number {
        return this.cachedUnreadCount;
    }

    /**
     * Search emails
     */
    async searchEmails(query: string, limit = 20): Promise<EmailMessage[]> {
        return this.getInbox(limit, query);
    }

    /**
     * Check if initialized
     */
    isReady(): boolean {
        return this.initialized && this.gmail !== null;
    }
}

export const gmailService = new GmailService();
