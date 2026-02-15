// =============================================================================
// SILHOUETTE GATEWAY SESSION MANAGER
// Manages typed WS sessions with unique IDs, history, and pruning.
// =============================================================================

import { v4 as uuidv4 } from 'uuid';

// ─── Session Types ───────────────────────────────────────────────────────────

export interface SessionMessage {
    id: string;
    role: 'user' | 'agent' | 'system' | 'tool';
    content: string;
    timestamp: number;
    metadata?: {
        agentId?: string;
        toolName?: string;
        toolResult?: unknown;
        thoughts?: string[];
        model?: string;
        tokenCount?: number;
        channel?: string;    // Which channel sent this message
    };
}

export interface Session {
    id: string;
    createdAt: number;
    lastActiveAt: number;
    title?: string;
    channel?: string;          // Origin channel (web-ui, whatsapp, telegram, etc.)
    clientId?: string;         // Owning client
    agentId?: string;          // Assigned agent
    status: 'active' | 'idle' | 'compacted' | 'closed';
    messages: SessionMessage[];
    metadata: Record<string, unknown>;
    config: {
        model?: string;
        thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
        maxContextTokens?: number;
    };
    stats: {
        totalMessages: number;
        totalTokensEstimate: number;
        compactions: number;
    };
}

// ─── Session Manager ─────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of chat sessions.
 * - Create/get/delete sessions
 * - Append messages with auto-pruning
 * - Session compaction (summarize old messages)
 * - Session listing and filtering
 */
class SessionManager {
    private sessions: Map<string, Session> = new Map();
    private readonly MAX_SESSIONS = 100;
    private readonly MAX_MESSAGES_BEFORE_COMPACT = 200;
    private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

    // ── Create ────────────────────────────────────────────────────────────

    createSession(opts?: {
        channel?: string;
        clientId?: string;
        agentId?: string;
        title?: string;
        config?: Session['config'];
    }): Session {
        // Enforce max sessions limit
        if (this.sessions.size >= this.MAX_SESSIONS) {
            this.evictOldestIdleSession();
        }

        const session: Session = {
            id: uuidv4(),
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            title: opts?.title,
            channel: opts?.channel ?? 'web-ui',
            clientId: opts?.clientId,
            agentId: opts?.agentId,
            status: 'active',
            messages: [],
            metadata: {},
            config: opts?.config ?? {},
            stats: {
                totalMessages: 0,
                totalTokensEstimate: 0,
                compactions: 0,
            },
        };

        this.sessions.set(session.id, session);
        console.log(`[SessionManager] ✅ Created session ${session.id} (channel: ${session.channel})`);
        return session;
    }

