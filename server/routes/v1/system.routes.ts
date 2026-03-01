
import { Router } from 'express';
import { systemController } from '../../controllers/systemController';

const router = Router();

// Route: /v1/system/config
router.get('/config', (req, res) => systemController.getConfig(req, res));
router.post('/config', (req, res) => systemController.updateConfig(req, res));

// Route: /v1/system/secrets — Server-side credential vault
router.get('/secrets', (req, res) => systemController.listSecrets(req, res));
router.get('/secrets/:serviceId', (req, res) => systemController.getSecret(req, res));
router.post('/secrets/:serviceId', (req, res) => systemController.saveSecret(req, res));

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

// Route: /v1/system/skills - List dynamic markdown agent skills
router.get('/skills', async (req, res) => {
    try {
        const { skillRegistry } = await import('../../../services/skills/skillRegistry');

        // On demand load incase skills changed on disk during runtime
        skillRegistry.loadAll();

        res.json({
            status: 'ok',
            skills: skillRegistry.list(),
            stats: skillRegistry.getStats(),
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Route: /v1/system/full-state (UNIFIED - combines telemetry, agents, introspection)
router.get('/full-state', (req, res) => systemController.getFullState(req, res));

// [NEURO-UPDATE] Introspection Routes (Mapped under /system or moved to own router?)
// For now, let's keep it here but the Frontend expects /v1/introspection/state which might be its own router
// If we want to support /v1/introspection/* we need a new route file. 
// OR we can map it here and update App? No, stick to API.

// Route: /v1/system/resources - Resource metrics for Canvas VRAM optimization
router.get('/resources', (req, res) => systemController.getResources(req, res));

// Route: /v1/system/diagnostics - Hardware evaluation for setup wizard
router.get('/diagnostics', (req, res) => systemController.getDiagnostics(req, res));

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

// Route: /v1/system/health - Unified health check for all subsystems
router.get('/health', async (req, res) => {
    const health: Record<string, { status: string; details?: string }> = {};

    // SQLite
    try {
        const { sqliteService } = await import('../../../services/sqliteService');
        sqliteService.getLogs(1); // Quick read test
        health.sqlite = { status: 'ok' };
    } catch (e: any) {
        health.sqlite = { status: 'error', details: e.message };
    }

    // Redis
    try {
        const { redisClient } = await import('../../../services/redisClient');
        if (redisClient.isMockMode()) {
            health.redis = { status: 'mock', details: 'Running in-memory fallback (data not persistent)' };
        } else {
            await redisClient.set('__health_check__', 'ok', 5);
            health.redis = { status: 'ok' };
        }
    } catch (e: any) {
        health.redis = { status: 'error', details: e.message };
    }

    // Neo4j
    try {
        const { graph } = await import('../../../services/graphService');
        const connected = (typeof graph.isConnected === 'function') ? await graph.isConnected() : false;
        health.neo4j = { status: connected ? 'ok' : 'disconnected' };
    } catch (e: any) {
        health.neo4j = { status: 'error', details: e.message };
    }

    // LanceDB
    try {
        const { lancedbService } = await import('../../../services/lancedbService');
        await lancedbService.ensureInitialized();
        health.lancedb = { status: 'ok' };
    } catch (e: any) {
        health.lancedb = { status: 'error', details: e.message };
    }

    // Qdrant
    try {
        const { vectorMemory } = await import('../../../services/vectorMemoryService');
        health.qdrant = { status: vectorMemory.isReady() ? 'ok' : 'disconnected' };
    } catch (e: any) {
        health.qdrant = { status: 'error', details: e.message };
    }

    const allOk = Object.values(health).every(h => h.status === 'ok' || h.status === 'mock');
    res.json({
        status: allOk ? 'healthy' : 'degraded',
        subsystems: health,
        timestamp: new Date().toISOString()
    });
});

// Route: /v1/system/webhooks/:source - External Event Injection
router.post('/webhooks/:source', async (req, res) => {
    try {
        const { source } = req.params;
        const payload = req.body;

        // 1. Emit to SystemBus
        const { systemBus } = await import('../../../services/systemBus');
        const { SystemProtocol } = await import('../../../types');

        systemBus.emit(SystemProtocol.WEBHOOK_RECEIVED, { source, data: payload }, 'WEBHOOK_GATEWAY');

        res.json({
            status: 'received',
            source,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
