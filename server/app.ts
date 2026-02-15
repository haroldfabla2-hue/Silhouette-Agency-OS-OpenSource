// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load environment variables FIRST, before any imports
// Services like geminiService read process.env at import time
// ═══════════════════════════════════════════════════════════════
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import express from 'express';
import cors from 'cors';

// Routes
import systemRoutes from './routes/v1/system.routes';
import orchestratorRoutes from './routes/v1/orchestrator.routes';
import factoryRoutes from './routes/v1/factory.routes';
import legacyRoutes from './routes/v1/legacy.routes';
import workflowRoutes from './routes/v1/workflow.routes';
import introspectionRoutes from './routes/v1/introspection.routes'; // [NEURO-UPDATE]
import mediaRoutes from './routes/v1/media.routes'; // [PA-047] Media Cortex API
import graphRoutes from './routes/v1/graph.routes';
import trainingRoutes from './routes/v1/training.routes';
import chatRoutes from './routes/v1/chat.routes'; // [NEW] Chat API
import memoryRoutes from './routes/v1/memory.routes'; // [NEW] Memory System
import inboxRoutes from './routes/v1/inbox.routes'; // [DASHBOARD] Mission Control
import voiceRoutes from './routes/v1/voice.routes'; // [VOICE] Voice Library & Cloning
import contextRoutes, { initializeContextConfig } from './routes/v1/context.routes'; // [PA-041] Context Priority
import selfEvolutionRoutes from './routes/v1/self-evolution.routes'; // [CI/CD] Self-Modification Review
import driveRoutes from './routes/v1/drive.routes'; // [DRIVE] Google Drive Integration
import identityRoutes from './routes/v1/identity.routes'; // [IDENTITY] User Auth & Device Recognition
import gmailRoutes from './routes/v1/gmail.routes'; // [GMAIL] Email Integration
import autonomyRoutes from './routes/v1/autonomy.routes'; // [AUTONOMY] Scheduler, Goals, Confirmations
import productionRoutes from './routes/v1/production.routes'; // [PRODUCTION] Long-form Video Production
import squadsRoutes from './routes/v1/squads.routes'; // [SQUADS] Manual Squad Control
import apikeysRoutes from './routes/v1/apikeys.routes'; // [SECURITY] API Key Management
import doctorRouter from './routes/doctorRoute'; // [DOCTOR] System Diagnostics

// Loaders
import { initServer } from './loaders';

export const app = express();

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- STATIC FILES ---
// Serving uploads for media access
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// --- ROUTES ---
app.use('/v1/system', systemRoutes); // [FIX] Add /system prefix
app.use('/v1/system', doctorRouter); // [DOCTOR] System Diagnostics at /v1/system/doctor
app.use('/v1/orchestrator', orchestratorRoutes);
app.use('/v1/factory', factoryRoutes);
app.use('/v1/workflow', workflowRoutes);
app.use('/v1/introspection', introspectionRoutes); // [NEURO-UPDATE]
app.use('/v1/media', mediaRoutes); // [PA-047] Media Cortex API
app.use('/v1/graph', graphRoutes);
app.use('/v1/training', trainingRoutes);
app.use('/v1/chat', chatRoutes); // [NEW]
app.use('/v1/memory', memoryRoutes); // [NEW] Memory System
app.use('/v1/inbox', inboxRoutes); // [DASHBOARD] Mission Control
app.use('/v1/voices', voiceRoutes); // [VOICE] Voice Library & Cloning
app.use('/v1/context', contextRoutes); // [PA-041] Context Priority System
app.use('/v1/self-evolution', selfEvolutionRoutes); // [CI/CD] Self-Modification Review
app.use('/v1/drive', driveRoutes); // [DRIVE] Google Drive Integration
app.use('/v1/identity', identityRoutes); // [IDENTITY] User Auth & Device Recognition
app.use('/v1/gmail', gmailRoutes); // [GMAIL] Email Integration
app.use('/v1/autonomy', autonomyRoutes); // [AUTONOMY] Goals, Scheduler, Confirmations
app.use('/v1/production', productionRoutes); // [PRODUCTION] Long-form Video Pipeline
app.use('/v1/squads', squadsRoutes); // [SQUADS] Manual Squad Control
app.use('/v1/admin/api-keys', apikeysRoutes); // [SECURITY] Admin-only API Key Management
app.use('/v1', legacyRoutes);

// --- INTEGRATION HUB WEBHOOKS ---
// Mount webhook handlers for external services
(async () => {
    try {
        const { integrationHub } = await import('../services/integrationHub');
        app.use('/webhooks', integrationHub.getRouter());
        console.log('[APP] 🔗 Integration Hub webhooks mounted at /webhooks');
    } catch (e) {
        console.warn('[APP] Integration Hub not available');
    }
})();

// --- 404 HANDLER ---
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});

// --- INITIALIZATION ---
// Trigger system loaders (async) but don't block export
initServer().then(async () => {
    // [SKILLS] Load dynamic skills from universalprompts + managed + workspace
    try {
        const { skillRegistry } = await import('../services/skills/skillRegistry');
        skillRegistry.loadAll();
    } catch (e) {
        console.warn('[APP] Skill registry not available:', e);
    }

    // [SECURITY] Initialize tool security manager
    try {
        const { securityManager } = await import('../services/security/securityManager');
        const { getConfig } = await import('./config/configSchema');
        const config = getConfig();
        securityManager.initialize({
            allowlist: new Set(config.tools.allowlist),
            denylist: new Set(config.tools.denylist),
            requireApproval: config.tools.requireApproval,
            sandboxEnabled: config.tools.sandbox.enabled,
            maxExecTimeoutMs: config.tools.sandbox.timeoutMs,
        });
    } catch (e) {
        console.warn('[APP] Security manager not available:', e);
    }

    // [CRON] Initialize enhanced cron scheduler
    try {
        const { cronScheduler } = await import('../services/scheduler/cronScheduler');
        cronScheduler.initialize();
    } catch (e) {
        console.warn('[APP] Cron scheduler not available:', e);
    }

    // [CHANNELS] Initialize messaging channels (WhatsApp, Telegram, Discord)
    try {
        const { initializeChannels } = await import('./channels');
        await initializeChannels();
    } catch (e) {
        console.warn('[APP] Channel initialization not available:', e);
    }
}).catch(err => {
    console.error("FATAL: Failed to initialize server", err);
    process.exit(1);
});
