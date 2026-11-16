import {ResourceScope,type ScopeReport} from './runtime/resourceScope';
import {OwnedHttpIngress} from './runtime/ownedHttpIngress';
import type {Express} from 'express';

const operations=new ResourceScope('production-entry');
interface Child {begin:()=>Promise<unknown>;closing?:Promise<unknown>;receipt?:unknown;closeState?:'PENDING'|'RETURNED_UNQUALIFIED'|'REJECTED';closeError?:unknown}
const children=new Map<string,Child>();
let phase:'NEW'|'STARTING'|'LISTENING_UNQUALIFIED'|'FAILED'|'CLOSING'|'CLOSED_UNQUALIFIED'='NEW';
let startup:Promise<void>|undefined;
let shutdown:Promise<ScopeReport>|undefined;
let ingress:OwnedHttpIngress|undefined;
let stopping=false;
let beginApp:undefined|(()=>Promise<unknown>);
let closeApp:undefined|(()=>Promise<unknown>);
let appCloseReceipt:unknown;
let appStatus:undefined|(()=>unknown);
let closeDatabaseStores:undefined|(()=>Promise<unknown>);
let databaseStoreReceipt:unknown;
let closeTerminalService:undefined|(()=>Promise<unknown>);
let terminalServiceReceipt:unknown;
let postListenReturned=false;
let shutdownDeadlineElapsed=false;
let shutdownSettled=false;
let loggerAttempt=0;
let closeBus:undefined|(()=>Promise<unknown>);
let busReceipt:unknown;
// Observations of EXISTING entry calls, not a participant catalog or policy.
// Propagation/degraded fallback describes current control flow ONLY. Neither
// disposition establishes required-capability readiness or effect durability.
type ObservedDisposition='EXISTING_PROPAGATION'|'EXISTING_DEGRADED_CATCH';
interface ParticipantAttempt {name:string;attempt:number;disposition:ObservedDisposition;
    state:'STARTING'|'RETURNED_UNQUALIFIED'|'THREW'|'REJECTED';
    returnedType?:string;returnedBoolean?:boolean;error?:unknown}
