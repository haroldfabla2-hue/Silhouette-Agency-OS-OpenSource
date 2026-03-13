
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

    // [PHASE 8] Route: /v1/system/auto-evolution - Manage Cloud Git Configuration
    router.get('/auto-evolution', async (req, res) => {
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
            const maskedToken = gitToken.length > 8 ? `ghp_...${gitToken.slice(-4)}` : '';

            res.json({
                configured: !!(gitToken && gitOwner && gitRepo),
                gitToken: maskedToken,
                gitOwner,
                gitRepo
            });

        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/auto-evolution', async (req, res) => {
        try {
            const { gitToken, gitOwner, gitRepo } = req.body;

            // Ensure values are provided
            if (!gitToken || !gitOwner || !gitRepo) {
                return res.status(400).json({ error: 'Missing GitHub configuration fields.' });
            }

            const fs = await import('fs');
            const path = await import('path');
            const envPath = path.join(process.cwd(), '.env.local');

            let envContent = '';
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }

            // Clean existing git keys if present
            envContent = envContent.replace(/^GITHUB_TOKEN=.*$/gm, '')
                .replace(/^GITHUB_REPO_OWNER=.*$/gm, '')
                .replace(/^GITHUB_REPO_NAME=.*$/gm, '');

            if (envContent && !envContent.endsWith('\n')) envContent += '\n';

            let actualTokenToSave = gitToken;

            // If the user submitted the masked placeholder string (e.g. didn't touch the password box),
            // we must NOT overwrite the real token. We need to extract the raw token from the file again.
            if (gitToken.startsWith('ghp_...')) {
                const rawContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
                const match = rawContent.match(/^GITHUB_TOKEN=(.*)$/m);
                if (match && match[1]) {
                    actualTokenToSave = match[1];
                } else {
                    return res.status(400).json({ error: 'Cannot update with masked token. Enter full token.' });
                }
            }

            envContent += `GITHUB_TOKEN=${actualTokenToSave}\n`;
            envContent += `GITHUB_REPO_OWNER=${gitOwner}\n`;
            envContent += `GITHUB_REPO_NAME=${gitRepo}\n`;

            fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');

            console.log(`[SYSTEM_ROUTER] 💾 Auto-Evolution config manually updated for ${gitOwner}/${gitRepo}`);

            // Trigger Repo Creation / Remote Link Sequence (same as Phase 7 setup)
            setImmediate(async () => {
                try {
                    const repoUrl = `https://api.github.com/repos/${gitOwner}/${gitRepo}`;
                    let repoCreated = false;

                    const checkRes = await fetch(repoUrl, {
                        headers: { 'Authorization': `Bearer ${actualTokenToSave}` }
                    });

                    if (checkRes.status === 404) {
                        console.log(`[SYSTEM_ROUTER] ☁️ Repository ${gitRepo} not found. Creating Private OS Clone...`);
                        const createRes = await fetch('https://api.github.com/user/repos', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${actualTokenToSave}`,
                                'Content-Type': 'application/json',
                                'Accept': 'application/vnd.github.v3+json'
                            },
                            body: JSON.stringify({
                                name: gitRepo,
                                private: true,
                                description: 'Silhouette Agency OS Auto-Evolution Clone'
                            })
                        });

                        if (!createRes.ok) throw new Error(`GitHub API Error: ${createRes.statusText}`);
                        repoCreated = true;
                        console.log(`[SYSTEM_ROUTER] ✅ Successfully created private GitHub repository: ${gitRepo}`);
                    } else {
                        console.log(`[SYSTEM_ROUTER] ☁️ Repository ${gitRepo} already exists. Swapping remotes.`);
                        repoCreated = true;
                    }

                    if (repoCreated) {
                        const { exec } = await import('child_process');
                        const gitOrigin = `https://${actualTokenToSave}@github.com/${gitOwner}/${gitRepo}.git`;

                        const gitScript = `
                        git init &&
                        git remote remove origin || echo "No origin to remove" &&
                        git remote add origin ${gitOrigin} &&
                        git branch -M main &&
                        git add . &&
                        git commit -m "chore(settings): user-triggered OS cloud sync" || echo "No changes to commit" &&
                        git push -u origin main --force
                    `.trim().replace(/\n/g, ' ');

                        exec(gitScript, { cwd: process.cwd() }, (error) => {
                            if (error) console.error(`[SYSTEM_ROUTER] ❌ OS Cloud Sync Error:`, error.message);
                            else console.log(`[SYSTEM_ROUTER] 🎉 SUCCESS: OS Brain synchronized with GitHub cloud settings!`);
                        });
                    }
                } catch (asyncErr) {
                    console.error('[SYSTEM_ROUTER] ❌ Fatal error during UI-Triggered Cloud Sync:', asyncErr);
                }
            });

            res.json({ success: true, message: 'Auto-Evolution configured and background sync initiated.' });

        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
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
});

export default router;
