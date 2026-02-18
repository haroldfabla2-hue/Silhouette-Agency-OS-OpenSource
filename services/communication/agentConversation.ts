/**
 * AGENT CONVERSATION SERVICE
 * 
 * High-level API for agent-to-agent conversations.
 * This is the main entry point for creating sessions, sending messages,
 * requesting help, delegating tasks, and mentioning agents.
 * 
 * Built ON TOP of SystemBus (not replacing it):
 * - SystemBus handles system-level events (TASK_COMPLETION, COST_ANOMALY, etc.)
 * - AgentConversation handles structured agent-to-agent dialogue
 * - Messages flow through ConversationRouter (hierarchy enforcement)
 * - Sessions are managed by SessionManager (persistence)
 */

import { Agent, AgentRoleType, AgentTier } from '../../types';
import { systemBus } from '../systemBus';
import { agentFileSystem } from '../agents/agentFileSystem';
import {
    sessionManager,
    SessionType,
    ConversationMessage,
    MessageType,
    AgentSession
} from './sessionManager';
import { conversationRouter, RoutingResult } from './conversationRouter';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ConversationResult {
    success: boolean;
    sessionId?: string;
    messageId?: string;
    error?: string;
}

// ═══════════════════════════════════════════════════════════════
// AGENT CONVERSATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class AgentConversationService {
    /** Registry of hydrated agents for lookup during routing */
    private agentRegistry: Map<string, Agent> = new Map();

    /**
     * Register an agent so the conversation system can look it up.
     * Called when an agent is hydrated into memory.
     */
    public registerAgent(agent: Agent): void {
        this.agentRegistry.set(agent.id, agent);
    }

    /**
     * Unregister an agent (called when dehydrated).
     */
    public unregisterAgent(agentId: string): void {
        this.agentRegistry.delete(agentId);
    }

    /**
     * Get a registered agent by ID.
     */
    public getAgent(agentId: string): Agent | undefined {
        return this.agentRegistry.get(agentId);
    }

    // ───────────────────────────────────────────────────────────
    // SESSION CREATION
    // ───────────────────────────────────────────────────────────

    /**
     * Start a direct conversation between two agents.
     */
    public startDirectConversation(
        initiatorId: string,
        targetId: string,
        topic: string
    ): ConversationResult {
        const initiator = this.agentRegistry.get(initiatorId);
        const target = this.agentRegistry.get(targetId);

        if (!initiator || !target) {
            return { success: false, error: 'One or both agents not found in registry' };
        }

        // Check if they can communicate
        const validation = conversationRouter.validateMessage(initiator, target, 'MESSAGE');
        if (!validation.allowed) {
            return { success: false, error: validation.reason };
        }

        const session = sessionManager.createSession({
            type: 'DIRECT',
            participants: [initiatorId, targetId],
            leader: initiatorId,
            topic
        });

        return { success: true, sessionId: session.id };
    }

    /**
     * Create a group conversation with multiple agents.
     */
    public createGroupSession(
        leaderId: string,
        participantIds: string[],
        topic: string,
        persistent: boolean = false
    ): ConversationResult {
        const leader = this.agentRegistry.get(leaderId);
        if (!leader) {
            return { success: false, error: `Leader agent ${leaderId} not found` };
        }

        const allParticipants = [leaderId, ...participantIds.filter(id => id !== leaderId)];

        const session = sessionManager.createSession({
            type: 'GROUP',
            participants: allParticipants,
            leader: leaderId,
            topic,
            persistent
        });

        // Notify all participants
        for (const pid of allParticipants) {
            if (pid === leaderId) continue;
            const participant = this.agentRegistry.get(pid);
            if (participant) {
                conversationRouter.routeMessage(
                    leader,
                    participant,
                    session.id,
                    `You have been invited to a group session: "${topic}". Leader: ${leader.name}. Participants: ${allParticipants.length}.`,
                    'MESSAGE'
                );
            }
        }

        return { success: true, sessionId: session.id };
    }

    /**
     * Create a squad work session with all squad members.
     */
    public createSquadSession(
        leaderId: string,
        memberIds: string[],
        topic: string
    ): ConversationResult {
        const session = sessionManager.createSession({
            type: 'SQUAD',
            participants: [leaderId, ...memberIds],
            leader: leaderId,
            topic,
            persistent: true // Squad sessions persist
        });

        return { success: true, sessionId: session.id };
    }

    // ───────────────────────────────────────────────────────────
    // MESSAGING
    // ───────────────────────────────────────────────────────────

    /**
     * Send a message in a session.
     */
    public sendMessage(
        senderId: string,
        sessionId: string,
        content: string,
        type: MessageType = 'MESSAGE',
        mentions: string[] = [],
        replyTo?: string
    ): ConversationResult {
        const sender = this.agentRegistry.get(senderId);
        if (!sender) {
            return { success: false, error: `Sender ${senderId} not found` };
        }

        const session = sessionManager.getSession(sessionId);
        if (!session) {
            return { success: false, error: `Session ${sessionId} not found` };
        }

        // Check sender is a participant
        if (!session.participants.includes(senderId)) {
            return { success: false, error: 'Sender is not a participant in this session' };
        }

        // Handle mentions — bring mentioned agents into the session
        for (const mentionedId of mentions) {
            conversationRouter.handleMention(mentionedId, sessionId, sender, this.agentRegistry);
        }

        // Broadcast to all participants (or send to specific target for DIRECT)
        if (session.type === 'DIRECT') {
            const targetId = session.participants.find(p => p !== senderId);
            if (!targetId) return { success: false, error: 'No target in DIRECT session' };

            const target = this.agentRegistry.get(targetId);
            if (!target) return { success: false, error: `Target ${targetId} not hydrated` };

            const msg = conversationRouter.routeMessage(sender, target, sessionId, content, type, mentions, replyTo);
            if (!msg) return { success: false, error: 'Message blocked by hierarchy rules' };
            return { success: true, sessionId, messageId: msg.id };
        }

        // GROUP/SQUAD: broadcast to all
        const delivered = conversationRouter.broadcastToSession(sender, sessionId, content, type, this.agentRegistry);
        if (delivered.length === 0) {
            return { success: false, error: 'No messages delivered' };
        }

        return { success: true, sessionId, messageId: delivered[0]?.id };
    }

    // ───────────────────────────────────────────────────────────
    // SPECIALIZED COMMUNICATION PATTERNS
    // ───────────────────────────────────────────────────────────

    /**
     * Request help from another agent (formal help request).
     */
    public requestHelp(
        fromAgentId: string,
        targetAgentId: string,
        description: string,
        sessionId?: string
    ): ConversationResult {
        // Create a new session if none provided
        if (!sessionId) {
            const result = this.startDirectConversation(
                fromAgentId,
                targetAgentId,
                `Help Request from ${fromAgentId}`
            );
            if (!result.success) return result;
            sessionId = result.sessionId!;
        }

        return this.sendMessage(
            fromAgentId,
            sessionId,
            `🆘 **HELP REQUEST**\n\n${description}\n\nPlease assist if you have the capability. If not, suggest who might be able to help.`,
            'HELP'
        );
    }

    /**
     * Delegate a task to a subordinate agent (leader → worker).
     */
    public delegateTask(
        leaderId: string,
        workerId: string,
        taskDescription: string,
        sessionId?: string
    ): ConversationResult {
        if (!sessionId) {
            const result = this.startDirectConversation(leaderId, workerId, `Delegation: ${taskDescription.substring(0, 50)}`);
            if (!result.success) return result;
            sessionId = result.sessionId!;
        }

        return this.sendMessage(
            leaderId,
            sessionId,
            `📋 **TASK DELEGATION**\n\n${taskDescription}\n\nPlease acknowledge receipt and begin work. Report progress or completion.`,
            'DELEGATION'
        );
    }

    /**
     * Submit a progress/completion report (worker → leader).
     */
    public submitReport(
        agentId: string,
        sessionId: string,
        report: string
    ): ConversationResult {
        return this.sendMessage(
            agentId,
            sessionId,
            `📊 **STATUS REPORT**\n\n${report}`,
            'REPORT'
        );
    }

    /**
     * Escalate an issue to a higher authority.
     */
    public escalate(
        agentId: string,
        targetId: string,
        issue: string,
        sessionId?: string
    ): ConversationResult {
        if (!sessionId) {
            const result = this.startDirectConversation(agentId, targetId, `Escalation: ${issue.substring(0, 50)}`);
            if (!result.success) return result;
            sessionId = result.sessionId!;
        }

        return this.sendMessage(
            agentId,
            sessionId,
            `⚠️ **ESCALATION**\n\n${issue}\n\nThis issue exceeds my current capabilities or authority. Requesting guidance.`,
            'ESCALATION'
        );
    }

    /**
     * Mention an agent (summon them into a session).
     */
    public mentionAgent(
        sessionId: string,
        mentionedById: string,
        mentionedAgentId: string
    ): ConversationResult {
        const mentionedBy = this.agentRegistry.get(mentionedById);
        if (!mentionedBy) {
            return { success: false, error: `Agent ${mentionedById} not found` };
        }

        const success = conversationRouter.handleMention(
            mentionedAgentId,
            sessionId,
            mentionedBy,
            this.agentRegistry
        );

        return { success, error: success ? undefined : 'Failed to mention agent' };
    }

    // ───────────────────────────────────────────────────────────
    // QUERIES
    // ───────────────────────────────────────────────────────────

    /**
     * Get the conversation context for a session (for injecting into agent prompts).
     */
    public getSessionContext(sessionId: string, limit?: number): string {
        return sessionManager.getSessionContext(sessionId, limit);
    }

    /**
     * Get all active sessions for an agent.
     */
    public getAgentSessions(agentId: string): AgentSession[] {
        return sessionManager.getAgentSessions(agentId);
    }

    /**
     * Get recent messages in a session.
     */
    public getSessionMessages(sessionId: string, limit?: number): ConversationMessage[] {
        return sessionManager.getMessages(sessionId, limit);
    }

    /**
     * Get system-wide stats.
     */
    public getStats() {
        return {
            registeredAgents: this.agentRegistry.size,
            sessions: sessionManager.getStats()
        };
    }

    // ───────────────────────────────────────────────────────────
    // CLEANUP
    // ───────────────────────────────────────────────────────────

    /**
     * Prune old closed sessions.
     */
    public cleanup(maxAgeMs?: number): void {
        sessionManager.pruneClosedSessions(maxAgeMs);
    }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const agentConversation = new AgentConversationService();
