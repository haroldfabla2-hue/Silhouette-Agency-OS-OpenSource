/**
 * PRODUCTION ROUTES
 * 
 * API endpoints for long-form video production pipeline.
 * 
 * Endpoints:
 * - POST /production/create - Start new production
 * - GET /production/:id - Get production status
 * - POST /production/:id/pause - Pause production
 * - POST /production/:id/resume - Resume production
 * - GET /production/list - List all productions
 * - GET /production/agents - Get available production agents via semantic search
 */

import { Router, Request, Response } from 'express';
import { productionOrchestrator } from '../../../services/squads/productionSquad';

const router = Router();

/**
 * POST /production/create
 * Start a new video production project
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const {
            brief,
            targetMinutes = 1,
            platform = 'youtube',
            config
        } = req.body;

        if (!brief || typeof brief !== 'string') {
            return res.status(400).json({
                error: 'Brief is required and must be a string'
            });
        }

        if (targetMinutes < 0.5 || targetMinutes > 120) {
            return res.status(400).json({
                error: 'Target duration must be between 0.5 and 120 minutes'
            });
        }

        console.log(`[PRODUCTION API] 🎬 Starting production: "${brief.substring(0, 50)}..."`);

        const project = await productionOrchestrator.startProduction(
            brief,
            targetMinutes,
            platform,
            config
        );

        res.status(201).json({
            success: true,
            projectId: project.id,
            title: project.title,
            status: project.status,
            estimatedDuration: `${targetMinutes} minutes`,
            platform,
            message: 'Production started. Use GET /production/:id for status updates.'
        });

    } catch (error: any) {
        console.error('[PRODUCTION API] ❌ Create failed:', error);
        res.status(500).json({
            error: 'Failed to start production',
            details: error.message
        });
    }
});

/**
 * GET /production/:id
 * Get production project status and details
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const project = productionOrchestrator.getProject(id);

        if (!project) {
            return res.status(404).json({
                error: 'Production not found'
            });
        }

        // Serialize Maps for JSON response
        const response = {
            id: project.id,
            title: project.title,
            brief: project.brief,
            targetDuration: project.targetDuration,
            platform: project.platform,
            status: project.status,
            phase: project.phase,
            progress: project.progress,
            currentTask: project.currentTask,
            storyboard: project.storyboard ? {
                scenes: project.storyboard.scenes.length,
                totalShots: project.storyboard.scenes.reduce((acc, s) => acc + s.shots.length, 0),
                characters: project.storyboard.characters.map(c => c.name)
            } : null,
            generatedAssets: {
                masterImages: project.generatedAssets.masterImages.size,
                clips: project.generatedAssets.clips.size,
                audio: project.generatedAssets.audio.size
            },
            outputPath: project.outputPath,
            createdAt: project.createdAt,
            completedAt: project.completedAt,
            errors: project.errors
        };

        res.json(response);

    } catch (error: any) {
        console.error('[PRODUCTION API] ❌ Get failed:', error);
        res.status(500).json({
            error: 'Failed to get production',
            details: error.message
        });
    }
});

/**
 * GET /production/list
 * List all production projects
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const projects = productionOrchestrator.listProductions();

        const response = projects.map(p => ({
            id: p.id,
            title: p.title,
            status: p.status,
            progress: p.progress,
            phase: p.phase,
            platform: p.platform,
            createdAt: p.createdAt,
            completedAt: p.completedAt
        }));

        res.json({
            count: response.length,
            productions: response
        });

    } catch (error: any) {
        console.error('[PRODUCTION API] ❌ List failed:', error);
        res.status(500).json({
            error: 'Failed to list productions',
            details: error.message
        });
    }
});

/**
 * POST /production/:id/pause
 * Pause a running production
 */
router.post('/:id/pause', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const success = productionOrchestrator.pauseProduction(id);

        if (!success) {
            return res.status(400).json({
                error: 'Cannot pause production (not found or already complete)'
            });
        }

        res.json({
            success: true,
            message: 'Production paused'
        });

    } catch (error: any) {
        console.error('[PRODUCTION API] ❌ Pause failed:', error);
        res.status(500).json({
            error: 'Failed to pause production',
            details: error.message
        });
    }
});

/**
 * GET /production/agents
 * Find best available agents for production via semantic search
 */
router.get('/agents/available', async (req: Request, res: Response) => {
    try {
        const agents = await productionOrchestrator.findProductionAgents();

        const response = agents.map(agent => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            category: agent.category,
            tier: agent.tier,
            status: agent.status,
            capabilities: agent.capabilities
        }));

        res.json({
            count: response.length,
            agents: response,
            message: 'These are the best matching agents for video production based on semantic search.'
        });

    } catch (error: any) {
        console.error('[PRODUCTION API] ❌ Agent search failed:', error);
        res.status(500).json({
            error: 'Failed to find production agents',
            details: error.message
        });
    }
});

/**
 * GET /production/:id/storyboard
 * Get the full storyboard for a production
 */
router.get('/:id/storyboard', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const project = productionOrchestrator.getProject(id);

        if (!project) {
            return res.status(404).json({ error: 'Production not found' });
        }

        if (!project.storyboard) {
            return res.status(404).json({ error: 'Storyboard not yet generated' });
        }

        res.json(project.storyboard);

    } catch (error: any) {
        console.error('[PRODUCTION API] ❌ Get storyboard failed:', error);
        res.status(500).json({
            error: 'Failed to get storyboard',
            details: error.message
        });
    }
});

export default router;
