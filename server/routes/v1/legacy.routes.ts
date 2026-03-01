import { Router } from 'express';

const router = Router();

// --- NEUROLINK: Returns live service topology ---
router.get('/neurolink/nodes', async (req, res) => {
    try {
        const { orchestrator } = await import('../../../services/orchestrator');
        const agents = orchestrator.getAgents();

        // Core node always present
        const nodes: any[] = [
            {
                id: 'genesis-core',
                projectId: 'genesis-core',
                url: 'http://localhost:3000',
                status: 'CONNECTED',
                latency: 5,
                category: 'CORE'
            }
        ];

        // Add active agents as nodes
        for (const agent of agents) {
            nodes.push({
                id: agent.id,
                projectId: agent.id,
                url: `agent://${agent.id}`,
                status: agent.status !== 'OFFLINE' && agent.status !== 'HIBERNATED' ? 'CONNECTED' : 'OFFLINE',
                latency: 0,
                category: 'AGENT'
            });
        }

        res.json(nodes);
    } catch (e) {
        // Fallback to minimal response
        res.json([
            { id: 'genesis-core', projectId: 'genesis-core', url: 'http://localhost:3000', status: 'CONNECTED', latency: 5, category: 'CORE' }
        ]);
    }
});

// --- PLUGIN GENERATION: Delegates to PluginFactory ---
router.post('/plugins/generate', async (req, res) => {
    try {
        const { pluginFactory } = await import('../../../services/plugins/pluginFactory');
        const { name, id, category, description, tools } = req.body;

        if (!name || !id) {
            return res.status(400).json({ error: 'Missing required fields: name, id' });
        }

        const result = await pluginFactory.createPlugin({
            name,
            id,
            category: category || 'custom',
            description: description || `Auto-generated plugin: ${name}`,
            tools: tools || ['default_action']
        });

        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: 'Plugin generation failed', details: e.message });
    }
});

// --- WORKFLOW STUBS ---
// Moved to OrchestratorController (Real Implementation)

export default router;

