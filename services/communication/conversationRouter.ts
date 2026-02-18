/**
 * CONVERSATION ROUTER
 * 
 * Routes messages between agents while enforcing hierarchy rules.
 * This is the "traffic controller" for agent-to-agent communication.
 * 
 * Hierarchy Rules:
 * - CORE (Orchestrator): Can communicate with ALL agents
 * - LEADER (Squad Lead): Can talk to team + other leaders + CORE
 * - SPECIALIST: Can talk to leader + peers + request help via leader
 * - WORKER: Can talk to leader + peers within squad
 * 
 * A WORKER cannot give orders to a LEADER.
 * Cross-squad requests from non-leaders must go through their leader.
 */

import { Agent, AgentRoleType, AgentTier, SystemProtocol } from '../../types';
import { systemBus, EnhancedInterAgentMessage, MessagePriority } from '../systemBus';
import { ConversationMessage, MessageType, HierarchyLevel, sessionManager } from './sessionManager';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RoutingResult {
    allowed: boolean;
    reason?: string;
    routedVia?: string; // If the message was rerouted (e.g., via a leader)
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION ROUTER
// ═══════════════════════════════════════════════════════════════

export class ConversationRouter {

    /**
     * Determine the hierarchy level of an agent.
     */
    public getHierarchyLevel(agent: Agent): HierarchyLevel {
        if (agent.tier === AgentTier.CORE) return 'CORE';
        if (agent.roleType === AgentRoleType.LEADER) return 'LEADER';

        // Distinguish between SPECIALIST and WORKER
        if (agent.tier === AgentTier.SPECIALIST) return 'SPECIALIST';
        return 'WORKER';
    }

    /**
     * Check if sender is allowed to send the given message type to the receiver.
     */
    public validateMessage(
        sender: Agent,
        receiver: Agent,
        messageType: MessageType,
        sessionParticipants?: string[]
    ): RoutingResult {
        const senderLevel = this.getHierarchyLevel(sender);
        const receiverLevel = this.getHierarchyLevel(receiver);

        // CORE can always communicate with anyone
        if (senderLevel === 'CORE') {
            return { allowed: true };
        }

        // Same team — always allowed for basic messages
        if (sender.teamId === receiver.teamId) {
            // But WORKER cannot DELEGATE to LEADER
            if (messageType === 'DELEGATION' && senderLevel === 'WORKER' && receiverLevel !== 'WORKER') {
                return {
                    allowed: false,
                    reason: `Workers cannot delegate tasks to ${receiverLevel}s. Escalate to your squad leader.`
                };
            }
            return { allowed: true };
        }

        // Cross-team communication rules
        switch (senderLevel) {
            case 'LEADER':
                // Leaders CAN talk to other leaders and CORE
                if (receiverLevel === 'LEADER' || receiverLevel === 'CORE') {
                    return { allowed: true };
                }
                // Leaders can also directly message workers in other teams if needed for collaboration
                if (messageType === 'REQUEST' || messageType === 'HELP') {
                    return { allowed: true };
                }
                // But can't DELEGATE to workers in other teams
                if (messageType === 'DELEGATION') {
                    return {
                        allowed: false,
                        reason: 'Cannot delegate to agents outside your squad. Request help from their squad leader instead.'
                    };
                }
                return { allowed: true };

            case 'SPECIALIST':
                // Specialists can request help from other teams' leaders
                if (receiverLevel === 'LEADER' || receiverLevel === 'CORE') {
                    if (messageType === 'HELP' || messageType === 'REQUEST' || messageType === 'MESSAGE') {
                        return { allowed: true };
                    }
                }
                // Specialists cannot directly talk to workers in other teams
                if (receiverLevel === 'WORKER' || receiverLevel === 'SPECIALIST') {
                    return {
                        allowed: false,
                        reason: 'Cross-squad communication must go through your squad leader.',
                        routedVia: sender.teamId // Suggest routing via their own leader
                    };
                }
                return { allowed: true };

            case 'WORKER':
                // Workers CANNOT communicate cross-squad at all
                if (messageType === 'ESCALATION') {
                    // Exception: escalations to CORE
                    if (receiverLevel === 'CORE') return { allowed: true };
                }
                return {
                    allowed: false,
                    reason: 'Workers cannot communicate with agents outside their squad. Contact your squad leader.',
                    routedVia: sender.teamId
                };

            default:
                return { allowed: true };
        }
    }

    /**
     * Route a message within a session, applying hierarchy rules.
     * Returns the message ID if successfully routed.
     */
    public routeMessage(
        sender: Agent,
        receiver: Agent,
        sessionId: string,
        content: string,
        messageType: MessageType = 'MESSAGE',
        mentions: string[] = [],
        replyTo?: string
    ): ConversationMessage | null {
        // 1. Validate hierarchy
        const validation = this.validateMessage(sender, receiver, messageType);
        if (!validation.allowed) {
            // Log the blocked message — no SystemProtocol event needed for internal routing
            console.warn(`[ROUTER] ❌ Message blocked: ${sender.id} → ${receiver.id}: ${validation.reason}`);
            if (validation.routedVia) {
                console.warn(`[ROUTER] 💡 Suggestion: Route through squad leader (${validation.routedVia})`);
            }

            return null;
        }

        // 2. Create the message
        const message: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            sessionId,
            senderId: sender.id,
            senderName: sender.name,
            content,
            type: messageType,
            mentions,
            replyTo,
            timestamp: Date.now()
        };

        // 3. Add to session log
        const added = sessionManager.addMessage(message);
        if (!added) {
            console.warn(`[ROUTER] ⚠️ Failed to add message to session ${sessionId}`);
            return null;
        }

        // 4. Deliver via SystemBus (async, non-blocking)
        const busMessage = systemBus.createMessage(
            sender.id,
            receiver.id,
            SystemProtocol.HELP_REQUEST, // Use existing protocol for inter-agent messages
            {
                ...message,
                sessionContext: sessionManager.getSessionContext(sessionId, 10)
            },
            { priority: MessagePriority.NORMAL }
        );
        systemBus.send(busMessage);

        return message;
    }

    /**
     * Broadcast a message to ALL participants in a session.
     * Used for group announcements, status updates, etc.
     */
    public broadcastToSession(
        sender: Agent,
        sessionId: string,
        content: string,
        messageType: MessageType = 'MESSAGE',
        agentMap: Map<string, Agent>
    ): ConversationMessage[] {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
            console.warn(`[ROUTER] Cannot broadcast: session ${sessionId} not found`);
            return [];
        }

        const deliveredMessages: ConversationMessage[] = [];

        for (const participantId of session.participants) {
            if (participantId === sender.id) continue; // Don't send to self

            const receiver = agentMap.get(participantId);
            if (!receiver) continue;

            const msg = this.routeMessage(sender, receiver, sessionId, content, messageType);
            if (msg) deliveredMessages.push(msg);
        }

        return deliveredMessages;
    }

    /**
     * Handle a @mention — summon an agent into a session.
     * The mentioned agent is added as a participant if not already present.
     */
    public handleMention(
        mentionedAgentId: string,
        sessionId: string,
        mentionedBy: Agent,
        agentMap: Map<string, Agent>
    ): boolean {
        const session = sessionManager.getSession(sessionId);
        if (!session) return false;

        // Add the mentioned agent to the session
        sessionManager.addParticipant(sessionId, mentionedAgentId);

        const mentionedAgent = agentMap.get(mentionedAgentId);
        if (!mentionedAgent) return false;

        // Send a notification to the mentioned agent
        this.routeMessage(
            mentionedBy,
            mentionedAgent,
            sessionId,
            `You have been mentioned by ${mentionedBy.name} in session "${session.topic}". Please review the conversation and contribute.`,
            'MENTION'
        );

        console.log(`[ROUTER] 📢 ${mentionedBy.name} mentioned @${mentionedAgentId} in session "${session.topic}"`);
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const conversationRouter = new ConversationRouter();
