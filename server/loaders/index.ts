import {ResourceScope,type ScopeReport} from '../runtime/resourceScope';

interface DeferredReceipt {name:string;delayMs:number;state:'SCHEDULED'|'RUNNING'|'COMPLETED_RETURN'|'FAILED'|'CANCELED_BEFORE_INVOKE';error?:unknown}
const operations=new ResourceScope('server-bootstrap');
const deferred:DeferredReceipt[]=[];
const children=new Map<string,{begin:()=>Promise<unknown>;closing?:Promise<unknown>;receipt?:unknown}>();
// Live accessors retained ONLY at actual existing loader acquisitions.
const acquiredLoaderStatus=new Map<string,()=>unknown>();
let initialization:Promise<void>|undefined;
let phase:'NEW'|'INITIALIZING'|'RETURNED_UNQUALIFIED'|'FAILED'='NEW';
function adopt(name:string,shutdown:()=>Promise<unknown>){
    if(children.has(name))return;
    const child={begin:shutdown,closing:undefined as Promise<unknown>|undefined,receipt:undefined as unknown};children.set(name,child);
    const begin=()=>{
        if(!child.closing){
            try{child.closing=Promise.resolve(child.begin());}catch(error){child.closing=Promise.reject(error);}
            void child.closing.catch(error=>operations.recordFailure('bootstrap-child:'+name,error));
        }
        return child.closing;
    };
    // Fence ALL actual child owners without waiting for their drains in this
    // stop pass. Root still must fence shared consumers before releasing stores.
    operations.own({name:'bootstrap-child:'+name,stopIntake:()=>{void begin();},close:async()=>{
        const receipt=await begin();
        child.receipt=receipt;
        const report=receipt as ScopeReport|undefined;
        if(report?.state==='FAILED')operations.recordFailure('bootstrap-child-report:'+name,report);
        return {state:'UNVERIFIED',detail:'Actual child shutdown returned; child receipts retained, original capability/durability/internal release require independent root evaluation'};
    }});
}
function defer(name:string,delayMs:number,callback:()=>Promise<void>){
    operations.assertAccepting();
    const receipt:DeferredReceipt={name,delayMs,state:'SCHEDULED'};deferred.push(receipt);
    let resolveDone!:()=>void;
    const done=new Promise<void>(resolve=>{resolveDone=resolve;});
    // The timer wait AND actual callback are accepted before scheduling. Actual
    // root close cannot discard imports/work which start after boot returned.
    void operations.run('bootstrap-deferred:'+name,()=>done).catch(error=>operations.recordFailure('bootstrap-deferred-admission:'+name,error));
    const timer=setTimeout(()=>{
        if(!operations.accepting){receipt.state='CANCELED_BEFORE_INVOKE';resolveDone();return;}
        receipt.state='RUNNING';
        void operations.run('bootstrap-callback:'+name,callback).then(()=>{
            receipt.state='COMPLETED_RETURN';resolveDone();
        },error=>{receipt.state='FAILED';receipt.error=error;operations.recordFailure('bootstrap-deferred:'+name,error);resolveDone();});
    },delayMs);
    operations.own({name:'bootstrap-timer:'+name,stopIntake:()=>{
        clearTimeout(timer);
        if(receipt.state==='SCHEDULED'){receipt.state='CANCELED_BEFORE_INVOKE';resolveDone();}
    },close:()=>{clearTimeout(timer);}});
}
export function getServerBootstrapStatus(){return {loaderStatus:[...acquiredLoaderStatus].map(([name,status])=>({name,status:status()})),phase,deferred:deferred.map(r=>({...r})),
    children:[...children].map(([name,c])=>({name,closing:!!c.closing,receipt:c.receipt})),
    readiness:'UNVERIFIED',pendingDurable:false,failures:operations.getFailures(),diagnostics:operations.getDiagnostics()};}
export function shutdownServerBootstrap(){return operations.close();}

/** ACTUAL original initServer entry. Single-use, no work at module evaluation.
 * Return does not mean deferred participants are ready or hidden work released. */
