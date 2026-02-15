/**
 * INBOX ROUTES V2.0
 * ═══════════════════════════════════════════════════════════════
 * 
 * Agent inbox and inter-agent messaging system endpoints:
 * - Send messages to agents
 * - View agent inboxes
 * - Broadcast to squads
 * - Message history
 * 
 * Endpoints:
 * - POST /:agentId         - Send message to specific agent
 * - GET  /:agentId         - Get agent's inbox messages
 * - DELETE /:agentId/:msgId - Delete specific message
 * - POST /broadcast        - Broadcast to multiple agents
 * - POST /squad/:squadId   - Send message to entire squad
 * - GET  /pending          - Get all pending messages across agents
 */

import { Router, Request, Response } from 'express';
import { orchestratorController } from '../../controllers/orchestratorController';
import { SystemProtocol, AgentStatus } from '../../../types';

const router = Router();

// ==================== STATUS ENDPOINTS (must be before :agentId) ====================

/**
 * GET /v1/inbox/pending
 * Get all pending messages across all agents
 */
router.get('/pending', async (_req: Request, res: Response) => {
    try {
        // Return empty - pending message tracking is internal to systemBus
        res.json({
            success: true,
            pending: [],
            count: 0,
            note: 'Pending messages are managed internally by the systemBus'
        });
    } catch (error: any) {
        console.error('[INBOX] Error getting pending:', error);
        res.status(500).json({ error: 'Failed to get pending messages', details: error.message });
    }
});

/**
 * GET /v1/inbox/stats
 * Get inbox statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const { orchestrator } = await import('../../../services/orchestrator');

        const agents = orchestrator.getAgents();

        res.json({
            success: true,
            stats: {
                totalAgents: agents.length,
                workingAgents: agents.filter(a => a.status === AgentStatus.WORKING).length,
                idleAgents: agents.filter(a => a.status === AgentStatus.IDLE).length
            }
        });
    } catch (error: any) {
        console.error('[INBOX] Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get inbox stats', details: error.message });
    }
});

// ==================== BROADCAST ====================

/**
 * POST /v1/inbox/broadcast
 * Broadcast a message to multiple agents
 */
router.post('/broadcast', async (req: Request, res: Response) => {
    try {
        const { agentIds, message, priority = 'NORMAL' } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const { systemBus } = await import('../../../services/systemBus');
        const { orchestrator } = await import('../../../services/orchestrator');

        let targetIds: string[] = [];

        if (agentIds && Array.isArray(agentIds)) {
            targetIds = agentIds;
        } else {
            // Broadcast to all non-offline agents
            targetIds = orchestrator.getAgents()
                .filter(a => a.status !== AgentStatus.OFFLINE)
                .map(a => a.id);
        }

        const messageId = crypto.randomUUID();
        const traceId = crypto.randomUUID();

        let sentCount = 0;
        for (const targetId of targetIds) {
            try {
                const interAgentMessage = {
                    id: `${messageId}_${sentCount}`,
                    traceId,
                    senderId: 'MISSION_CONTROL',
                    targetId,
                    type: 'BROADCAST' as const,
                    protocol: SystemProtocol.TASK_ASSIGNMENT,
                    payload: { message, source: 'BroadcastAPI' },
                    timestamp: Date.now(),
                    priority: priority as 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
                };

                systemBus.send(interAgentMessage);
                sentCount++;
            } catch (e) {
                console.warn(`[INBOX] Failed to broadcast to ${targetId}`);
            }
        }

        res.json({
            success: true,
            traceId,
            sentCount,
            targetCount: targetIds.length,
            message: `Broadcast sent to ${sentCount} agents`
        });
    } catch (error: any) {
        console.error('[INBOX] Error broadcasting:', error);
        res.status(500).json({ error: 'Failed to broadcast', details: error.message });
    }
});

/**
 * POST /v1/inbox/squad/:squadId
 * Send message to all agents in a squad
 */
router.post('/squad/:squadId', async (req: Request, res: Response) => {
    try {
        const { squadId } = req.params;
        const { message, priority = 'NORMAL' } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const { orchestrator } = await import('../../../services/orchestrator');
        const { systemBus } = await import('../../../services/systemBus');

        const squads = orchestrator.getSquads();
        const squad = squads.find(s => s.id === squadId);

        if (!squad) {
            return res.status(404).json({ error: 'Squad not found' });
        }

        const traceId = crypto.randomUUID();
        let sentCount = 0;

        // Squad uses 'members' not 'agentIds'
        for (const agentId of squad.members) {
            try {
                const interAgentMessage = {
                    id: crypto.randomUUID(),
                    traceId,
                    senderId: 'SQUAD_COMMANDER',
                    targetId: agentId,
                    type: 'BROADCAST' as const,
                    protocol: SystemProtocol.TASK_ASSIGNMENT,
                    payload: { message, squadId, source: 'SquadBriefing' },
                    timestamp: Date.now(),
                    priority: priority as 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
                };

                systemBus.send(interAgentMessage);
                sentCount++;
            } catch (e) {
                console.warn(`[INBOX] Failed to send to squad member ${agentId}`);
            }
        }

        res.json({
            success: true,
            squadId,
            squadName: squad.name,
            traceId,
            sentCount,
            message: `Message sent to ${sentCount} squad members`
        });
    } catch (error: any) {
        console.error('[INBOX] Error sending to squad:', error);
        res.status(500).json({ error: 'Failed to send to squad', details: error.message });
    }
});

// ==================== AGENT MESSAGING ====================

/**
 * POST /v1/inbox/:agentId
 * Send a message to an agent's inbox (Mission Control)
 */
router.post('/:agentId', (req, res) => orchestratorController.sendToInbox(req, res));

/**
 * GET /v1/inbox/:agentId
 * Get messages from an agent's inbox
 */
router.get('/:agentId', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const { orchestrator } = await import('../../../services/orchestrator');

        // Get agent to verify it exists
        const agent = orchestrator.getAgent(agentId);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        // Messages are handled internally by systemBus, 
        // we return agent info for now
        res.json({
            success: true,
            agentId,
            agentName: agent.name,
            status: agent.status,
            messages: [],
            note: 'Messages are processed in real-time via systemBus'
        });
    } catch (error: any) {
        console.error('[INBOX] Error getting inbox:', error);
        res.status(500).json({ error: 'Failed to get inbox', details: error.message });
    }
});

/**
 * DELETE /v1/inbox/:agentId/:messageId
 * Delete a specific message from an agent's inbox
 */
router.delete('/:agentId/:messageId', async (req: Request, res: Response) => {
    try {
        const { agentId, messageId } = req.params;

        // Message deletion is not supported - messages are ephemeral
        res.json({
            success: false,
            message: 'Message deletion not supported - messages are processed in real-time',
            agentId,
            messageId
        });
    } catch (error: any) {
        console.error('[INBOX] Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message', details: error.message });
    }
});

export default router;
