/**
 * AUTONOMY ROUTES
 * 
 * API endpoints for Silhouette's autonomous features:
 * - Scheduler management
 * - Goal tracking
 * - Integration Hub
 * - Action confirmations
 */

import { Router, Request, Response } from 'express';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /scheduler/tasks - Get all scheduled tasks
 */
router.get('/scheduler/tasks', async (req: Request, res: Response) => {
    try {
        const { schedulerService } = await import('../../../services/schedulerService');
        const tasks = schedulerService.getTasks();
        res.json({ success: true, tasks });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /scheduler/upcoming - Get upcoming tasks
 */
router.get('/scheduler/upcoming', async (req: Request, res: Response) => {
    try {
        const { schedulerService } = await import('../../../services/schedulerService');
        const limit = parseInt(req.query.limit as string) || 5;
        const tasks = schedulerService.getUpcoming(limit);
        res.json({ success: true, tasks });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /scheduler/schedule - Schedule a new task
 */
router.post('/scheduler/schedule', async (req: Request, res: Response) => {
    try {
        const { schedulerService } = await import('../../../services/schedulerService');
        const { description, action } = req.body;

        if (!description || !action) {
            return res.status(400).json({
                success: false,
                error: 'Missing description or action'
            });
        }

        const taskId = schedulerService.scheduleNaturalLanguage(description, action);

        if (taskId) {
            res.json({ success: true, taskId });
        } else {
            res.status(400).json({
                success: false,
                error: 'Could not parse schedule description'
            });
        }
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * DELETE /scheduler/task/:id - Cancel a task
 */
router.delete('/scheduler/task/:id', async (req: Request, res: Response) => {
    try {
        const { schedulerService } = await import('../../../services/schedulerService');
        const deleted = schedulerService.cancelTask(req.params.id);
        res.json({ success: deleted });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// GOALS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /goals - Get active goals
 */
router.get('/goals', async (req: Request, res: Response) => {
    try {
        const { introspection } = await import('../../../services/introspectionEngine');
        const goals = introspection.getActiveGoals();
        res.json({ success: true, goals });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /goals - Add a new goal
 */
router.post('/goals', async (req: Request, res: Response) => {
    try {
        const { introspection } = await import('../../../services/introspectionEngine');
        const { description, priority, deadline } = req.body;

        if (!description) {
            return res.status(400).json({
                success: false,
                error: 'Missing description'
            });
        }

        const goalId = introspection.addGoal(description, priority, deadline);
        res.json({ success: true, goalId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * PATCH /goals/:id/progress - Update goal progress
 */
router.patch('/goals/:id/progress', async (req: Request, res: Response) => {
    try {
        const { introspection } = await import('../../../services/introspectionEngine');
        const { progress } = req.body;

        introspection.updateGoalProgress(req.params.id, progress);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /goals/derive - Trigger goal derivation
 */
router.post('/goals/derive', async (req: Request, res: Response) => {
    try {
        const { introspection } = await import('../../../services/introspectionEngine');
        await introspection.deriveGoals();
        const goals = introspection.getActiveGoals();
        res.json({ success: true, goals });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMATIONS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /confirmations - Get pending confirmations
 */
router.get('/confirmations', async (req: Request, res: Response) => {
    try {
        const { actionExecutor } = await import('../../../services/actionExecutor');
        const confirmations = actionExecutor.getPendingConfirmations();
        res.json({ success: true, confirmations });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /confirmations/:id/approve - Approve an action
 */
router.post('/confirmations/:id/approve', async (req: Request, res: Response) => {
    try {
        const { actionExecutor } = await import('../../../services/actionExecutor');
        const approved = actionExecutor.approveAction(req.params.id);
        res.json({ success: approved });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /confirmations/:id/reject - Reject an action
 */
router.post('/confirmations/:id/reject', async (req: Request, res: Response) => {
    try {
        const { actionExecutor } = await import('../../../services/actionExecutor');
        const rejected = actionExecutor.rejectAction(req.params.id);
        res.json({ success: rejected });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATIONS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /integrations - Get all integration providers
 */
router.get('/integrations', async (req: Request, res: Response) => {
    try {
        const { integrationHub } = await import('../../../services/integrationHub');
        const providers = integrationHub.getProviders();
        res.json({ success: true, providers });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /integrations/events - Get recent integration events
 */
router.get('/integrations/events', async (req: Request, res: Response) => {
    try {
        const { integrationHub } = await import('../../../services/integrationHub');
        const limit = parseInt(req.query.limit as string) || 20;
        const events = integrationHub.getRecentEvents(limit);
        res.json({ success: true, events });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /integrations/:id/toggle - Enable/disable a provider
 */
router.post('/integrations/:id/toggle', async (req: Request, res: Response) => {
    try {
        const { integrationHub } = await import('../../../services/integrationHub');
        const { enabled } = req.body;
        const result = integrationHub.toggleProvider(req.params.id, enabled);
        res.json({ success: result });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION ARCHITECT ENDPOINTS (Dynamic Integration Creation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /architect/analyze - Analyze a request for integration needs
 */
router.post('/architect/analyze', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const { request, source = 'CHAT', priority = 'MEDIUM' } = req.body;

        if (!request) {
            return res.status(400).json({ success: false, error: 'Missing request' });
        }

        const analysis = await integrationArchitect.analyzeRequest({
            userRequest: request,
            source,
            priority,
            timestamp: Date.now()
        });

        res.json({ success: true, analysis });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /architect/research - Research an integration platform
 */
router.post('/architect/research', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const { platform, capabilities = [] } = req.body;

        if (!platform) {
            return res.status(400).json({ success: false, error: 'Missing platform' });
        }

        const research = await integrationArchitect.researchIntegration(platform, capabilities);
        res.json({ success: true, research });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /architect/blueprint - Generate an integration blueprint
 */
router.post('/architect/blueprint', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const { platform, research, capabilities } = req.body;

        if (!platform || !research) {
            return res.status(400).json({ success: false, error: 'Missing platform or research' });
        }

        const blueprint = await integrationArchitect.generateBlueprint(
            platform,
            research,
            capabilities || []
        );

        res.json({ success: true, blueprint });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /architect/blueprint/:id/approve - Approve and execute an integration
 */
router.post('/architect/blueprint/:id/approve', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const success = await integrationArchitect.approveAndExecute(req.params.id);
        res.json({ success });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /architect/blueprint/:id/reject - Reject a blueprint
 */
router.post('/architect/blueprint/:id/reject', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const success = integrationArchitect.rejectBlueprint(req.params.id);
        res.json({ success });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /architect/blueprints - Get all blueprints
 */
router.get('/architect/blueprints', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const pending = integrationArchitect.getPendingBlueprints();
        const active = integrationArchitect.getActiveBlueprints();
        const stats = integrationArchitect.getStats();
        res.json({ success: true, pending, active, stats });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /architect/blueprint/:id - Get a specific blueprint
 */
router.get('/architect/blueprint/:id', async (req: Request, res: Response) => {
    try {
        const { integrationArchitect } = await import('../../../services/integrationArchitect');
        const blueprint = integrationArchitect.getBlueprint(req.params.id);
        if (blueprint) {
            res.json({ success: true, blueprint });
        } else {
            res.status(404).json({ success: false, error: 'Blueprint not found' });
        }
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
