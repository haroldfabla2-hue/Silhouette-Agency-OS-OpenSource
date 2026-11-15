import { serverOwner } from '../services/lifecycle/preparationBindings';
import { recordRuntimeStartupFailure } from './runtimeRootHost';
import { bootTimersAreSealed, expectedBootShutdownAdmission } from './lifecycle/bootTimers';
import { loadRuntimeEnvironment } from './config/runtimeCredentials';
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load environment variables FIRST, before any imports
// Services like geminiService read process.env at import time
// ═══════════════════════════════════════════════════════════════
import path from 'path';
import fs from 'fs';
loadRuntimeEnvironment();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { isAllowedRequestOrigin } from './security/corsPolicy';

// Security Middleware
import { authMiddleware } from './middleware/authMiddleware';
import { promptSanitizerMiddleware } from './middleware/promptSanitizer';
import { globalLimiter, chatLimiter, adminLimiter } from './middleware/rateLimiter';

// Routes
import systemRoutes from './routes/v1/system.routes';
import selfExecRoutes from './routes/v1/exec.routes';
import { connectionRoutes } from './routes/connections';
import orchestratorRoutes from './routes/v1/orchestrator.routes';
import factoryRoutes from './routes/v1/factory.routes';
import workspaceRoutes from './routes/v1/workspace.routes';
import legacyRoutes from './routes/v1/legacy.routes';
import workflowRoutes from './routes/v1/workflow.routes';
import selfCodeRoutes from './routes/v1/selfcode.routes';
import selfDevRoutes from './routes/v1/selfdev.routes';
import introspectionRoutes from './routes/v1/introspection.routes'; // [NEURO-UPDATE]
import mediaRoutes from './routes/v1/media.routes'; // [PA-047] Media Cortex API
import graphRoutes from './routes/v1/graph.routes';
import trainingRoutes from './routes/v1/training.routes';
import { telemetryRouter } from './routes/telemetry'; // [TELEMETRY] Brain Observability
import chatRoutes from './routes/v1/chat.routes'; // [NEW] Chat API
import videoRoutes from './routes/v1/video.routes'; // [FASE1] Video Studio briefs
import memoryRoutes from './routes/v1/memory.routes'; // [NEW] Memory System
import inboxRoutes from './routes/v1/inbox.routes'; // [DASHBOARD] Mission Control
import voiceRoutes from './routes/v1/voice.routes'; // [VOICE] Voice Library & Cloning
import contextRoutes from './routes/v1/context.routes'; // [PA-041] Context Priority
import selfEvolutionRoutes from './routes/v1/self-evolution.routes'; // [CI/CD] Self-Modification Review
import driveRoutes from './routes/v1/drive.routes'; // [DRIVE] Google Drive Integration
import identityRoutes from './routes/v1/identity.routes'; // [IDENTITY] User Auth & Device Recognition
import identityEvolutionRoutes from './routes/v1/identityEvolution.routes'; // [IDENTITY EVOLUTION] Auditable personality history
import gmailRoutes from './routes/v1/gmail.routes'; // [GMAIL] Email Integration
import autonomyRoutes from './routes/v1/autonomy.routes'; // [AUTONOMY] Scheduler, Goals, Confirmations
import productionRoutes from './routes/v1/production.routes'; // [PRODUCTION] Long-form Video Production
import squadsRoutes from './routes/v1/squads.routes'; // [SQUADS] Manual Squad Control
import apikeysRoutes from './routes/v1/apikeys.routes'; // [SECURITY] API Key Management
import doctorRouter from './routes/doctorRoute'; // [DOCTOR] System Diagnostics
import assetsRoutes from './routes/v1/assets.routes'; // [ASSETS] General file upload
import googleAuthRoutes from './routes/v1/google-auth.routes'; // [GOOGLE] OAuth2 Initiation
import { analyticsRouter } from './routes/v1/analytics.routes'; // [ANALYTICS] Privacy-First Telemetry
import brainRoutes from './routes/v1/brain.routes'; // [BRAIN] External silhouette-brain 4-Tier memory
import federatedRoutes from './routes/v1/federated.routes'; // [FEDERATED] P2P memory sync


// Loaders
import { initServer } from './loaders';

export const app = express();

// Behind nginx: trust the first hop so req.protocol/req.ip reflect the real client
// (OAuth redirect_uri must be https://os.albertofarah.com, not http://).
app.set('trust proxy', 1);

// ─── SECURITY MIDDLEWARE ─────────────────────────────────────────────────────