const participantAttempts:ParticipantAttempt[]=[];
function beginParticipantAttempt(name:string,disposition:ObservedDisposition){
    const receipt:ParticipantAttempt={name,attempt:participantAttempts.length+1,disposition,state:'STARTING'};
    participantAttempts.push(receipt);return receipt;
}
function recordParticipantReturn(receipt:ParticipantAttempt,value:unknown){
    receipt.state='RETURNED_UNQUALIFIED';receipt.returnedType=typeof value;
    if(typeof value==='boolean')receipt.returnedBoolean=value;
    // Do not project raw config/credentials/provider objects/Express graphs.
}
function observeSyncParticipant<T>(name:string,disposition:ObservedDisposition,actual:()=>T):T{
    const receipt=beginParticipantAttempt(name,disposition);
    try{const value=actual();recordParticipantReturn(receipt,value);return value;}
    catch(error){receipt.state='THREW';receipt.error=error;throw error;}
}
async function observeAsyncParticipant<T>(name:string,disposition:ObservedDisposition,actual:()=>T|Promise<T>):Promise<T>{
    const receipt=beginParticipantAttempt(name,disposition);
    let returned:T|Promise<T>;
    try{returned=actual();}catch(error){receipt.state='THREW';receipt.error=error;throw error;}
    try{const value=await returned;recordParticipantReturn(receipt,value);return value;}
    catch(error){receipt.state='REJECTED';receipt.error=error;throw error;}
}
export function getProductionParticipantOutcomeStatus(){return {
    attempts:participantAttempts.map(receipt=>({...receipt})),
    cleanup:[...children].map(([name,child])=>({name,
        state:child.closeState||'NOT_REQUESTED',
        receipt:child.receipt,error:child.closeError})),
    requiredCapabilityPolicy:'MISSING' as const,
    qualification:'UNVERIFIED' as const,coverage:'EXISTING_OBSERVED_ENTRY_CALLS_ONLY' as const,
    workOutcome:'UNVERIFIED' as const,durability:'UNVERIFIED' as const,release:'UNVERIFIED' as const,
    pendingDurable:false,restartEligible:false
};}
function assertStarting(){operations.assertAccepting();if(stopping)throw new Error('Production entry fenced');}
function beginChild(name:string,child:Child){
    if(!child.closing){
        child.closeState='PENDING';
        try{child.closing=Promise.resolve(child.begin());}catch(error){child.closing=Promise.reject(error);}
        void child.closing.then(receipt=>{
            child.receipt=receipt;child.closeState='RETURNED_UNQUALIFIED';
            const r=receipt as ScopeReport|{resources?:ScopeReport}|undefined;
            const report=r&&'resources'in r?r.resources:r as ScopeReport|undefined;
            if(report?.state==='FAILED')operations.recordFailure('entry-child-report:'+name,receipt);
        },error=>{child.closeState='REJECTED';child.closeError=error;operations.recordFailure('entry-child:'+name,error);});
    }
    return child.closing;
}
function adopt(name:string,begin:()=>Promise<unknown>){
    if(children.has(name))return;
    const child:Child={begin};children.set(name,child);
    if(stopping)void beginChild(name,child);
}
function startFences(){
    stopping=true;phase='CLOSING';
    // Initiate HTTP/protocol/SSE/producer fences before awaiting ANY drain.
    if(ingress)void ingress.beginShutdown().catch(error=>operations.recordFailure('entry-http-close',error));
    if(beginApp)void beginApp().catch(error=>operations.recordFailure('entry-app-producer-fence',error));
    for(const [name,child]of children)void beginChild(name,child);
}
export function getProductionEntryStatus(){return {phase,stopping,postListenReturned,shutdownSettled,shutdownDeadlineElapsed,http:ingress?.getStatus(),
    participants:getProductionParticipantOutcomeStatus(),application:appStatus?.(),databaseStoreReceipt,terminalServiceReceipt,busReceipt,children:[...children].map(([name,c])=>({name,closing:!!c.closing,receipt:c.receipt})),appCloseReceipt,
    readiness:'UNVERIFIED',release:'UNVERIFIED',restartEligible:false,pendingDurable:false,
    failures:operations.getFailures(),diagnostics:operations.getDiagnostics()};}
/** ACTUAL entry now explicit/passive. No eager config/app import/listen/process
 * handlers. Listening is NOT required readiness or permission to run this source. */
