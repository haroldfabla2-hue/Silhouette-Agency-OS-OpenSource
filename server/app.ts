import {ownedHttpHandler,ownedHttpErrorHandler,awaitHttpMiddleware} from './runtime/ownedHttpIngress';
import {ResourceScope,type ScopeReport} from './runtime/resourceScope';
import type {Express,Request,Response,NextFunction} from 'express';

const operations=new ResourceScope('production-application-assembly');
let assemblyTask:Promise<Express>|undefined;
let assembledApplication:Express|undefined;
let phase:'NEW'|'ASSEMBLING'|'ASSEMBLED_UNQUALIFIED'|'FAILED'='NEW';
interface AssemblyChild {begin:()=>Promise<unknown>;closing?:Promise<unknown>;receipt?:unknown}
const producerChildren=new Map<string,AssemblyChild>();
let producerClosing=false;
let rateClose:(()=>Promise<unknown>)|undefined;
let rateClosing:Promise<unknown>|undefined;
let rateReceipt:unknown;
// Private live bootstrap receipt projection, never a readiness/HTTP API.
let bootstrapStatus:(()=>unknown)|undefined;
const httpConsumers=new Map<string,{close:()=>Promise<unknown>;status:()=>unknown;receipt?:unknown}>();
function adoptHttpConsumer(name:string,close:()=>Promise<unknown>,status:()=>unknown){
    if(httpConsumers.has(name))return;
    httpConsumers.set(name,{close,status});
}
function inspectConsumerReport(name:string,receipt:unknown){
    const value=receipt as {state?:string;resources?:{state?:string};failures?:unknown[]}|undefined;
    if(value?.state==='FAILED'||value?.resources?.state==='FAILED'||value?.failures?.length)operations.recordFailure('assembly-http-consumer:'+name,receipt);
}
function assertAssemblyAccepting(){operations.assertAccepting();if(producerClosing)throw new Error('Application producers are closing');}
function beginChild(name:string,child:AssemblyChild):Promise<unknown>{
    if(!child.closing){
        try{child.closing=Promise.resolve(child.begin());}catch(error){child.closing=Promise.reject(error);}
        void child.closing.then(receipt=>{
            child.receipt=receipt;
            if((receipt as ScopeReport|undefined)?.state==='FAILED')operations.recordFailure('assembly-child-report:'+name,receipt);
        },error=>operations.recordFailure('assembly-child:'+name,error));
    }
    return child.closing;
}
function adoptProducer(name:string,begin:()=>Promise<unknown>){
    if(producerChildren.has(name))return;
    const child:AssemblyChild={begin};producerChildren.set(name,child);
    if(producerClosing)void beginChild(name,child);
}
/** Root must initiate ALL consumer/producer/protocol fences, including factory
 * SSE, before awaiting any global drain. This starts known assembly producers
 * only, NOT an exhaustive consumer fence or permission to close stores. */
export function beginApplicationProducerShutdown():Promise<PromiseSettledResult<unknown>[]>{
    producerClosing=true;
    return Promise.allSettled([...producerChildren].map(([name,child])=>beginChild(name,child)));
}
async function closeAssemblyParticipants(){
    await beginApplicationProducerShutdown();
    // Actual context/fact/voice consumers may still need continuum after HTTP
    // fallback. Drain them first, then shared code RAG, then continuum snapshot, then
    // identity/entry stores. Not an exhaustive dependency graph declaration.
    const consumerRank=(name:string)=>name==='identity-store'?100:name==='continuum-memory'?80:name==='codebase-awareness'?40:0;
    for(const[name,consumer]of [...httpConsumers].sort((a,b)=>consumerRank(a[0])-consumerRank(b[0]))){
        try{consumer.receipt=await consumer.close();inspectConsumerReport(name,consumer.receipt);}
        catch(error){operations.recordFailure('assembly-http-consumer-close:'+name,error);}
    }
    if(rateClose){
        if(!rateClosing){try{rateClosing=Promise.resolve(rateClose());}catch(error){rateClosing=Promise.reject(error);}}
        try{rateReceipt=await rateClosing;if((rateReceipt as ScopeReport|undefined)?.state==='FAILED')operations.recordFailure('assembly-rate-report',rateReceipt);}
        catch(error){operations.recordFailure('assembly-rate-close',error);}
    }
    return {state:'UNVERIFIED' as const,detail:'Actual bootstrap/cron/rate returns retained, not exhaustive consumer/store/provider/native release. Root MUST drain HTTP before assembly close and fence producers separately before global drain'};
}
/** The one ACTUAL production app is assembled only on explicit invocation.
 * This is not readiness/listen/activation authority. Imports can evaluate
 * unmigrated effects; caller MUST NOT treat assembly as complete root coverage. */
