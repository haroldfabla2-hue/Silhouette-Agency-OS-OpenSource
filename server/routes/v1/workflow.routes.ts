import { Router } from 'express';
import { orchestratorController } from '../../controllers/orchestratorController';
import { workflowEngine } from '../../../services/workflowEngine';
import { WorkflowStage } from '../../../types';

const router = Router();

/**
 * WORKFLOW ROUTES V2.0 - Extended Workflow Control
 * 
 * Endpoints:
 * - GET /quality - Current quality score
 * - GET /stage - Current workflow stage
 * - GET /status - Full workflow status
 * - POST /trigger - Trigger workflow manually
 * - GET /history - Workflow execution history
 * - POST /config - Update workflow configuration
 */

// GET /v1/workflow/quality - Current quality score
router.get('/quality', (req, res) => orchestratorController.getQualityScore(req, res));

// GET /v1/workflow/stage - Current workflow stage
router.get('/stage', (req, res) => {
    try {
        const stage = workflowEngine.getStage();
        const tokenUsage = workflowEngine.getTokenUsage();
        const lastThoughts = workflowEngine.getLastThoughts();
        const qualityScore = workflowEngine.getLastQualityScore();

        res.json({
            stage,
            stageLabel: WorkflowStage[stage] || stage,
            tokenUsage,
            qualityScore,
            lastThoughts: lastThoughts.slice(-5) // Last 5 thoughts
        });
    } catch (error: any) {
        console.error('[WORKFLOW] Error getting stage:', error);
        res.status(500).json({ error: 'Failed to get workflow stage' });
    }
});

// GET /v1/workflow/status - Full workflow status
router.get('/status', (req, res) => {
    try {
        const stage = workflowEngine.getStage();
        const tokenUsage = workflowEngine.getTokenUsage();
        const lastThoughts = workflowEngine.getLastThoughts();
        const qualityScore = workflowEngine.getLastQualityScore();

        res.json({
            stage,
            stageLabel: WorkflowStage[stage] || stage,
            tokenUsage,
            qualityScore,
            lastThoughts,
            timestamp: Date.now()
        });
    } catch (error: any) {
        console.error('[WORKFLOW] Error getting status:', error);
        res.status(500).json({ error: 'Failed to get workflow status' });
    }
});

// POST /v1/workflow/trigger - Trigger workflow tick manually
router.post('/trigger', async (req, res) => {
    try {
        // Trigger a tick - workflow will transition stages internally based on its logic
        await workflowEngine.tick();

        res.json({
            success: true,
            currentStage: workflowEngine.getStage(),
            message: 'Workflow tick triggered'
        });
    } catch (error: any) {
        console.error('[WORKFLOW] Error triggering workflow:', error);
        res.status(500).json({ error: 'Failed to trigger workflow', details: error.message });
    }
});

// POST /v1/workflow/cycle - Request a new workflow cycle (via tick)
router.post('/cycle', async (req, res) => {
    try {
        // Trigger tick - the workflow engine manages its own cycle internally
        await workflowEngine.tick();

        res.json({
            success: true,
            currentStage: workflowEngine.getStage(),
            message: 'Workflow cycle triggered'
        });
    } catch (error: any) {
        console.error('[WORKFLOW] Error starting cycle:', error);
        res.status(500).json({ error: 'Failed to start new cycle' });
    }
});

// GET /v1/workflow/thoughts - Get recent workflow thoughts
router.get('/thoughts', (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const thoughts = workflowEngine.getLastThoughts().slice(-limit);

        res.json({
            thoughts,
            count: thoughts.length
        });
    } catch (error: any) {
        console.error('[WORKFLOW] Error getting thoughts:', error);
        res.status(500).json({ error: 'Failed to get workflow thoughts' });
    }
});

// POST /v1/workflow/config - Update workflow configuration
router.post('/config', (req, res) => {
    try {
        const newConfig = req.body;

        if (!newConfig || Object.keys(newConfig).length === 0) {
            return res.status(400).json({ error: 'Configuration object is required' });
        }

        workflowEngine.updateConfig(newConfig);

        res.json({
            success: true,
            message: 'Workflow configuration updated'
        });
    } catch (error: any) {
        console.error('[WORKFLOW] Error updating config:', error);
        res.status(500).json({ error: 'Failed to update workflow config' });
    }
});

// GET /v1/workflow/stages - List all available stages
router.get('/stages', (req, res) => {
    try {
        const stages = Object.keys(WorkflowStage)
            .filter(key => isNaN(Number(key)))
            .map(key => ({
                key,
                value: WorkflowStage[key as keyof typeof WorkflowStage]
            }));

        res.json({ stages });
    } catch (error: any) {
        console.error('[WORKFLOW] Error listing stages:', error);
        res.status(500).json({ error: 'Failed to list stages' });
    }
});

export default router;