    // ── Get ───────────────────────────────────────────────────────────────

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId);
    }

    getOrCreateSession(sessionId?: string, opts?: Parameters<SessionManager['createSession']>[0]): Session {
        if (sessionId) {
            const existing = this.sessions.get(sessionId);
            if (existing) {
                existing.lastActiveAt = Date.now();
                existing.status = 'active';
                return existing;
            }
        }
        return this.createSession(opts);
    }

    listSessions(filter?: {
        channel?: string;
        clientId?: string;
        status?: Session['status'];
    }): Session[] {
        let sessions = Array.from(this.sessions.values());

        if (filter?.channel) {
            sessions = sessions.filter(s => s.channel === filter.channel);
        }
        if (filter?.clientId) {
            sessions = sessions.filter(s => s.clientId === filter.clientId);
        }
        if (filter?.status) {
            sessions = sessions.filter(s => s.status === filter.status);
        }

        return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    }

    // ── Messages ──────────────────────────────────────────────────────────

    addMessage(sessionId: string, message: Omit<SessionMessage, 'id' | 'timestamp'>): SessionMessage | null {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.warn(`[SessionManager] Session ${sessionId} not found`);
            return null;
        }

        const fullMessage: SessionMessage = {
            ...message,
            id: uuidv4(),
            timestamp: Date.now(),
        };

        session.messages.push(fullMessage);
        session.lastActiveAt = Date.now();
        session.status = 'active';
        session.stats.totalMessages++;

        // Rough token estimate: ~4 chars per token
        session.stats.totalTokensEstimate += Math.ceil(message.content.length / 4);

        // Auto-compact if threshold exceeded
        if (session.messages.length > this.MAX_MESSAGES_BEFORE_COMPACT) {
            this.compactSession(sessionId);
        }

        return fullMessage;
    }

    getHistory(sessionId: string, opts?: {
        limit?: number;
        offset?: number;
        role?: SessionMessage['role'];
    }): SessionMessage[] {
        const session = this.sessions.get(sessionId);
        if (!session) return [];

        let messages = session.messages;

        if (opts?.role) {
            messages = messages.filter(m => m.role === opts.role);
        }

        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? messages.length;

        return messages.slice(offset, offset + limit);
    }

    // ── Compaction (Session Pruning) ──────────────────────────────────────

    /**
     * Compact a session by summarizing older messages.
     * Keeps the most recent messages and replaces older ones with a summary.
     */
    compactSession(sessionId: string, keepRecent: number = 50): boolean {
        const session = this.sessions.get(sessionId);
        if (!session || session.messages.length <= keepRecent) return false;

        const oldMessages = session.messages.slice(0, -keepRecent);
        const recentMessages = session.messages.slice(-keepRecent);

        // Create a compact summary of old messages
        const summary = this.createCompactionSummary(oldMessages);

        // Replace messages with summary + recent
        session.messages = [
            {
                id: uuidv4(),
                role: 'system',
                content: `[Session Compacted] Summary of ${oldMessages.length} previous messages:\n${summary}`,
                timestamp: Date.now(),
                metadata: { compactedCount: oldMessages.length },
            } as SessionMessage,
            ...recentMessages,
        ];

        session.status = 'compacted';
        session.stats.compactions++;

        console.log(`[SessionManager] 📦 Compacted session ${sessionId}: ${oldMessages.length} messages → 1 summary + ${keepRecent} recent`);
        return true;
    }

    private createCompactionSummary(messages: SessionMessage[]): string {
        // Basic summary — in the future, use LLM for intelligent summarization
        const userMessages = messages.filter(m => m.role === 'user').length;
        const agentMessages = messages.filter(m => m.role === 'agent').length;
        const toolMessages = messages.filter(m => m.role === 'tool').length;

        // Extract key topics from user messages
        const topics = messages
            .filter(m => m.role === 'user')
            .map(m => m.content.slice(0, 100))
            .slice(-5)
            .join('; ');

        return [
            `Conversation contained ${userMessages} user messages, ${agentMessages} agent responses, ${toolMessages} tool calls.`,
            `Recent topics discussed: ${topics || 'N/A'}`,
        ].join('\n');
    }

    // ── Delete / Close ────────────────────────────────────────────────────

    closeSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        session.status = 'closed';
        return true;
    }

    deleteSession(sessionId: string): boolean {
        return this.sessions.delete(sessionId);
    }

    // ── Housekeeping ──────────────────────────────────────────────────────

    private evictOldestIdleSession(): void {
        let oldestIdle: Session | null = null;
        for (const session of this.sessions.values()) {
            if (session.status === 'closed') {
                this.sessions.delete(session.id);
                return;
            }
            if (!oldestIdle || session.lastActiveAt < oldestIdle.lastActiveAt) {
                oldestIdle = session;
            }
        }
        if (oldestIdle) {
            console.log(`[SessionManager] 🗑️ Evicted oldest session ${oldestIdle.id}`);
            this.sessions.delete(oldestIdle.id);
        }
    }

    /**
     * Mark sessions as idle if they haven't been active.
     * Call periodically (e.g., every 5 minutes).
     */
    sweepIdleSessions(): number {
        const now = Date.now();
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.status === 'active' && (now - session.lastActiveAt) > this.IDLE_TIMEOUT_MS) {
                session.status = 'idle';
                count++;
            }
        }
        if (count > 0) {
            console.log(`[SessionManager] 💤 Marked ${count} sessions as idle`);
        }
        return count;
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    getStats(): {
        total: number;
        active: number;
        idle: number;
        compacted: number;
        closed: number;
        totalMessages: number;
    } {
        const sessions = Array.from(this.sessions.values());
        return {
            total: sessions.length,
            active: sessions.filter(s => s.status === 'active').length,
            idle: sessions.filter(s => s.status === 'idle').length,
            compacted: sessions.filter(s => s.status === 'compacted').length,
            closed: sessions.filter(s => s.status === 'closed').length,
            totalMessages: sessions.reduce((sum, s) => sum + s.stats.totalMessages, 0),
        };
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const sessionManager = new SessionManager();
