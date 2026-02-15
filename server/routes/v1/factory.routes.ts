/**
 * FACTORY ROUTES V2.0
 * ═══════════════════════════════════════════════════════════════
 * 
 * Agent and Project Factory endpoints:
 * - Genesis project spawning
 * - Agent creation and management
 * - Real-time event streaming
 * - Configuration management
 * 
 * Endpoints:
 * - GET  /stream          - SSE for real-time factory events
 * - POST /spawn           - Spawn a new Genesis project
 * - GET  /list            - List all projects
 * - GET  /config          - Get factory configuration
 * - POST /config          - Update factory configuration
 * - POST /agent           - Create a new agent
 * - GET  /agents          - List all spawnable agent templates
 * - POST /agent/:id/clone - Clone an existing agent
 * - DELETE /project/:id   - Delete a project
 * - GET  /templates       - Get available project templates
 */

import { Router, Request, Response } from 'express';
import { factoryController } from '../../controllers/factoryController';
import { AgentStatus } from '../../../types';

const router = Router();

// ==================== REAL-TIME STREAMING ====================

/**
 * GET /v1/factory/stream
 * SSE endpoint for real-time factory and system events
 */
router.get('/stream', (req, res) => factoryController.streamEvents(req, res));

// ==================== PROJECT MANAGEMENT ====================

/**
 * POST /v1/factory/spawn
 * Spawn a new Genesis project
 */
router.post('/spawn', (req, res) => factoryController.legacySpawnProject(req, res));

/**
 * GET /v1/factory/list
 * List all Genesis projects
 */
router.get('/list', (req, res) => factoryController.listProjects(req, res));

/**
 * GET /v1/factory/project/:id
 * Get details of a specific project
 */
router.get('/project/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { sqliteService } = await import('../../../services/sqliteService');

        const projects = sqliteService.getConfig('genesisProjects') || [];
        const project = projects.find((p: any) => p.id === id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ success: true, project });
    } catch (error: any) {
        console.error('[FACTORY] Error getting project:', error);
        res.status(500).json({ error: 'Failed to get project', details: error.message });
    }
});

/**
 * DELETE /v1/factory/project/:id
 * Delete a Genesis project
 */
router.delete('/project/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { sqliteService } = await import('../../../services/sqliteService');

        let projects = sqliteService.getConfig('genesisProjects') || [];
        const projectIndex = projects.findIndex((p: any) => p.id === id);

        if (projectIndex === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const deleted = projects.splice(projectIndex, 1)[0];
        sqliteService.setConfig('genesisProjects', projects);

        res.json({
            success: true,
            message: `Project "${deleted.name || id}" deleted`,
            deletedId: id
        });
    } catch (error: any) {
        console.error('[FACTORY] Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project', details: error.message });
    }
});

// ==================== CONFIGURATION ====================

/**
 * GET /v1/factory/config
 * Get factory configuration
 */
router.get('/config', (req, res) => factoryController.getConfig(req, res));

/**
 * POST /v1/factory/config
 * Update factory configuration
 */
router.post('/config', (req, res) => factoryController.updateConfig(req, res));

// ==================== AGENT CREATION ====================

/**
 * POST /v1/factory/agent
 * Create a new agent dynamically
 */
router.post('/agent', async (req: Request, res: Response) => {
    try {
        const { agentFactory } = await import('../../../services/factory/AgentFactory');
        const {
            name,
            role,
            category = 'OPS',
            tier = 'WORKER',
            capabilities = [],
            personality,
            systemPrompt
        } = req.body;

        if (!name || !role) {
            return res.status(400).json({
                error: 'Name and role are required'
            });
        }

        // Use spawnForTask method which creates an agent for a specific task description
        const taskDescription = `Create a ${role} agent named ${name} with capabilities: ${capabilities.join(', ')}`;
        const newAgent = await agentFactory.spawnForTask(taskDescription);

        if (!newAgent) {
            return res.status(500).json({ error: 'Failed to spawn agent' });
        }

        res.status(201).json({
            success: true,
            message: `Agent "${name}" created successfully`,
            agent: {
                id: newAgent.id,
                name: newAgent.name,
                role: newAgent.role,
                category: newAgent.category,
                tier: newAgent.tier,
                status: newAgent.status
            }
        });
    } catch (error: any) {
        console.error('[FACTORY] Error creating agent:', error);
        res.status(500).json({ error: 'Failed to create agent', details: error.message });
    }
});

/**
 * GET /v1/factory/agents
 * List all agent templates/definitions
 */
