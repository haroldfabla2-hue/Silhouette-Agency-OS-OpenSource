// =============================================================================
// Email Panel
// Lightweight Gmail inbox viewer - lazy-loaded side panel
// Uses HTTP API endpoints instead of direct service imports (Browser-safe)
// =============================================================================

import React, { useState, useEffect } from 'react';
import { EmailLayout } from './email/EmailLayout';
import { Email } from '../types';
import { X, Loader } from 'lucide-react';

interface EmailPanelProps {
    isOpen?: boolean;
    onClose: () => void;
}

// API Helper for Gmail endpoints
const gmailApi = {
    async checkStatus(): Promise<{ connected: boolean; unreadCount: number }> {
        const res = await fetch('/v1/gmail/status');
        if (!res.ok) throw new Error('Gmail status check failed');
        return res.json();
    },
    async getInbox(limit = 10): Promise<Email[]> {
        const res = await fetch(`/v1/gmail/inbox?limit=${limit}`);
        if (!res.ok) throw new Error('Failed to fetch inbox');
        const data = await res.json();
        // Map API response to Email type
        return (data.emails || []).map((e: any) => ({
            id: e.id,
            from: e.from,
            to: e.to,
            subject: e.subject,
            snippet: e.snippet,
            body: e.body,
            date: e.date,
            isRead: !e.isUnread,
            labels: e.labels,
            attachments: e.attachments
        }));
    },
    async markAsRead(emailId: string): Promise<void> {
        const res = await fetch(`/v1/gmail/mark-read/${emailId}`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to mark as read');
    },
    async send(to: string, subject: string, body: string): Promise<boolean> {
        const res = await fetch('/v1/gmail/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, body })
        });
        const data = await res.json();
        return data.success === true;
    }
};

export const EmailPanel: React.FC<EmailPanelProps> = ({ isOpen = true, onClose }) => {
    // Early return if not open
    if (!isOpen) return null;
    const [connected, setConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [emails, setEmails] = useState<Email[]>([]);
    const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
    const [currentFolder, setCurrentFolder] = useState('INBOX');
    const [composeOpen, setComposeOpen] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const PAGE_SIZE = 10;

    // Initial check
    useEffect(() => {
        checkConnection();
    }, []);

    const checkConnection = async () => {
        try {
            const status = await gmailApi.checkStatus();
            setConnected(status.connected);
            if (status.connected) {
                await loadEmails();
            }
        } catch (e) {
            console.error("Email Panel: Not connected", e);
            setConnected(false);
        } finally {
            setInitializing(false);
        }
    };

    const loadEmails = async (reset = true) => {
        if (reset) {
            setLoading(true);
            setEmails([]);
        } else {
            setLoadingMore(true);
        }
        try {
            const currentCount = reset ? 0 : emails.length;
            const inbox = await gmailApi.getInbox(currentCount + PAGE_SIZE);

            if (reset) {
                setEmails(inbox);
            } else {
                // Append only new emails (dedupe by id)
                const existingIds = new Set(emails.map(e => e.id));
                const newEmails = inbox.filter(e => !existingIds.has(e.id));
                setEmails(prev => [...prev, ...newEmails]);
            }

            // Check if there are more to load
            setHasMore(inbox.length >= (currentCount + PAGE_SIZE));
        } catch (e) {
            console.error("Failed to load emails", e);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const loadMoreEmails = () => {
        if (!loadingMore && hasMore) {
            loadEmails(false);
        }
    };

    const handleSelectEmail = async (email: Email) => {
        setSelectedEmail(email);
        if (!email.isRead) {
            try {
                await gmailApi.markAsRead(email.id);
                // Update local state
                setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
            } catch (e) {
                console.error("Failed to mark as read", e);
            }
        }
    };

    const handleCompose = () => {
        setComposeOpen(true);
    };

    if (initializing) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur">
                <Loader className="animate-spin text-cyan-500" size={32} />
            </div>
        );
    }

    if (!connected) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur">
                <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center max-w-md">
                    <h2 className="text-xl font-bold text-white mb-4">Connect Gmail</h2>
                    <p className="text-slate-400 mb-6">Link your Google account to access the full Agency Email Client.</p>
                    <button onClick={checkConnection} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors">
                        Connect Account
                    </button>
                    <button onClick={onClose} className="mt-4 text-slate-500 text-sm hover:text-white block w-full">
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-6 z-40 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 ring-1 ring-black/50">
            {/* Window Controls */}
            <div className="absolute top-0 right-0 p-2 z-50 flex gap-2">
                <button onClick={onClose} className="bg-red-500/80 hover:bg-red-500 text-white p-1 rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                </button>
            </div>

            <EmailLayout
                emails={emails}
                loading={loading}
                loadingMore={loadingMore}
                hasMore={hasMore}
                selectedEmail={selectedEmail}
                currentFolder={currentFolder}
                onSelectEmail={handleSelectEmail}
                onCompose={handleCompose}
                onRefresh={() => loadEmails(true)}
                onFolderChange={setCurrentFolder}
                onLoadMore={loadMoreEmails}
                className="w-full h-full"
            />

            {/* Compose Modal Overlay (Simple version for now) */}
            {composeOpen && (
                <div className="absolute bottom-0 right-10 w-[500px] bg-slate-900 border border-slate-700 rounded-t-lg shadow-2xl flex flex-col z-50">
                    <div className="bg-slate-800 p-3 flex justify-between items-center rounded-t-lg border-b border-slate-700">
                        <span className="font-bold text-sm text-white">New Message</span>
                        <button onClick={() => setComposeOpen(false)}><X size={16} className="text-slate-400 hover:text-white" /></button>
                    </div>
                    <div className="p-4 space-y-3">
                        <input type="text" placeholder="Recipients" className="w-full bg-transparent border-b border-slate-700 pb-1 text-sm text-white focus:outline-none focus:border-cyan-500" />
                        <input type="text" placeholder="Subject" className="w-full bg-transparent border-b border-slate-700 pb-1 text-sm text-white focus:outline-none focus:border-cyan-500" />
                        <textarea className="w-full h-64 bg-transparent resize-none text-sm text-white focus:outline-none" placeholder="Message body..."></textarea>
                    </div>
                    <div className="p-3 border-t border-slate-700 flex justify-between items-center bg-slate-800/50">
                        <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full text-sm">Send</button>
                        <button onClick={() => setComposeOpen(false)} className="text-slate-400 hover:text-white text-sm">Discard</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmailPanel;
