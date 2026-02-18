/**
 * SESSION MANAGER
 * 
 * Manages conversation sessions between agents.
 * Sessions can be:
 * - DIRECT: 1-to-1 conversation between two agents
 * - GROUP: Multiple agents collaborating on a topic
 * - SQUAD: Full squad working session led by a leader
 * 
 * Sessions are persisted to SQLite for crash recovery.
 * This is the DATA layer — see agentConversation.ts for the LOGIC layer.
 */

import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SessionType = 'DIRECT' | 'GROUP' | 'SQUAD';
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type HierarchyLevel = 'CORE' | 'LEADER' | 'SPECIALIST' | 'WORKER';

export type MessageType =
    | 'MESSAGE'       // Normal conversation
    | 'REQUEST'       // Asking for something specific
    | 'REPORT'        // Status/completion report
    | 'HELP'          // Formal help request
    | 'DELEGATION'    // Task assignment (superior → subordinate)
    | 'MENTION'       // Mentioning/summoning an agent
    | 'ACKNOWLEDGE'   // Simple acknowledgment
    | 'ESCALATION';   // Escalating to higher authority

export interface ConversationMessage {
    id: string;
    sessionId: string;
    senderId: string;
    senderName: string;
    content: string;
    type: MessageType;
    mentions: string[];        // @agent-id mentions
    replyTo?: string;          // Thread support (references another message id)
    timestamp: number;
    metadata?: Record<string, any>;
}

export interface AgentSession {
    id: string;
    type: SessionType;
    participants: string[];    // Agent IDs
    leader: string;            // Who initiated/leads the session
    topic: string;             // What they're discussing
    status: SessionStatus;
    persistent: boolean;       // If true, session survives agent dehydration
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    maxMessages?: number;      // Optional limit to prevent runaway conversations
}

// ═══════════════════════════════════════════════════════════════
// SESSION MANAGER
// ═══════════════════════════════════════════════════════════════

export class SessionManager {
    /** Active sessions in memory (hot cache) */
    private sessions: Map<string, AgentSession> = new Map();
    /** Message log per session (most recent N messages) */
    private messageLog: Map<string, ConversationMessage[]> = new Map();
    /** Max messages kept in memory per session */
    private readonly MAX_MESSAGES_IN_MEMORY = 200;

    // ───────────────────────────────────────────────────────────
    // SESSION CRUD
    // ───────────────────────────────────────────────────────────

    /**
     * Create a new conversation session.
     */
    public createSession(opts: {
        type: SessionType;
        participants: string[];
        leader: string;
        topic: string;
        persistent?: boolean;
        maxMessages?: number;
    }): AgentSession {
        const session: AgentSession = {
            id: `session-${uuidv4().substring(0, 8)}`,
            type: opts.type,
            participants: opts.participants,
            leader: opts.leader,
            topic: opts.topic,
            status: 'ACTIVE',
            persistent: opts.persistent || false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
            maxMessages: opts.maxMessages || 500
        };

        this.sessions.set(session.id, session);
        this.messageLog.set(session.id, []);

        console.log(`[SESSION_MGR] 📋 Created ${session.type} session: "${session.topic}" (${session.id}) with ${session.participants.length} participants`);
        return session;
    }

    /**
     * Get a session by ID.
     */
    public getSession(sessionId: string): AgentSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Get all sessions an agent participates in.
     */
    public getAgentSessions(agentId: string): AgentSession[] {
        const results: AgentSession[] = [];
        for (const session of this.sessions.values()) {
            if (session.participants.includes(agentId) && session.status === 'ACTIVE') {
                results.push(session);
            }
        }
        return results;
    }

    /**
     * Add a participant to an existing session.
     */
    public addParticipant(sessionId: string, agentId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        if (session.participants.includes(agentId)) return true; // Already in

        session.participants.push(agentId);
        session.updatedAt = Date.now();
        console.log(`[SESSION_MGR] ➕ Added ${agentId} to session ${sessionId}`);
        return true;
    }

    /**
     * Remove a participant from a session.
     */
    public removeParticipant(sessionId: string, agentId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        session.participants = session.participants.filter(id => id !== agentId);
        session.updatedAt = Date.now();

        // Auto-close if no participants left
        if (session.participants.length === 0) {
            this.closeSession(sessionId);
        }
        return true;
    }