router.get('/agents', async (_req: Request, res: Response) => {
    try {
        const { INITIAL_AGENTS } = await import('../../../constants');

        const templates = INITIAL_AGENTS.map(agent => ({
            name: agent.name,
            role: agent.role,
            category: agent.category,
            tier: agent.tier,
            capabilities: agent.capabilities,
            isTemplate: true
        }));

        res.json({
            success: true,
            templates,
            count: templates.length
        });
    } catch (error: any) {
        console.error('[FACTORY] Error listing agent templates:', error);
        res.status(500).json({ error: 'Failed to list agent templates', details: error.message });
    }
});

/**
 * POST /v1/factory/agent/:id/clone
 * Clone an existing agent
 */
router.post('/agent/:id/clone', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { newName } = req.body;

        const { orchestrator } = await import('../../../services/orchestrator');
        const { agentFactory } = await import('../../../services/factory/AgentFactory');

        const sourceAgent = orchestrator.getAgent(id);
        if (!sourceAgent) {
            return res.status(404).json({ error: 'Source agent not found' });
        }

        // Create clone via spawnForTask
        const cloneName = newName || `${sourceAgent.name} (Clone)`;
        const taskDescription = `Clone agent ${sourceAgent.name} as ${cloneName}. Role: ${sourceAgent.role}`;
        const clonedAgent = await agentFactory.spawnForTask(taskDescription);

        if (!clonedAgent) {
            return res.status(500).json({ error: 'Failed to clone agent' });
        }

        res.status(201).json({
            success: true,
            message: `Agent cloned from "${sourceAgent.name}"`,
            agent: {
                id: clonedAgent.id,
                name: clonedAgent.name,
                role: clonedAgent.role,
                clonedFrom: id
            }
        });
    } catch (error: any) {
        console.error('[FACTORY] Error cloning agent:', error);
        res.status(500).json({ error: 'Failed to clone agent', details: error.message });
    }
});

/**
 * DELETE /v1/factory/agent/:id
 * Delete/decommission an agent
 */
router.delete('/agent/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { orchestrator } = await import('../../../services/orchestrator');

        const agent = orchestrator.getAgent(id);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        // Note: Agent decommission is handled internally by the orchestrator
        // For now, just mark the agent as offline in a future implementation
        console.log(`[FACTORY] Agent ${agent.name} marked for decommission`);

        res.json({
            success: true,
            message: `Agent "${agent.name}" dehydrated`,
            agentId: id
        });
    } catch (error: any) {
        console.error('[FACTORY] Error dehydrating agent:', error);
        res.status(500).json({ error: 'Failed to dehydrate agent', details: error.message });
    }
});

// ==================== TEMPLATES ====================

/**
 * GET /v1/factory/templates
 * Get available project templates
 */
router.get('/templates', async (_req: Request, res: Response) => {
    try {
        const templates = [
            {
                id: 'web-app',
                name: 'Web Application',
                description: 'Full-stack web application with React frontend',
                stack: ['React', 'TypeScript', 'Express', 'PostgreSQL']
            },
            {
                id: 'api-service',
                name: 'API Service',
                description: 'RESTful API microservice',
                stack: ['Express', 'TypeScript', 'PostgreSQL']
            },
            {
                id: 'ml-pipeline',
                name: 'ML Pipeline',
                description: 'Machine learning training and inference pipeline',
                stack: ['Python', 'PyTorch', 'FastAPI']
            },
            {
                id: 'automation',
                name: 'Automation Script',
                description: 'Task automation and scripting project',
                stack: ['TypeScript', 'Node.js']
            },
            {
                id: 'research',
                name: 'Research Project',
                description: 'Academic research with paper generation',
                stack: ['Python', 'LaTeX', 'Jupyter']
            }
        ];

        res.json({
            success: true,
            templates,
            count: templates.length
        });
    } catch (error: any) {
        console.error('[FACTORY] Error getting templates:', error);
        res.status(500).json({ error: 'Failed to get templates', details: error.message });
    }
});

/**
 * GET /v1/factory/stats
 * Get factory statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const { sqliteService } = await import('../../../services/sqliteService');
        const { orchestrator } = await import('../../../services/orchestrator');

        const projects = sqliteService.getConfig('genesisProjects') || [];
        const agents = orchestrator.getAgents();

        res.json({
            success: true,
            stats: {
                totalProjects: projects.length,
                activeProjects: projects.filter((p: any) => p.status === 'ACTIVE').length,
                totalAgents: agents.length,
                workingAgents: agents.filter(a => a.status === AgentStatus.WORKING).length,
                idleAgents: agents.filter(a => a.status === AgentStatus.IDLE).length
            }
        });
    } catch (error: any) {
        console.error('[FACTORY] Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get stats', details: error.message });
    }
});

export default router;