// CORS: Restrict to configured origins (default: localhost dev server)
const allowedOrigins = (process.env.SILHOUETTE_CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

app.use(cors<Request>((req, callback) => callback(null, {
    origin: (origin, done) => {
        if (isAllowedRequestOrigin(origin, req.protocol, req.get('host'), allowedOrigins)) {
            return done(null, true);
        }
        done(new Error(`CORS: Origin ${origin} not allowed`));
    },
    credentials: true,
})));

// Body parser with reasonable limit
app.use(express.json({ limit: '10mb' }));

// Global rate limiter
app.use(globalLimiter);

// ─── HEALTH CHECK (Pre-auth — must be accessible without token) ──────────────
import { healthRouter } from './routes/health';
app.use('/health', healthRouter);

// ─── OAUTH CALLBACK (Pre-auth — external providers redirect here) ────────────
import oauthRoutes from './routes/oauth.routes';
app.use('/oauth', oauthRoutes);

// Authentication: Bearer token validation
app.use(authMiddleware);

// ─── STATIC FILES ────────────────────────────────────────────────────────────
// Serving uploads for media access
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
// Runtime-generated media (TTS, lipsync): real files, not the SPA catch-all.
app.use('/output', express.static(path.join(process.cwd(), 'public/output')));
// Visual Cortex compositions (PhotoCraft engine output; auth-protected like the rest)
app.use('/visual-output', express.static(path.join(process.cwd(), 'output')));
// PhotoCraft web editor (official WASM build, pinned in scripts/install-photocraft.sh).
// Same auth as the rest of /v1; the editor itself runs client-side in the browser.
app.use('/visual-editor', express.static(path.join(process.cwd(), 'tools/photocraft/web'), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        if (filePath.endsWith('fonts/manifest.txt')) res.setHeader('Cache-Control', 'no-cache'); // served-font edits show up on reload
    }
}));

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/v1/system', systemRoutes); // [FIX] Add /system prefix
app.use('/v1/self/exec', selfExecRoutes); // [F3] Command Execution (bubblewrap isolation, approval-gated)
app.use('/v1/connections', connectionRoutes()); // [auth-connections] operator connection lifecycle (start/list/switch/close)
app.use('/v1/system', doctorRouter); // [DOCTOR] System Diagnostics at /v1/system/doctor
app.use('/v1/orchestrator', orchestratorRoutes);
app.use('/v1/factory', factoryRoutes);
app.use('/v1/workspace', workspaceRoutes); // [AUDIT-B2] Real server workspace for the Workspace tab
app.use('/v1/workflow', workflowRoutes);
app.use('/v1/self/code', selfCodeRoutes); // [F2] Self-Code Toolkit (isolated worktree only)
app.use('/v1/self/dev', selfDevRoutes); // [W2-P0] Self-Dev Cycle (issue->change->tests->verify->approved PR)
app.use('/v1/introspection', introspectionRoutes); // [NEURO-UPDATE]
app.use('/v1/media', mediaRoutes); // [PA-047] Media Cortex API
app.use('/v1/graph', graphRoutes);
app.use('/v1/training', trainingRoutes);
app.use('/v1/telemetry', telemetryRouter); // [TELEMETRY] Brain Observability
app.use('/v1/chat', chatLimiter, promptSanitizerMiddleware, chatRoutes); // [NEW] + chat rate limit + prompt sanitizer
app.use('/v1/video', videoRoutes); // [FASE1] Video Studio briefs (auth inside router)
app.use('/v1/memory', memoryRoutes); // [NEW] Memory System
app.use('/v1/inbox', inboxRoutes); // [DASHBOARD] Mission Control
app.use('/v1/voices', voiceRoutes); // [VOICE] Voice Library & Cloning
app.use('/v1/context', contextRoutes); // [PA-041] Context Priority System
app.use('/v1/self-evolution', adminLimiter, selfEvolutionRoutes); // [CI/CD] + admin rate limit
app.use('/v1/drive', driveRoutes); // [DRIVE] Google Drive Integration
app.use('/v1/identity', identityRoutes); // [IDENTITY] User Auth & Device Recognition
app.use('/v1/identity-evolution', identityEvolutionRoutes); // [IDENTITY EVOLUTION] Auditable personality history
app.use('/v1/gmail', gmailRoutes); // [GMAIL] Email Integration
app.use('/v1/autonomy', autonomyRoutes); // [AUTONOMY] Goals, Scheduler, Confirmations
app.use('/v1/production', productionRoutes); // [PRODUCTION] Long-form Video Pipeline
app.use('/v1/squads', squadsRoutes); // [SQUADS] Manual Squad Control
app.use('/v1/admin/api-keys', adminLimiter, apikeysRoutes); // [SECURITY] Admin-only API Key Management
app.use('/v1/assets', assetsRoutes); // [ASSETS] General file upload
app.use('/v1/google-auth', googleAuthRoutes); // [GOOGLE] OAuth2 Flow
import visualRoutes from './routes/v1/visual.routes';
app.use('/v1/visual', visualRoutes); // [VISUAL CORTEX] Local composition engine (PhotoCraft)
app.use('/v1/analytics', analyticsRouter); // [ANALYTICS] Privacy-First Telemetry
app.use('/v1/brain', brainRoutes); // [BRAIN] External silhouette-brain 4-Tier memory
app.use('/v1/federated', federatedRoutes); // [FEDERATED] P2P memory sync between instances
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

