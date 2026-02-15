
import { Router } from 'express';
import { systemController } from '../../controllers/systemController';

const router = Router();

// Route: /v1/system/config
router.get('/config', (req, res) => systemController.getConfig(req, res));
router.post('/config', (req, res) => systemController.updateConfig(req, res));

// Route: /v1/system/scan
router.post('/scan', (req, res) => systemController.scanSystem(req, res));

// Route: /v1/system/read
router.post('/read', (req, res) => systemController.readFile(req, res));

// Route: /v1/system/status
router.get('/status', (req, res) => systemController.getStatus(req, res));

// Route: /v1/system/costs
router.get('/costs', (req, res) => systemController.getCosts(req, res));

// Route: /v1/system/telemetry
router.get('/telemetry', (req, res) => systemController.getTelemetry(req, res));

// Route: /v1/system/full-state (UNIFIED - combines telemetry, agents, introspection)
router.get('/full-state', (req, res) => systemController.getFullState(req, res));

// [NEURO-UPDATE] Introspection Routes (Mapped under /system or moved to own router?)
// For now, let's keep it here but the Frontend expects /v1/introspection/state which might be its own router
// If we want to support /v1/introspection/* we need a new route file. 
// OR we can map it here and update App? No, stick to API.

// Route: /v1/system/resources - Resource metrics for Canvas VRAM optimization
router.get('/resources', (req, res) => systemController.getResources(req, res));

// Route: /v1/system/llm-health - LLM Gateway provider health
router.get('/llm-health', async (req, res) => {
    try {
        const { llmGateway } = await import('../../../services/llmGateway');
        const health = llmGateway.getProviderHealth();

        res.json({
            status: 'ok',
            providers: health,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Route: /v1/system/power-mode - Get/Set power mode for optimization
router.get('/power-mode', async (req, res) => {
    try {
        const { powerManager } = await import('../../../services/powerManager');
        res.json({
            currentMode: powerManager.getMode(),
            config: powerManager.getConfig(),
            availableModes: powerManager.getAvailableModes()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/power-mode', async (req, res) => {
    try {
        const { mode } = req.body;
        const { powerManager, PowerMode } = await import('../../../services/powerManager');

        if (!Object.values(PowerMode).includes(mode)) {
            return res.status(400).json({
                error: 'Invalid power mode',
                validModes: Object.values(PowerMode)
            });
        }

        powerManager.setMode(mode as any);
        res.json({
            success: true,
            newMode: powerManager.getMode(),
            config: powerManager.getConfig()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
