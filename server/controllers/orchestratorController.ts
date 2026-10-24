import { sqliteService } from '../../services/sqliteService';

import { Request, Response } from 'express';
import { orchestrator } from '../../services/orchestrator';
import { qualityControl } from '../../services/qualityControlService';

export class OrchestratorController {

    public getState(req: Request, res: Response) {
        let taskLoad: unknown;
        try { taskLoad = sqliteService.getPlanTaskLoad(Date.now()); }
        catch { taskLoad = { coverage: 'task_prefix_ledger_candidates_not_proven_origin', health: 'unknown', reason: 'READ_FAILED', observedAt: Date.now() }; }
        res.json({
            taskLoad,
            activeAgents: orchestrator.getActiveCount(),
            mode: orchestrator.getMode(),
            activeCategories: orchestrator.getActiveCategories(),
            squadCounts: {
                CORE: orchestrator.getSquadCountByCategory('CORE'),
                DEV: orchestrator.getSquadCountByCategory('DEV'),
                DATA: orchestrator.getSquadCountByCategory('DATA'),
                MARKETING: orchestrator.getSquadCountByCategory('MARKETING'),
                OPS: orchestrator.getSquadCountByCategory('OPS'),
                SUPPORT: orchestrator.getSquadCountByCategory('SUPPORT'),
                HEALTH: orchestrator.getSquadCountByCategory('HEALTH'),
                FINANCE: orchestrator.getSquadCountByCategory('FINANCE'),
                RETAIL: orchestrator.getSquadCountByCategory('RETAIL'),
                EDU: orchestrator.getSquadCountByCategory('EDU'),
                MFG: orchestrator.getSquadCountByCategory('MFG'),
                ENERGY: orchestrator.getSquadCountByCategory('ENERGY'),
                CYBERSEC: orchestrator.getSquadCountByCategory('CYBERSEC'),
                LEGAL: orchestrator.getSquadCountByCategory('LEGAL'),
                SCIENCE: orchestrator.getSquadCountByCategory('SCIENCE')
            }
        });
    }

    public toggleCategory(req: Request, res: Response) {
        const { category, enabled } = req.body;
        if (!category) return res.status(400).json({ error: "Category required" });

        orchestrator.toggleCategory(category, enabled);
        // Persistence handled by jobs/persistence.ts picking up state changes
        // or we could force a save here via an event

        res.json({ success: true, activeCategories: orchestrator.getActiveCategories() });
    }

    public reassignAgent(req: Request, res: Response) {
        const { agentId, targetSquadId } = req.body;
        if (!agentId || !targetSquadId) return res.status(400).json({ error: "Agent ID and Target Squad ID required" });

        orchestrator.reassignAgent(agentId, targetSquadId);
        res.json({ success: true, message: `Reassigned ${agentId} to ${targetSquadId}` });
    }

    public getSquads(req: Request, res: Response) {
        res.json(orchestrator.getSquads());
    }

    public getAgents(req: Request, res: Response) {
        res.json(orchestrator.getAgents());
    }

    public getQualityScore(req: Request, res: Response) {
        const report = qualityControl.getSystemQualityScore();
        res.json(report);
    }

    // PA-038: Agent Evolution Endpoint
    public async evolveAgent(req: Request, res: Response) {
        const { agentId } = req.params;
        if (!agentId) {
            return res.status(400).json({ error: "Agent ID required" });
        }

        try {
            const result = await orchestrator.requestEvolution(agentId);
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PA-039: Evolution History Endpoint
    public getEvolutionHistory(req: Request, res: Response) {
        const { agentId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;

        // Dynamic import to avoid circular dependency
        import('../../services/sqliteService').then(({ sqliteService }) => {
            const history = sqliteService.getEvolutionHistory(agentId, limit);
            res.json(history);
        }).catch(err => {
            res.status(500).json({ error: err.message });
        });
    }

    // DASHBOARD: Send message to agent inbox (Mission Control)
    public async sendToInbox(req: Request, res: Response) {
        const { agentId } = req.params;
        const { message, priority = 'NORMAL' } = req.body;

        if (!agentId) {
            return res.status(400).json({ error: "Agent ID required" });
        }
        if (!message) {
            return res.status(400).json({ error: "Message body required" });
        }

        try {
            // Dynamic import to avoid circular dependency
            const { systemBus } = await import('../../services/systemBus');
            const { SystemProtocol } = await import('../../types');
            const { orchestrator } = await import('../../services/orchestrator');
            const { resolveAgentTarget } = await import('../../services/org/agentLocator');

            // [W4] Resolve the display-name/alias target to the canonical agent
            // BEFORE sending. The fire-test failure: missions addressed to
            // "Orchestrator" (canonical id: core-01) rotted in an unscanned
            // mailbox while the API answered 200 OK. Fail loudly instead.
            const target = resolveAgentTarget(agentId, orchestrator.getAgents());
            if (!target) {
                return res.status(404).json({
                    success: false,
                    error: `Agent not found: "${agentId}". No mailbox created — fix the address instead of letting the mission rot.`
                });
            }

            const interAgentMessage = {
                id: crypto.randomUUID(),
                traceId: crypto.randomUUID(),
                senderId: 'DASHBOARD_USER',
                targetId: target.id,
                type: 'BROADCAST' as const,
                protocol: SystemProtocol.TASK_ASSIGNMENT,
                payload: { message, source: 'MissionControl' },
                timestamp: Date.now(),
                priority: priority as 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
            };

            systemBus.send(interAgentMessage);

            // [W4] Missions addressed to the Orchestrator must TRIGGER WORK,
            // not just mail: route them through the same classification ->
            // planning -> dispatch pipeline a chat message gets. The mailbox
            // copy above stays for auditability. channelRouter fails soft on
            // the 'MissionControl' channel (no registered UI sink), so the
            // pipeline runs without a response surface.
            let dispatched = false;
            if (target.id === 'core-01') {
                systemBus.emit(SystemProtocol.USER_MESSAGE, {
                    sessionId: `mission-${interAgentMessage.id}`,
                    message,
                    channel: 'MissionControl',
                    senderId: 'DASHBOARD_USER',
                    senderName: 'Mission Control'
                }, 'MISSION_CONTROL');
                dispatched = true;
            }

            res.json({
                success: true,
                messageId: interAgentMessage.id,
                resolvedTarget: { id: target.id, name: target.name },
                dispatched,
                message: dispatched
                    ? `Mission dispatched to ${target.name} — orchestration pipeline triggered`
                    : `Brief dispatched to ${target.name}'s mailbox`
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export const orchestratorController = new OrchestratorController();
