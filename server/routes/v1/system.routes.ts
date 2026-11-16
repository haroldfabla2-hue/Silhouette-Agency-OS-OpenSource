import { ownedHttpHandler } from '../../runtime/ownedHttpIngress';

import { Router } from 'express';
import { systemController } from '../../controllers/systemController';

const router = Router();

// Route: /v1/system/config
router.get('/config', ownedHttpHandler('system:GET:/config',(req, res) => systemController.getConfig(req, res)));
router.post('/config', ownedHttpHandler('system:POST:/config',(req, res) => systemController.updateConfig(req, res)));

// Route: /v1/system/secrets — Server-side credential vault
router.get('/secrets', ownedHttpHandler('system:GET:/secrets',(req, res) => systemController.listSecrets(req, res)));
router.get('/secrets/:serviceId', ownedHttpHandler('system:GET:/secrets/:serviceId',(req, res) => systemController.getSecret(req, res)));
router.post('/secrets/:serviceId', ownedHttpHandler('system:POST:/secrets/:serviceId',(req, res) => systemController.saveSecret(req, res)));

// Route: /v1/system/scan - REAL installation scan (filesystem + DB traversal)
router.post('/scan', ownedHttpHandler('system:POST:/scan',(req, res) => systemController.scanSystem(req, res)));
router.get('/install/scan', ownedHttpHandler('system:GET:/install/scan',(req, res) => systemController.scanSystem(req, res)));
router.post('/install/handover', ownedHttpHandler('system:POST:/install/handover',(req, res) => systemController.installHandover(req, res)));

// Route: /v1/system/read
router.post('/read', ownedHttpHandler('system:POST:/read',(req, res) => systemController.readFile(req, res)));

// Route: /v1/system/environment - F1 Environment Awareness (read-only, no secrets)
router.get('/environment', ownedHttpHandler('system:GET:/environment',async (req, res) => {
    try {
        const { environmentService } = await import('../../../services/environmentService');
        res.json(await environmentService.getReport());
    } catch (error: any) {
        console.error('[SYSTEM] Error building environment report:', error);
        res.status(500).json({ error: 'Failed to build environment report' });
    }
}));

// Route: /v1/system/status
router.get('/status', ownedHttpHandler('system:GET:/status',(req, res) => systemController.getStatus(req, res)));

// Route: /v1/system/costs
router.get('/costs', ownedHttpHandler('system:GET:/costs',(req, res) => systemController.getCosts(req, res)));

// Route: /v1/system/telemetry
router.get('/telemetry', ownedHttpHandler('system:GET:/telemetry',(req, res) => systemController.getTelemetry(req, res)));

// Route: /v1/system/skills - List dynamic markdown agent skills
router.get('/skills', ownedHttpHandler('system:GET:/skills',async (req, res) => {
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
}));

// Route: /v1/system/full-state (UNIFIED - combines telemetry, agents, introspection)
// READ-ONLY snapshot: this GET never generates thought (Fase 0: observing != acting).
router.get('/full-state', ownedHttpHandler('system:GET:/full-state',(req, res) => systemController.getFullState(req, res)));