// Serve production React app build static files.
// [ROOT FIX] was gated on NODE_ENV=production only; the live deployment runs
// NODE_ENV=development and the UI 404'd despite a built dist/. Now: explicit
// SERVE_UI override, else production, else serve whenever the build exists.
import { shouldServeUi } from './config/staticServing';
const distPath = path.resolve(process.cwd(), 'dist');
if (shouldServeUi(process.env, fs.existsSync(path.join(distPath, 'index.html')))) {
    app.use(express.static(distPath));
    // SPA fallback as middleware, not app.get('*'): Express 5 /
    // path-to-regexp v8 rejects the bare '*' route (this block previously
    // never executed, so the crash was latent).
    app.use((req: Request, res: Response, next: NextFunction) => {
        // Exclude API, webhook, and health paths from React SPA fallback
        if (req.method !== 'GET'
            || req.path.startsWith('/v1') || req.path.startsWith('/webhooks') || req.path.startsWith('/health')) {
            return next();
        }
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// ─── 404 HANDLER ─────────────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Endpoint not found" });
});

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('[APP] Unhandled error:', err.message);

    // CORS errors
    if (err.message.startsWith('CORS:')) {
        res.status(403).json({ error: err.message });
        return;
    }

    // Generic error
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
    });
});

// ─── INITIALIZATION ──────────────────────────────────────────────────────────
// Retain the exact original initialization graph without blocking module export.
export const appInitialization=serverOwner().invoke('original-app-initialization',()=>initServer().then(async () => {
    if(bootTimersAreSealed())return;
    // [SKILLS] Load dynamic skills from universalprompts + managed + workspace
    try {
        const { skillRegistry } = await import('../services/skills/skillRegistry');
        if(bootTimersAreSealed())return;
        skillRegistry.loadAll();
    } catch (e) {
        if(expectedBootShutdownAdmission(e))return;
        recordRuntimeStartupFailure(e);
        console.warn('[APP] Skill registry not available:', e);
    }

    // [SECURITY] Initialize tool security manager
    try {
        if(bootTimersAreSealed())return;
        const { securityManager } = await import('../services/security/securityManager');
        if(bootTimersAreSealed())return;
        const { getConfig } = await import('./config/configSchema');
        if(bootTimersAreSealed())return;
        const config = getConfig();
        securityManager.initialize({
            allowlist: new Set(config.tools.allowlist),
            denylist: new Set(config.tools.denylist),
            requireApproval: config.tools.requireApproval,
            sandboxEnabled: config.tools.sandbox.enabled,
            maxExecTimeoutMs: config.tools.sandbox.timeoutMs,
        });
    } catch (e) {
        if(expectedBootShutdownAdmission(e))return;
        recordRuntimeStartupFailure(e);
        console.warn('[APP] Security manager not available:', e);
    }

    // [CRON] Initialize enhanced cron scheduler
    try {
        if(bootTimersAreSealed())return;
        const { cronScheduler } = await import('../services/scheduler/cronScheduler');
        if(bootTimersAreSealed())return;
        cronScheduler.initialize();
    } catch (e) {
        if(expectedBootShutdownAdmission(e))return;
        recordRuntimeStartupFailure(e);
        console.warn('[APP] Cron scheduler not available:', e);
    }

    // NOTE: Channels are initialized in server/index.ts to avoid double initialization.
}));
// Observation does not replace or fulfill the original rejected promise. Root
// joins this exact task and owns its shutdown, rather than immediate exit.
void appInitialization.catch(err => {
    process.exitCode=1;recordRuntimeStartupFailure(err);
    console.error('FATAL: Original server initialization failed',err);
});