export function initServer():Promise<void>{
    if(!operations.accepting)return Promise.reject(new Error('Server bootstrap is closing'));
    if(initialization)return initialization;
    phase='INITIALIZING';
    operations.own({name:'server-bootstrap-coverage',close:()=>({state:'UNVERIFIED',detail:'Actual local starts/deferred returns retained; db/AI loader hidden work/module effects/full required readiness and shared stores remain unqualified'})});
    initialization=operations.run('actual-initServer',async()=>{
        console.log('=================================');
        console.log('   SILHOUETTE AGENCY OS - v7.5   ');
        console.log('=================================');
        operations.assertAccepting();
        const {initDatabases,shutdownDatabaseLoader,getDatabaseLoaderStatus}=await import('./dbLoader');
        acquiredLoaderStatus.set('database-loader',()=>getDatabaseLoaderStatus());
        adopt('database-loader',()=>shutdownDatabaseLoader());
        await initDatabases();
        operations.assertAccepting();
        const {initAIServices,shutdownAILoader,getAILoaderStatus}=await import('./aiLoader');
        acquiredLoaderStatus.set('ai-loader',()=>getAILoaderStatus());
        adopt('ai-loader',()=>shutdownAILoader());
        await initAIServices();

        // Same autonomy ceiling on the actual Dreamer boot route.
        try{
            operations.assertAccepting();
            const {configLoader}=await import('../config/configLoader');
            const {isTaskAllowedByAutonomy}=await import('../../services/daemon/autonomyPolicy');
            if(isTaskAllowedByAutonomy('Dreamer',configLoader.getConfig().autonomy as any)){
                operations.assertAccepting();
                const {dreamer}=await import('../../services/dreamerService');
                adopt('dreamer',()=>dreamer.shutdownLifecycle());
                await dreamer.startDreamingLoop();
            }else console.log('[BOOT] 🌙 Dreaming loop NOT started: autonomy.enabled=false (config ceiling).');
        }catch(error){
            operations.recordDiagnostic('bootstrap-dreamer',error,'DEGRADED_FALLBACK','UNVERIFIED');
            console.warn('[BOOT] Dreaming loop not started: autonomy config unreadable (fail-closed):',(error as any)?.message);
        }

        operations.assertAccepting();
        const {initializeContextConfig}=await import('../routes/v1/context.routes');
        const {contextBudgetPersistence}=await import('../../services/contextBudgetPersistence');
        adopt('context-budget',()=>contextBudgetPersistence.shutdown());
        await initializeContextConfig();

        operations.assertAccepting();
        const {startHeartbeat}=await import('../jobs/heartbeat');
        operations.assertAccepting();
        const heartbeat=startHeartbeat();adopt('heartbeat',()=>heartbeat.close());
        const {startPersistenceJobs}=await import('../jobs/persistence');
        operations.assertAccepting();
        const persistence=startPersistenceJobs();adopt('persistence-jobs',()=>persistence.close());

        defer('janitor-initial-maintenance',5000,async()=>{
            operations.assertAccepting();
            const {contextJanitor}=await import('../../services/contextJanitor');
            await contextJanitor.runMaintenance();
        });

        // Same Tool_Evolution config/autonomy check and6h cadence.
        try{
            operations.assertAccepting();
            const {configLoader}=await import('../config/configLoader');
            const {isTaskAllowedByAutonomy}=await import('../../services/daemon/autonomyPolicy');
            if(isTaskAllowedByAutonomy('Tool_Evolution',configLoader.getConfig().autonomy as any)){
                const LEARNING_INTERVAL=6*60*60*1000;
                operations.assertAccepting();
                const {learningLoop}=await import('../../services/learningLoop');
                adopt('learning-loop',()=>learningLoop.shutdown());
                learningLoop.schedulePeriodicAnalysis(LEARNING_INTERVAL);
                console.log('[LOADER] 🧠 Learning Loop scheduled (every 6h)');
                operations.assertAccepting();
                const {toolEvolver}=await import('../../services/tools/toolEvolver');
                adopt('tool-evolver',()=>toolEvolver.shutdown());
                toolEvolver.scheduleEvolutionCycles(LEARNING_INTERVAL);
                console.log('[LOADER] 🧬 Tool Evolution scheduled (every 6h)');
                defer('initial-learning-analysis',30000,async()=>{
                    console.log('[LOADER] 🔍 Running initial self-evolution analysis...');
                    const insights=await learningLoop.analyzeFailures();
                    console.log(`[LOADER] 💡 Initial analysis complete: ${insights.length} insights found`);
                });
            }else console.log('[LOADER] 🧬 Self-evolution loops NOT started: autonomy ceiling (Tool_Evolution / allowEvolution) disabled.');
        }catch(error){
            operations.recordDiagnostic('bootstrap-tool-evolution',error,'DEGRADED_FALLBACK','UNVERIFIED');
            console.warn('[LOADER] 🧬 Self-evolution loops not started: autonomy config unreadable (fail-closed):',(error as any)?.message||error);
        }

        if(process.env.ENABLE_VOICE_ENGINE==='true'){
            operations.assertAccepting();
            const {voiceMonitor}=await import('../../services/media/voiceMonitorService');
            adopt('voice-monitor',()=>voiceMonitor.shutdown());
            voiceMonitor.startMonitoring();
            console.log('[LOADER] 🎤 Voice Engine monitoring started');
        }else console.log('[LOADER] 🎤 Voice Engine monitoring disabled (ENABLE_VOICE_ENGINE != true)');

        defer('nervous-system-initialization',3000,async()=>{
            operations.assertAccepting();
            const {nervousSystem,initializeNervousSystem}=await import('../../services/connectionNervousSystem');
            adopt('connection-nervous-system',()=>nervousSystem.shutdown());
            await initializeNervousSystem();
            console.log('[LOADER] 🧠 Connection Nervous System initialization returned; target health receipts remain separate');
        });
        defer('scheduler-initialization',5000,async()=>{
            operations.assertAccepting();
            const {schedulerService}=await import('../../services/schedulerService');
            adopt('autonomous-scheduler',()=>schedulerService.shutdown());
            // Preserve start()'s actual autonomy/storage guard BEFORE requesting
            // storage recovery. Its Boolean is not readiness on its own.
            operations.assertAccepting();
            if(schedulerService.start()){
                await schedulerService.initialize();
                console.log('[LOADER] Autonomous Scheduler scheduled; execution/storage receipts separate');
            }else console.log('[LOADER] Scheduler not started: scheduler/autonomy ceiling disabled');
        });
        operations.assertAccepting();
        phase='RETURNED_UNQUALIFIED';
        console.log('[LOADER] Bootstrap calls returned; deferred readiness and full root remain UNVERIFIED.');
    });
    void initialization.catch(error=>{phase='FAILED';operations.recordFailure('server-bootstrap-first-initialization',error);});
    return initialization;
}