// Route: /v1/system/narrative/trigger - EXPLICIT manual consciousness cycle.
// The only HTTP entry point that may generate thought; GET endpoints stay pure.
router.post('/narrative/trigger', ownedHttpHandler('system:POST:/narrative/trigger',async (req, res) => {
    try {
        const { thoughtNarrator } = await import('../../../services/cognitive/thoughtNarrator');
        const narrative = await thoughtNarrator.generateNarrative('manual');
        res.json({
            status: 'ok',
            generated: narrative !== null,
            narrative,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', error: error.message });
    }
}));

// [NEURO-UPDATE] Introspection Routes (Mapped under /system or moved to own router?)
// For now, let's keep it here but the Frontend expects /v1/introspection/state which might be its own router
// If we want to support /v1/introspection/* we need a new route file. 
// OR we can map it here and update App? No, stick to API.

// Route: /v1/system/resources - Resource metrics for Canvas VRAM optimization
router.get('/resources', ownedHttpHandler('system:GET:/resources',(req, res) => systemController.getResources(req, res)));

// Route: /v1/system/diagnostics - Hardware evaluation for setup wizard
router.get('/diagnostics', ownedHttpHandler('system:GET:/diagnostics',(req, res) => systemController.getDiagnostics(req, res)));

// [R6] Durable incident registry: same truth the narrator and self-healing read.
// ?open=true filters to currently open incidents.
// Route: /v1/system/logs - Real server log tail (read-only, byte-capped)
router.get('/logs', ownedHttpHandler('system:GET:/logs',async (req, res) => {
    try {
        const fs = await import('fs');
        const logPath = process.env.SERVER_LOG_PATH || '/opt/deploy-logs/server.log';
        const maxLines = Math.min(parseInt((req.query.lines as string) || '200', 10) || 200, 1000);
        if (!fs.existsSync(logPath)) return res.json({ lines: [], note: `log file not found at ${logPath}` });
        const size = fs.statSync(logPath).size;
        const CHUNK = 2 * 1024 * 1024; // read at most the last 2MB, never the whole file
        const fd = fs.openSync(logPath, 'r');
        try {
            const start = Math.max(0, size - CHUNK);
            const buf = Buffer.alloc(size - start);
            fs.readSync(fd, buf, 0, buf.length, start);
            const raw = buf.toString('utf-8');
            let lines = raw.split('\n');
            if (start > 0) lines = lines.slice(1); // first line may be partial
            const tail = lines.slice(-maxLines);
            res.json({ lines: tail, logBytes: size, capped: true });
        } finally {
            fs.closeSync(fd);
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}));

router.get('/incidents', ownedHttpHandler('system:GET:/incidents',async (req, res) => {
    try {
        const { incidentRegistry } = await import('../../../services/incidentRegistry');
        const incidents = req.query.open === 'true'
            ? incidentRegistry.getOpenIncidents()
            : incidentRegistry.getRecentIncidents(50);
        res.json({ incidents, count: incidents.length });
    } catch (error: any) {
        console.error('[SYSTEM] Error fetching incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents', details: error.message });
    }
}));

// Route: /v1/system/support-ticket - Escalate unresolved issues to cloud support agent
router.post('/support-ticket', ownedHttpHandler('system:POST:/support-ticket',(req, res) => systemController.submitSupportTicket(req, res)));

// Route: /v1/system/llm-health - LLM Gateway provider health
router.get('/llm-health', ownedHttpHandler('system:GET:/llm-health',async (req, res) => {
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
}));

// Route: /v1/system/power-mode - Get/Set power mode for optimization
router.get('/power-mode', ownedHttpHandler('system:GET:/power-mode',async (req, res) => {
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
}));

router.post('/power-mode', ownedHttpHandler('system:POST:/power-mode',async (req, res) => {
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
}));

// [PHASE 8] Route: /v1/system/auto-evolution - Manage Cloud Git Configuration
router.get('/auto-evolution', ownedHttpHandler('system:GET:/auto-evolution',async (req, res) => {
    try {
        const fs = await import('fs');
        const path = await import('path');
        const envPath = path.join(process.cwd(), '.env.local');

        if (!fs.existsSync(envPath)) {
            return res.json({ configured: false });
        }

        const envContent = fs.readFileSync(envPath, 'utf8');

        let gitToken = '';
        let gitOwner = '';
        let gitRepo = '';

        envContent.split('\n').forEach(line => {
            if (line.startsWith('GITHUB_TOKEN=')) gitToken = line.split('=')[1] || '';
            if (line.startsWith('GITHUB_REPO_OWNER=')) gitOwner = line.split('=')[1] || '';
            if (line.startsWith('GITHUB_REPO_NAME=')) gitRepo = line.split('=')[1] || '';
        });

        // Never return the full raw token for security, just mask it
        // Never return any token characters: a constant mask only. The POST handler treats it as 'keep existing'.
        const maskedToken = gitToken ? '••••••••' : '';

        res.json({
            configured: !!(gitToken && gitOwner && gitRepo),
            gitToken: maskedToken,
            gitOwner,
            gitRepo
        });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}));

interface PendingSystemSyncRequest {
    id:number;gitOwner:string;gitRepo:string;principalId:string|null;
    state:'PENDING_EXACT_PLAN_AND_AUTHENTICATED_APPROVAL';
    credentialsRetained:false;configurationChanged:false;effectsStarted:false;durable:false;
}
const pendingSystemSyncRequests:PendingSystemSyncRequest[]=[];
export function getPendingSystemSyncRequests(){return pendingSystemSyncRequests.map(record=>({...record}));}

router.post('/auto-evolution',ownedHttpHandler('system:POST:/auto-evolution',async(req,res)=>{
    // A UI POST/config field is not exact authorization for repository creation,
    // origin replacement, commit, force push, or credential-bearing shell args.
    // No secret is retained, hashed, logged, returned or embedded in a command.
    const owner=req.body?.gitOwner,repo=req.body?.gitRepo;
    if(typeof owner!=='string'||typeof repo!=='string'||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)||
        !/^[A-Za-z0-9._-]{1,100}$/.test(repo)||repo==='.'||repo==='..'){
        res.status(400).json({error:'A valid repository owner and name are required for passive planning'});return;
    }
    const principalId=typeof (req as any).user?.id==='string'?(req as any).user.id:null;
    const record:PendingSystemSyncRequest={id:pendingSystemSyncRequests.length+1,gitOwner:owner,gitRepo:repo,principalId,
        state:'PENDING_EXACT_PLAN_AND_AUTHENTICATED_APPROVAL',credentialsRetained:false,configurationChanged:false,effectsStarted:false,durable:false};
    pendingSystemSyncRequests.push(record);
    res.status(202).json({status:record.state,pendingId:record.id,configurationChanged:false,effectsStarted:false,
        credentialsRetained:false,pendingDurable:false,
        reason:'Exact repository/worktree/ref/change plan, authenticated owner approval, safe credential transport and owned execution are not bound; configuration and repository were not changed'});
}));

// Route: /v1/system/health - Unified health check for all subsystems
router.get('/health', ownedHttpHandler('system:GET:/health',async (req, res) => {

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
}));

// Route: /v1/system/webhooks/:source - External Event Injection
router.post('/webhooks/:source', ownedHttpHandler('system:POST:/webhooks/:source',async (req, res) => {
    try {
        const { source } = req.params;
        const payload = req.body;

        // Automatically handle Slack url_verification challenges
        if (source === 'slack' && payload.type === 'url_verification') {
            return res.status(200).send(payload.challenge);
        }

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
}));

export default router;
