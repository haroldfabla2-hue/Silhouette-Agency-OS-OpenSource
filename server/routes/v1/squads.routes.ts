import { Router } from 'express';
import { orchestrator } from '../../../services/orchestrator';
import { AgentStatus } from '../../../types';

const router = Router();

// GET /v1/squads - List all squads with status
router.get('/', (req, res) => {
    try {
        const squads = orchestrator.getSquads();
        const activeAgents = orchestrator.getAgents();

        const response = squads.map(squad => {
            // Calculate squad status based on members
            const memberStatuses = squad.members.map(memberId => {
                const agent = activeAgents.find(a => a.id === memberId);
                return agent ? agent.status : AgentStatus.OFFLINE;
            });

            // If any member is working, squad is working. 
            // If all are offline, squad is sleeping.
            // If some are idle/working, squad is active.
            const isWorking = memberStatuses.some(s => s === AgentStatus.WORKING);
            const isAllOffline = memberStatuses.every(s => s === AgentStatus.OFFLINE);

            let status = 'ACTIVE';
            if (isAllOffline) status = 'SLEEPING';
            if (isWorking) status = 'WORKING';

            return {
                id: squad.id,
                name: squad.name,
                leaderId: squad.leaderId,
                category: squad.category,
                memberCount: squad.members.length,
                status,
                members: squad.members.map(mId => {
                    const agent = activeAgents.find(a => a.id === mId);
                    return {
                        id: mId,
                        name: agent?.name || 'Unknown',
                        status: agent?.status || AgentStatus.OFFLINE
                    };
                })
            };
        });

        res.json({ success: true, squads: response });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /v1/squads/:id/wake - Wake up a squad
router.post('/:id/wake', async (req, res) => {
    try {
        const { id } = req.params;
        const squads = orchestrator.getSquads();
        const squad = squads.find(s => s.id === id);

        if (!squad) {
            return res.status(404).json({ success: false, error: 'Squad not found' });
        }

        await orchestrator.mobilizeSquad(squad);

        res.json({
            success: true,
            message: `Squad ${squad.name} mobilized.`,
            squad: {
                id: squad.id,
                name: squad.name,
                status: 'ACTIVE' // It will be active after mobilize
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