export function assembleProductionApplication():Promise<Express>{
    if(!operations.accepting||producerClosing)return Promise.reject(new Error('Application assembly owner is closing'));
    if(assemblyTask)return assemblyTask;
    phase='ASSEMBLING';
    operations.own({name:'actual-production-app',stopIntake:()=>{void beginApplicationProducerShutdown();},close:closeAssemblyParticipants});
    assemblyTask=operations.run('actual-application-assembly',async()=>{

assertAssemblyAccepting();
const {loadRuntimeEnvironment}=await import('./config/runtimeCredentials');
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Load environment variables FIRST, before any imports
// Services like geminiService read process.env at import time
// ═══════════════════════════════════════════════════════════════
assertAssemblyAccepting();
const {default:path}=await import('path');
assertAssemblyAccepting();
const {default:fs}=await import('fs');
loadRuntimeEnvironment();

assertAssemblyAccepting();
const {default:express}=await import('express');
assertAssemblyAccepting();
const {default:cors}=await import('cors');
assertAssemblyAccepting();
const {isAllowedRequestOrigin}=await import('./security/corsPolicy');

// Security Middleware
assertAssemblyAccepting();
const {authMiddleware,prepareAuthentication,getAcquiredIdentityLifecycleStatus,shutdownAcquiredIdentityAfterHttpDrain}=await import('./middleware/authMiddleware');
assertAssemblyAccepting();
prepareAuthentication();
adoptHttpConsumer('identity-store',()=>shutdownAcquiredIdentityAfterHttpDrain(),()=>getAcquiredIdentityLifecycleStatus());
assertAssemblyAccepting();
const {promptSanitizerMiddleware}=await import('./middleware/promptSanitizer');
assertAssemblyAccepting();
const {globalLimiter,chatLimiter,adminLimiter,prepareRateLimiters,shutdownRateLimiters}=await import('./middleware/rateLimiter');
rateClose=()=>shutdownRateLimiters();
assertAssemblyAccepting();
await prepareRateLimiters();

// Routes
assertAssemblyAccepting();
const {default:systemRoutes}=await import('./routes/v1/system.routes');
assertAssemblyAccepting();
const {default:selfExecRoutes}=await import('./routes/v1/exec.routes');
assertAssemblyAccepting();
const {connectionRoutes}=await import('./routes/connections');
assertAssemblyAccepting();
const {default:orchestratorRoutes}=await import('./routes/v1/orchestrator.routes');
assertAssemblyAccepting();
const {default:factoryRoutes}=await import('./routes/v1/factory.routes');
assertAssemblyAccepting();
const {default:workspaceRoutes}=await import('./routes/v1/workspace.routes');
assertAssemblyAccepting();
const {default:legacyRoutes}=await import('./routes/v1/legacy.routes');
assertAssemblyAccepting();
const {default:workflowRoutes}=await import('./routes/v1/workflow.routes');
assertAssemblyAccepting();
const {default:selfCodeRoutes}=await import('./routes/v1/selfcode.routes');
assertAssemblyAccepting();
const {default:selfDevRoutes}=await import('./routes/v1/selfdev.routes');
assertAssemblyAccepting();
const {default:introspectionRoutes}=await import('./routes/v1/introspection.routes'); // [NEURO-UPDATE]
assertAssemblyAccepting();
const {default:mediaRoutes}=await import('./routes/v1/media.routes'); // [PA-047] Media Cortex API
assertAssemblyAccepting();
const {default:graphRoutes}=await import('./routes/v1/graph.routes');
assertAssemblyAccepting();
const {default:trainingRoutes}=await import('./routes/v1/training.routes');
assertAssemblyAccepting();
const {telemetryRouter}=await import('./routes/telemetry'); // [TELEMETRY] Brain Observability
assertAssemblyAccepting();
const {default:chatRoutes,getChatFactLifecycleStatus,shutdownChatFactsAfterHttpDrain,prepareChatCodebaseAwareness,shutdownChatCodebaseAfterConsumers,getChatCodebaseLifecycleStatus}=await import('./routes/v1/chat.routes');
adoptHttpConsumer('chat-fact-extractor',()=>shutdownChatFactsAfterHttpDrain(),()=>getChatFactLifecycleStatus()); // [NEW] Chat API
adoptHttpConsumer('codebase-awareness',()=>shutdownChatCodebaseAfterConsumers(),()=>getChatCodebaseLifecycleStatus());
assertAssemblyAccepting();
prepareChatCodebaseAwareness();
assertAssemblyAccepting();
const {default:videoRoutes}=await import('./routes/v1/video.routes'); // [FASE1] Video Studio briefs
assertAssemblyAccepting();
const {default:memoryRoutes,shutdownContinuumAfterConsumers,getContinuumRouteLifecycleStatus}=await import('./routes/v1/memory.routes');
adoptHttpConsumer('continuum-memory',()=>shutdownContinuumAfterConsumers(),()=>getContinuumRouteLifecycleStatus()); // [NEW] Memory System
assertAssemblyAccepting();
const {default:inboxRoutes}=await import('./routes/v1/inbox.routes'); // [DASHBOARD] Mission Control
assertAssemblyAccepting();
const {default:voiceRoutes,getVoiceLibraryRouteLifecycleStatus,shutdownVoiceLibraryAfterHttpDrain}=await import('./routes/v1/voice.routes');
adoptHttpConsumer('voice-library',()=>shutdownVoiceLibraryAfterHttpDrain(),()=>getVoiceLibraryRouteLifecycleStatus()); // [VOICE] Voice Library & Cloning
assertAssemblyAccepting();
const {default:contextRoutes,shutdownContextBudgetAfterHttpDrain,getContextBudgetLifecycleStatus,shutdownContextAssemblerAfterHttpDrain,getContextAssemblerLifecycleStatus}=await import('./routes/v1/context.routes');
adoptHttpConsumer('context-budget',()=>shutdownContextBudgetAfterHttpDrain(),()=>getContextBudgetLifecycleStatus());
adoptHttpConsumer('context-assembler',()=>shutdownContextAssemblerAfterHttpDrain(),()=>getContextAssemblerLifecycleStatus()); // [PA-041] Context Priority
assertAssemblyAccepting();
const {default:selfEvolutionRoutes}=await import('./routes/v1/self-evolution.routes'); // [CI/CD] Self-Modification Review
assertAssemblyAccepting();
const {default:driveRoutes}=await import('./routes/v1/drive.routes'); // [DRIVE] Google Drive Integration
assertAssemblyAccepting();
const {default:identityRoutes,getPendingIdentityRepositoryEffects}=await import('./routes/v1/identity.routes'); // [IDENTITY] User Auth & Device Recognition
adoptHttpConsumer('identity-repository-pending',async()=>({state:'UNVERIFIED',pending:getPendingIdentityRepositoryEffects()}),()=>({pending:getPendingIdentityRepositoryEffects(),pendingDurable:false}));
assertAssemblyAccepting();
const {default:identityEvolutionRoutes}=await import('./routes/v1/identityEvolution.routes'); // [IDENTITY EVOLUTION] Auditable personality history
assertAssemblyAccepting();
const {default:gmailRoutes}=await import('./routes/v1/gmail.routes'); // [GMAIL] Email Integration
assertAssemblyAccepting();
const {default:autonomyRoutes}=await import('./routes/v1/autonomy.routes'); // [AUTONOMY] Scheduler, Goals, Confirmations
assertAssemblyAccepting();
const {default:productionRoutes}=await import('./routes/v1/production.routes'); // [PRODUCTION] Long-form Video Production
assertAssemblyAccepting();
const {default:squadsRoutes}=await import('./routes/v1/squads.routes'); // [SQUADS] Manual Squad Control
assertAssemblyAccepting();
const {default:apikeysRoutes}=await import('./routes/v1/apikeys.routes'); // [SECURITY] API Key Management
assertAssemblyAccepting();
const {default:doctorRouter}=await import('./routes/doctorRoute'); // [DOCTOR] System Diagnostics
assertAssemblyAccepting();
const {default:assetsRoutes}=await import('./routes/v1/assets.routes'); // [ASSETS] General file upload
assertAssemblyAccepting();
const {default:googleAuthRoutes}=await import('./routes/v1/google-auth.routes'); // [GOOGLE] OAuth2 Initiation
assertAssemblyAccepting();
const {analyticsRouter}=await import('./routes/v1/analytics.routes'); // [ANALYTICS] Privacy-First Telemetry
assertAssemblyAccepting();
const {default:brainRoutes}=await import('./routes/v1/brain.routes'); // [BRAIN] External silhouette-brain 4-Tier memory
assertAssemblyAccepting();
const {default:federatedRoutes}=await import('./routes/v1/federated.routes'); // [FEDERATED] P2P memory sync


// Loaders
assertAssemblyAccepting();
const {initServer,shutdownServerBootstrap,getServerBootstrapStatus}=await import('./loaders');
bootstrapStatus=()=>getServerBootstrapStatus();
adoptProducer('server-bootstrap',()=>shutdownServerBootstrap());

const app = express();

// Behind nginx: trust the first hop so req.protocol/req.ip reflect the real client
// (OAuth redirect_uri must be https://os.albertofarah.com, not http://).
app.set('trust proxy', 1);

// ─── SECURITY MIDDLEWARE ─────────────────────────────────────────────────────

// CORS: Restrict to configured origins (default: localhost dev server)
const allowedOrigins = (process.env.SILHOUETTE_CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

app.use(ownedHttpHandler('middleware:cors',cors<Request>((req, callback) => callback(null, {
    origin: (origin, done) => {
        if (isAllowedRequestOrigin(origin, req.protocol, req.get('host'), allowedOrigins)) {
            return done(null, true);
        }
        done(new Error(`CORS: Origin ${origin} not allowed`));
    },
    credentials: true,
}))));

// Body parser with reasonable limit
const jsonBodyParser=express.json({ limit: '10mb' });
app.use(ownedHttpHandler('middleware:json',async(req,res,next)=>{
    await awaitHttpMiddleware(req,res,'json-body-parser',jsonBodyParser);
    next();
}));

// Global rate limiter
app.use(globalLimiter);

// ─── HEALTH CHECK (Pre-auth — must be accessible without token) ──────────────
assertAssemblyAccepting();
const {healthRouter}=await import('./routes/health');
app.use('/health', healthRouter);

// ─── OAUTH CALLBACK (Pre-auth — external providers redirect here) ────────────
assertAssemblyAccepting();
const {default:oauthRoutes}=await import('./routes/oauth.routes');
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
assertAssemblyAccepting();
const {default:visualRoutes}=await import('./routes/v1/visual.routes');
app.use('/v1/visual', visualRoutes); // [VISUAL CORTEX] Local composition engine (PhotoCraft)
app.use('/v1/analytics', analyticsRouter); // [ANALYTICS] Privacy-First Telemetry
app.use('/v1/brain', brainRoutes); // [BRAIN] External silhouette-brain 4-Tier memory
app.use('/v1/federated', federatedRoutes); // [FEDERATED] P2P memory sync between instances
app.use('/v1', legacyRoutes);

// --- INTEGRATION HUB WEBHOOKS ---
// Mount webhook handlers for external services
await operations.run('application-webhook-mount',async()=>{
    try {
        assertAssemblyAccepting();
        const { integrationHub } = await import('../services/integrationHub');
        adoptHttpConsumer('integration-hub',()=>integrationHub.shutdownLifecycle(),()=>integrationHub.getLifecycleStatus());
        assertAssemblyAccepting();
        await integrationHub.initialize();
        assertAssemblyAccepting();
        app.use('/webhooks', integrationHub.getRouter());
        console.log('[APP] 🔗 Integration Hub webhooks mounted at /webhooks');
    } catch (e) {
        operations.recordDiagnostic('application-webhooks',e,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.warn('[APP] Integration Hub not available');
    }
});

// Serve production React app build static files.
// [ROOT FIX] was gated on NODE_ENV=production only; the live deployment runs
// NODE_ENV=development and the UI 404'd despite a built dist/. Now: explicit
// SERVE_UI override, else production, else serve whenever the build exists.
assertAssemblyAccepting();
const {shouldServeUi}=await import('./config/staticServing');
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
app.use(ownedHttpHandler('middleware:404',(req: Request, res: Response) => {
    res.status(404).json({ error: "Endpoint not found" });
}));

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
app.use(ownedHttpErrorHandler('middleware:error4',(err: Error, req: Request, res: Response, _next: NextFunction) => {
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
}));

// ─── INITIALIZATION ──────────────────────────────────────────────────────────
// Await actual returned loader/tail work; hidden loader descendants remain unqualified.
await operations.run('actual-initServer-and-app-tail',async()=>{
    await initServer();
    // [SKILLS] Load dynamic skills from universalprompts + managed + workspace
    try {
        assertAssemblyAccepting();
        const { skillRegistry } = await import('../services/skills/skillRegistry');
        await skillRegistry.loadAll();
    } catch (e) {
        operations.recordDiagnostic('app-skills',e,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.warn('[APP] Skill registry not available:', e);
    }

    // [SECURITY] Initialize tool security manager
    try {
        assertAssemblyAccepting();
        const { securityManager } = await import('../services/security/securityManager');
        assertAssemblyAccepting();
        const { getConfig } = await import('./config/configSchema');
        const config = getConfig();
        await securityManager.initialize({
            allowlist: new Set(config.tools.allowlist),
            denylist: new Set(config.tools.denylist),
            requireApproval: config.tools.requireApproval,
            sandboxEnabled: config.tools.sandbox.enabled,
            maxExecTimeoutMs: config.tools.sandbox.timeoutMs,
        });
    } catch (e) {
        operations.recordDiagnostic('app-tool-security',e,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.warn('[APP] Security manager not available:', e);
    }

    // [CRON] Initialize enhanced cron scheduler
    try {
        assertAssemblyAccepting();
        const { cronScheduler } = await import('../services/scheduler/cronScheduler');
        adoptProducer('app-cron',()=>cronScheduler.shutdownLifecycle());
        assertAssemblyAccepting();
        await cronScheduler.initialize();
    } catch (e) {
        operations.recordDiagnostic('app-cron',e,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.warn('[APP] Cron scheduler not available:', e);
    }

    // NOTE: Channels are initialized in server/index.ts to avoid double initialization.
});

    assertAssemblyAccepting();
    if(producerClosing)throw new Error('Application producers fenced before publication');
    assembledApplication=app;phase='ASSEMBLED_UNQUALIFIED';return app;
    });
    void assemblyTask.catch(error=>{phase='FAILED';operations.recordFailure('actual-application-assembly',error);});
    return assemblyTask;
}
/** No eager app export. Old index must migrate to actual root ownership before
 * it can listen. Partial failed assembly is never returned as ready/reusable. */
export function getAssembledProductionApplication():Express{
    assertAssemblyAccepting();
    if(!assembledApplication)throw new Error('Actual production application has not completed assembly');
    return assembledApplication;
}
export function getApplicationAssemblyStatus(){return {bootstrap:bootstrapStatus?.(),httpConsumers:[...httpConsumers].map(([name,c])=>({name,receipt:c.receipt,status:c.status()})),phase,producerClosing,children:[...producerChildren].map(([name,child])=>({name,closing:!!child.closing,receipt:child.receipt})),rateClosing:!!rateClosing,rateReceipt,failures:operations.getFailures(),diagnostics:operations.getDiagnostics(),
    rootReadiness:'UNVERIFIED',moduleDescendants:'UNVERIFIED',pendingDurable:false};}
/** Root MUST fence/drain actual HTTP, SSE/protocol/request work before this
 * method can release rate stores. Use beginApplicationProducerShutdown before
 * global drain, not await this whole close while accepted consumers still run. */
export function shutdownApplicationAssembly(){return operations.close();}