export function startProductionServer():Promise<void>{
    if(stopping||!operations.accepting)return Promise.reject(new Error('Production entry closing'));
    if(startup)return startup;
    phase='STARTING';
    operations.own({name:'entry-participant-drain',stopIntake:startFences,close:async()=>{
        // Child protocol/SSE/producer close already initiated in stop pass.
        // Await real HTTP requests/socket/upgrade receipts BEFORE closing rate
        // stores through actual assembly close, not reverse-acquisition guess.
        if(ingress)await ingress.beginShutdown();
        await Promise.allSettled([...children].map(([name,c])=>beginChild(name,c)));
        if(closeTerminalService){try{terminalServiceReceipt=await closeTerminalService();if((terminalServiceReceipt as ScopeReport|undefined)?.state==='FAILED')operations.recordFailure('entry-terminal-service-report',terminalServiceReceipt);}catch(error){operations.recordFailure('entry-terminal-service',error);}}
        if(closeApp){try{appCloseReceipt=await closeApp();if((appCloseReceipt as ScopeReport|undefined)?.state==='FAILED')operations.recordFailure('entry-app-report',appCloseReceipt);}catch(error){operations.recordFailure('entry-app-close',error);}}
        if(closeDatabaseStores){databaseStoreReceipt=await closeDatabaseStores();for(const failure of (databaseStoreReceipt as {failures?:unknown[]}).failures||[])operations.recordFailure('entry-database-store-report',failure);}
        if(closeBus){try{busReceipt=await closeBus();const receipt=busReceipt as {workFailures?:unknown[];cleanupFailures?:unknown[]};for(const error of [...receipt.workFailures||[],...receipt.cleanupFailures||[]])operations.recordFailure('entry-system-bus',error);}catch(error){operations.recordFailure('entry-system-bus-close',error);}}
        return {state:'UNVERIFIED',detail:'Actual entry/HTTP/known producer/application returns retained. Independent shared stores/bus/hidden modules/native/provider/durable pending and natural exit remain OPEN; no restart or clean-exit certification'};
    }});
    startup=operations.run('actual-production-start',async()=>{
        assertStarting();const {loadRuntimeEnvironment}=await import('./config/runtimeCredentials');
        assertStarting();loadRuntimeEnvironment();
        assertStarting();const {configLoader}=await import('./config/configLoader');
        const config=configLoader.getConfig();
        const PORT=config.system.port||3005;
        const HOST=process.env.SILHOUETTE_HOST||'127.0.0.1';
        const PROCESS_STARTED_AT=Date.now();
        assertStarting();const {systemBus}=await import('../services/systemBus');
        closeBus=()=>systemBus.shutdown();
        assertStarting();try{await observeAsyncParticipant('system-bus','EXISTING_DEGRADED_CATCH',()=>systemBus.start());}catch(error){operations.recordDiagnostic('entry-system-bus-start',error,'DEGRADED_FALLBACK','UNAVAILABLE');}
        assertStarting();const dbLoader=await import('./loaders/dbLoader');
        closeDatabaseStores=()=>dbLoader.shutdownDatabaseStoresAfterConsumers();
        assertStarting();const {curiosity}=await import('../services/curiosityService');
        adopt('curiosity',()=>curiosity.shutdown());
        assertStarting();try{await observeAsyncParticipant('curiosity','EXISTING_DEGRADED_CATCH',()=>curiosity.start());}catch(error){operations.recordDiagnostic('entry-curiosity-start',error,'DEGRADED_FALLBACK','UNAVAILABLE');}
        assertStarting();const assembly=await import('./app');
        appStatus=()=>assembly.getApplicationAssemblyStatus();
        beginApp=()=>assembly.beginApplicationProducerShutdown();
        closeApp=()=>assembly.shutdownApplicationAssembly();
        if(stopping)void beginApp();
        assertStarting();const app:Express=await observeAsyncParticipant('application-assembly','EXISTING_PROPAGATION',()=>assembly.assembleProductionApplication());
        assertStarting();const {narrative}=await import('../services/narrativeService');
        adopt('narrative',()=>narrative.shutdown());
        assertStarting();try{await observeAsyncParticipant('narrative','EXISTING_DEGRADED_CATCH',()=>narrative.start());}catch(error){operations.recordDiagnostic('entry-narrative-start',error,'DEGRADED_FALLBACK','UNAVAILABLE');}
        assertStarting();const {startFactoryEvents,closeFactoryEvents}=await import('./controllers/factoryController');
        adopt('factory-events-sse',()=>closeFactoryEvents());
        assertStarting();observeSyncParticipant('factory-events-sse','EXISTING_PROPAGATION',()=>startFactoryEvents());
        installProcessHandlers();
        assertStarting();ingress=new OwnedHttpIngress(operations,app);
        const server=ingress.server;
        await observeAsyncParticipant('http-listen','EXISTING_PROPAGATION',()=>ingress.listen(PORT,HOST));
        phase='LISTENING_UNQUALIFIED';
        console.log('[BOOT] Actual HTTP listener bound; required participants/capability/internal release remain UNVERIFIED');
        await operations.run('actual-post-listen',async()=>{
    // [LEDGER-INTEGRITY] Close ledger rows left open by previous process
    // lives: a restart strands pending/running rows whose executor is
    // gone. Signal verified in code: these rows are unambiguous orphans -
    // the only executor that could advance them ran in the dead process,
    // and mission resume (workflowEngine.executeMissionBuild) always
    // generates a NEW planId via planGenerator.create and overwrites
    // pipelineData.planId, so no resume path ever re-drives a pre-boot
    // row. They are failed honestly (never deleted); re-running the
    // mission is the recovery path.
    try {
        assertStarting();
        const { reapStaleTasks } = await import('../services/execution/taskLedger');
        assertStarting();await observeAsyncParticipant('ledger-reap','EXISTING_DEGRADED_CATCH',()=>reapStaleTasks(PROCESS_STARTED_AT, 'executor lost: process restart (ledger row predates this boot)'));
    } catch (e: any) {
        operations.recordDiagnostic('entry-post-listen',e,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.warn('[BOOT] stale task sweep failed (non-blocking):', e?.message);
    }

    // [GATEWAY] Initialize WebSocket Gateway (shares HTTP server)
    try {
        assertStarting();
        const { gateway } = await import('./gateway');
        adopt('websocket-gateway',()=>gateway.shutdown());
        assertStarting();await observeAsyncParticipant('websocket-gateway','EXISTING_DEGRADED_CATCH',()=>gateway.initialize(server));
        console.log('[GATEWAY] ✅ WebSocket Gateway initialized');
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[GATEWAY] Failed to initialize WebSocket Gateway:', error);
    }

    // [TERMINAL] Initialize Interactive Terminal WebSocket
    try {
        assertStarting();
        const { TerminalGateway } = await import('./channels/terminalWebSocket');
        adopt('terminal-gateway',()=>TerminalGateway.shutdown());
        assertStarting();const {TerminalService}=await import('../services/system/terminalService');
        closeTerminalService=()=>TerminalService.getInstance().shutdown();
        assertStarting();await observeAsyncParticipant('terminal-gateway','EXISTING_DEGRADED_CATCH',()=>TerminalGateway.initialize(server));
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[TERMINAL] Failed to initialize Terminal Gateway:', error);
    }


    // [CHANNELS] Initialize Messaging Channels (WhatsApp, Telegram, Discord)
    try {
        assertStarting();
        const { initializeChannels,channelRouter } = await import('./channels');
        adopt('channel-router',()=>channelRouter.shutdown());
        assertStarting();
        await observeAsyncParticipant('channel-router','EXISTING_DEGRADED_CATCH',()=>initializeChannels());
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[CHANNELS] Failed to initialize channels:', error);
    }

    // [MCP] Initialize and Mount Standard MCP Server
    try {
        assertStarting();
        const { mcpWrapper } = await import('./mcp/mcpServer');
        adopt('mcp-wrapper',()=>mcpWrapper.shutdown());
        assertStarting();await observeAsyncParticipant('mcp-initialize','EXISTING_DEGRADED_CATCH',()=>mcpWrapper.initialize());
        assertStarting();await observeAsyncParticipant('mcp-mount','EXISTING_DEGRADED_CATCH',()=>mcpWrapper.mount(app));
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[MCP] Failed to initialize standard MCP server:', error);
    }

    // [PLUGINS] Initialize Plugin System (Phase 14)
    try {
        assertStarting();
        const { pluginRegistry } = await import('../services/plugins/pluginRegistry');
        assertStarting();
        const { registerCorePlugins } = await import('../services/plugins/loader');

        adopt('plugin-registry',()=>pluginRegistry.shutdown());
        assertStarting();
        // Register Core Plugins
        await observeAsyncParticipant('plugins-core-registration','EXISTING_DEGRADED_CATCH',()=>registerCorePlugins());

        // [R12] Discover + validate + register custom plugins (real ESM load)
        assertStarting();
        const { registerCustomPlugins } = await import('../services/plugins/loader');
        assertStarting();await observeAsyncParticipant('plugins-custom-discovery','EXISTING_DEGRADED_CATCH',()=>registerCustomPlugins());

        // Initialize Registry (starts plugins and registers tools)
        assertStarting();await observeAsyncParticipant('plugin-registry','EXISTING_DEGRADED_CATCH',()=>pluginRegistry.initialize());
        console.log('[PLUGINS] ✅ Plugin System initialized with Core Plugins');
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[PLUGINS] Failed to initialize plugin system:', error);
    }

    // [INGESTION] Start Webhook Ingestion Engine
    try {
        assertStarting();
        const {ingestionEngine}=await import('../services/ingestionEngine');
        adopt('ingestion-engine',()=>ingestionEngine.shutdown());
        assertStarting();await observeAsyncParticipant('ingestion-engine','EXISTING_DEGRADED_CATCH',()=>ingestionEngine.start());
        console.log('[INGESTION] ✅ Webhook Ingestion Engine online');
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[INGESTION] Failed to start Ingestion Engine:', error);
    }

    // [EVOLUTION] Proactive Self-Evolution is now handled by Unified Daemon

    // [COGNITIVE] Start 4-Tier Memory Cognitive Engines & Evolution (Unified Daemon)
    try {
        assertStarting();
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        adopt('unified-daemon',()=>unifiedDaemon.shutdown());
        unifiedDaemon.setRestartHandler(async()=>{await shutdownProductionServer('daemon-restart');throw new Error('Root release/readiness UNVERIFIED: restart refused');});
        assertStarting();await observeAsyncParticipant('unified-daemon','EXISTING_DEGRADED_CATCH',()=>unifiedDaemon.start());
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[DAEMON] Failed to start unified daemon:', error);
    }

    // [ORCHESTRATOR] Initialize Agent Lifecycle Manager (auto-starts on import)
    try {
        assertStarting();const {orchestrator,prepareOrchestratorArbiter,shutdownOrchestratorArbiter,getOrchestratorArbiterLifecycleStatus,prepareOrchestratorPower,shutdownOrchestratorPower,getOrchestratorPowerLifecycleStatus,prepareOrchestratorNeuroLink,shutdownOrchestratorNeuroLink,getOrchestratorNeuroLinkLifecycleStatus}=await import('../services/orchestrator');
        adopt('neuro-link',async()=>{await shutdownOrchestratorNeuroLink();return getOrchestratorNeuroLinkLifecycleStatus();});
        adopt('power-manager',async()=>{await shutdownOrchestratorPower();return getOrchestratorPowerLifecycleStatus();});
        adopt('resource-arbiter',async()=>{await shutdownOrchestratorArbiter();return getOrchestratorArbiterLifecycleStatus();});
        adopt('orchestrator',()=>orchestrator.shutdown());
        // Restore removed arbiter processor before actual actor admission. Its
        // failure stays degraded; do not suppress original orchestrator startup.
        assertStarting();try{observeSyncParticipant('neuro-link','EXISTING_DEGRADED_CATCH',()=>prepareOrchestratorNeuroLink());}catch(error){operations.recordDiagnostic('entry-neuro-link-start',error,'DEGRADED_FALLBACK','UNAVAILABLE');}
        assertStarting();try{observeSyncParticipant('power-manager','EXISTING_DEGRADED_CATCH',()=>prepareOrchestratorPower());}catch(error){operations.recordDiagnostic('entry-power-manager-start',error,'DEGRADED_FALLBACK','UNAVAILABLE');}
        assertStarting();try{await observeAsyncParticipant('resource-arbiter','EXISTING_DEGRADED_CATCH',()=>prepareOrchestratorArbiter());}catch(error){operations.recordDiagnostic('entry-resource-arbiter-start',error,'DEGRADED_FALLBACK','UNAVAILABLE');}
        assertStarting();await observeAsyncParticipant('orchestrator','EXISTING_DEGRADED_CATCH',()=>orchestrator.start());
        console.log('[ORCHESTRATOR] ✅ Agent Lifecycle Manager initialized');

        // [Ticket W7] Wire the capability-awareness writer: it was imported
        // (promptCompiler) but initialize() was never called, so its event
        // subscriptions never existed and universal_knowledge had no writer.
        try {
            assertStarting();
            const { capabilityAwareness } = await import('../services/capabilityAwareness');
            adopt('capability-awareness',()=>capabilityAwareness.shutdownLifecycle());
            assertStarting();await observeAsyncParticipant('capability-awareness','EXISTING_DEGRADED_CATCH',()=>capabilityAwareness.initialize());
            console.log('[CAPABILITY_AWARENESS] ✅ Initialized');
        } catch (caErr) {
        operations.recordDiagnostic('entry-post-listen',caErr,'DEGRADED_FALLBACK','UNAVAILABLE');
            console.error('[CAPABILITY_AWARENESS] Init failed (non-fatal):', caErr);
        }
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[ORCHESTRATOR] Failed to initialize orchestrator:', error);
    }

    // [EVOLUTION] Start Self-Evolution Scheduler (respects PowerManager mode)
    try {
        assertStarting();
        const { evolutionScheduler } = await import('../services/evolution/evolutionScheduler');
        adopt('evolution-scheduler',()=>evolutionScheduler.shutdown());
        assertStarting();await observeAsyncParticipant('evolution-scheduler','EXISTING_DEGRADED_CATCH',()=>evolutionScheduler.start());
        console.log('[EVOLUTION] ✅ Evolution Scheduler started');
    } catch (error) {
        operations.recordDiagnostic('entry-post-listen',error,'DEGRADED_FALLBACK','UNAVAILABLE');
        console.error('[EVOLUTION] Failed to start evolution scheduler:', error);
    }
        });
        assertStarting();postListenReturned=true;
    });
    void startup.catch(error=>{if(!stopping)phase='FAILED';operations.recordFailure('entry-startup',error);void shutdownProductionServer('startup-failure').catch(cleanup=>operations.recordFailure('entry-startup-cleanup',cleanup));});
    return startup;
}
function installProcessHandlers(){
    assertStarting();
    const fatal=(source:string,error:unknown)=>{
        operations.recordFailure(source,error);process.exitCode=1;
        const e=error as {message?:string;stack?:string}|null;
        const message=e?.message||String(error);
        console.error('[FATAL]',source,message);
        if(source==='uncaughtException')console.error(e?.stack);
        const attempt=++loggerAttempt;
        void operations.run('fatal-structured-log:'+attempt,async()=>{
            try{
                const {logger}=await import('../services/logger');
                if(source==='uncaughtException')await logger.fatal({source,stack:e?.stack?.substring(0,500)},message);
                else await logger.error({source,stack:e?.stack?.substring(0,500)},message);
            }catch(logError){operations.recordDiagnostic('fatal-logger',logError,'DEGRADED_FALLBACK','UNAVAILABLE');}
        }).catch(logError=>operations.recordFailure('fatal-logger-admission',logError));
        // Never await self-owned logger imports or terminate the process over
        // accepted work. Actual shutdown remains pending if any owner hangs.
        void shutdownProductionServer(source).catch(e=>operations.recordFailure('entry-fatal-shutdown',e));
    };
    const rejected=(reason:unknown)=>fatal('unhandledRejection',reason);
    const uncaught=(error:Error)=>fatal('uncaughtException',error);
    const term=()=>{void shutdownProductionServer('SIGTERM').catch(error=>operations.recordFailure('entry-signal',error));};
    const interrupt=()=>{void shutdownProductionServer('SIGINT').catch(error=>operations.recordFailure('entry-signal',error));};
    process.on('unhandledRejection',rejected);process.on('uncaughtException',uncaught);
    process.on('SIGTERM',term);process.on('SIGINT',interrupt);
    operations.own({name:'entry-process-hooks',closeRank:-300,close:()=>{
        process.off('unhandledRejection',rejected);process.off('uncaughtException',uncaught);
        process.off('SIGTERM',term);process.off('SIGINT',interrupt);
    }});
}
/** No shutdown imports/acquisitions, process.exit/force-kill/synthetic clean
 * receipt. The old10s deadline now records FAILED+actual pending truth only.
 * Root remains UNVERIFIED even if this returned scope is CLOSED. */
export function shutdownProductionServer(reason:string):Promise<ScopeReport>{
    if(shutdown)return shutdown;
    let resolveShutdown!:(report:ScopeReport)=>void,rejectShutdown!:(error:unknown)=>void;
    shutdown=new Promise<ScopeReport>((resolve,reject)=>{resolveShutdown=resolve;rejectShutdown=reject;});
    // Publish idempotent promise BEFORE synchronous child fences can reenter.
    startFences();process.exitCode=1; // cannot certify clean exit/restart yet
    const deadline=setTimeout(()=>{
        shutdownDeadlineElapsed=true;operations.recordFailure('entry-shutdown-deadline',new Error('10s elapsed: actual work/release remains pending for '+reason));
        process.exitCode=1;
    },10000);deadline.unref();
    const actualClose=operations.close();
    void actualClose.then(resolveShutdown,rejectShutdown);
    void shutdown.then(()=>{shutdownSettled=true;clearTimeout(deadline);phase='CLOSED_UNQUALIFIED';},error=>{
        shutdownSettled=true;clearTimeout(deadline);phase='FAILED';operations.recordFailure('entry-shutdown',error);
    });
    return shutdown;
}