    /**
     * Close a session.
     */
    public closeSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = 'CLOSED';
            session.updatedAt = Date.now();
            console.log(`[SESSION_MGR] 🔒 Closed session: ${sessionId} ("${session.topic}")`);
        }
    }

    /**
     * Pause a session (keeps data, stops accepting new messages).
     */
    public pauseSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = 'PAUSED';
            session.updatedAt = Date.now();
        }
    }

    /**
     * Resume a paused session.
     */
    public resumeSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session && session.status === 'PAUSED') {
            session.status = 'ACTIVE';
            session.updatedAt = Date.now();
        }
    }

    // ───────────────────────────────────────────────────────────
    // MESSAGE MANAGEMENT
    // ───────────────────────────────────────────────────────────

    /**
     * Add a message to a session.
     */
    public addMessage(message: ConversationMessage): boolean {
        const session = this.sessions.get(message.sessionId);
        if (!session) {
            console.warn(`[SESSION_MGR] Cannot add message: session ${message.sessionId} not found`);
            return false;
        }

        if (session.status !== 'ACTIVE') {
            console.warn(`[SESSION_MGR] Cannot add message: session ${message.sessionId} is ${session.status}`);
            return false;
        }

        // Check max messages
        if (session.maxMessages && session.messageCount >= session.maxMessages) {
            console.warn(`[SESSION_MGR] ⚠️ Session ${message.sessionId} reached max messages (${session.maxMessages}). Auto-closing.`);
            this.closeSession(message.sessionId);
            return false;
        }

        const log = this.messageLog.get(message.sessionId) || [];
        log.push(message);

        // Trim old messages from memory (keep on disk if persisted)
        if (log.length > this.MAX_MESSAGES_IN_MEMORY) {
            log.splice(0, log.length - this.MAX_MESSAGES_IN_MEMORY);
        }

        this.messageLog.set(message.sessionId, log);
        session.messageCount++;
        session.updatedAt = Date.now();

        return true;
    }

    /**
     * Get recent messages from a session.
     */
    public getMessages(sessionId: string, limit: number = 50): ConversationMessage[] {
        const log = this.messageLog.get(sessionId) || [];
        return log.slice(-limit);
    }

    /**
     * Get the conversation context for a session (for injecting into agent prompt).
     */
    public getSessionContext(sessionId: string, limit: number = 20): string {
        const session = this.sessions.get(sessionId);
        if (!session) return '';

        const messages = this.getMessages(sessionId, limit);
        const lines = messages.map(m =>
            `[${m.senderName}] (${m.type}): ${m.content}`
        );

        return `
=== Session: ${session.topic} ===
Type: ${session.type}
Participants: ${session.participants.join(', ')}
Leader: ${session.leader}
--- Recent Messages ---
${lines.join('\n')}
===
        `.trim();
    }

    // ───────────────────────────────────────────────────────────
    // CLEANUP
    // ───────────────────────────────────────────────────────────

    /**
     * Prune closed sessions older than the given age (in milliseconds).
     */
    public pruneClosedSessions(maxAgeMs: number = 3600000): number {
        const now = Date.now();
        let pruned = 0;

        for (const [id, session] of this.sessions.entries()) {
            if (session.status === 'CLOSED' && (now - session.updatedAt) > maxAgeMs) {
                this.sessions.delete(id);
                this.messageLog.delete(id);
                pruned++;
            }
        }

        if (pruned > 0) {
            console.log(`[SESSION_MGR] 🧹 Pruned ${pruned} closed sessions`);
        }
        return pruned;
    }

    /**
     * Get all active sessions.
     */
    public getAllActiveSessions(): AgentSession[] {
        return Array.from(this.sessions.values()).filter(s => s.status === 'ACTIVE');
    }

    /**
     * Get stats for monitoring.
     */
    public getStats(): { active: number; paused: number; closed: number; totalMessages: number } {
        let active = 0, paused = 0, closed = 0, totalMessages = 0;
        for (const session of this.sessions.values()) {
            if (session.status === 'ACTIVE') active++;
            else if (session.status === 'PAUSED') paused++;
            else closed++;
            totalMessages += session.messageCount;
        }
        return { active, paused, closed, totalMessages };
    }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const sessionManager = new SessionManager();
