import {ResourceScope} from '../runtime/resourceScope';
interface DatabaseReceipt {name:string;required:boolean;state:'PENDING'|'RETURNED_UNVERIFIED'|'LOCAL_READY'|'DEGRADED'|'DISABLED'|'FAILED'|'DISPLAY_TIMEOUT_ACTUAL_PENDING';error?:unknown;detail?:string}
const operations=new ResourceScope('database-loader');
const receipts:DatabaseReceipt[]=[];
let initialization:Promise<void>|undefined;
let assetState:'NOT_SCHEDULED'|'SCHEDULED'|'RUNNING'|'COMPLETED_RETURN'|'FAILED'|'CANCELED_BEFORE_INVOKE'='NOT_SCHEDULED';
interface StoreOwner {rank:number;begin:()=>unknown;closing?:Promise<unknown>;receipt?:unknown;error?:unknown}
const stores=new Map<string,StoreOwner>();
let storesClosing=false;
let storesCloseTask:Promise<unknown>|undefined;
function retainStore(name:string,rank:number,begin:()=>unknown){
    if(stores.has(name))return;
    // This is called immediately after actual module acquisition, before work.
    // Full store close is a DIFFERENT root phase, never loader quiesce.
    stores.set(name,{rank,begin});
}
/** ONLY after actual loader+HTTP+other consumer drainage and Nervous shutdown.
 * No imports/initialization in this method. It closes only references actually
 * acquired by this loader; other store clients/owners remain independent. */
export function shutdownDatabaseStoresAfterConsumers():Promise<unknown>{
    if(storesCloseTask)return storesCloseTask;
    storesClosing=true;
    storesCloseTask=(async()=>{
        // Real loader drain before snapshot prevents a late imported store from
        // being omitted. Required caller order keeps consumers alive until done.
        await shutdownDatabaseLoader();
        for(const[name,store]of[...stores].sort((a,b)=>b[1].rank-a[1].rank)){
            try{
                if(!store.closing)store.closing=Promise.resolve().then(store.begin);
                store.receipt=await store.closing;
                const report=store.receipt as {state?:string}|undefined;
                if(report?.state==='FAILED')operations.recordFailure('database-store-report:'+name,report);
            }catch(error){store.error=error;operations.recordFailure('database-store-close:'+name,error);}
        }
        return {state:'UNVERIFIED',failures:operations.getFailures(),stores:[...stores].map(([name,o])=>({name,receipt:o.receipt,error:o.error})),
            detail:'Actual acquired store close returns retained in consumer-after order; native pools/shared clients/SDK/ANN mmap/process exit/durability and other store owners unqualified'};
    })();
    return storesCloseTask;
}
function receipt(name:string,required:boolean):DatabaseReceipt{const r:DatabaseReceipt={name,required,state:'PENDING'};receipts.push(r);return r;}
export function getDatabaseLoaderStatus(){return {receipts:receipts.map(r=>({...r})),assetState,storesClosing,stores:[...stores].map(([name,o])=>({name,closing:!!o.closing,receipt:o.receipt,error:o.error})),
    readiness:'UNVERIFIED',pendingDurable:false,failures:operations.getFailures(),diagnostics:operations.getDiagnostics()};}
/** Only loader calls/waits, NOT storage teardown. Root must separately register
 * actual adapter/SQLite/Redis/Lance/Graph/Qdrant/continuous-memory owners and
 * keep them alive through all consumers. In particular Nervous before Graph. */
export function shutdownDatabaseLoader(){return operations.close();}
export function initDatabases():Promise<void>{
    if(storesClosing||!operations.accepting)return Promise.reject(new Error('Database loader closing'));
    if(initialization)return initialization;
    operations.own({name:'database-loader-coverage',close:()=>({state:'UNVERIFIED',detail:'Actual loader/import/graph/asset return promises retained; store owners/native/pools/continuous-memory child work and crash durability need independent root composition'})});
    initialization=operations.run('actual-initDatabases',async()=>{
        console.log('[LOADER] Initializing Databases...');
        operations.assertAccepting();const {default:fs}=await import('fs');
        const {PATHS}=await import('../config/paths');
        const dirs=receipt('required-directories',true);
        try{
            if(!fs.existsSync(PATHS.UPLOADS))fs.mkdirSync(PATHS.UPLOADS,{recursive:true});
            if(!fs.existsSync(PATHS.DATA))fs.mkdirSync(PATHS.DATA,{recursive:true});
            if(!fs.existsSync(PATHS.DB))fs.mkdirSync(PATHS.DB,{recursive:true});
            dirs.state='LOCAL_READY';
        }catch(error){dirs.state='FAILED';dirs.error=error;throw error;}

        const adapter=receipt('selected-database-adapter',false);
        try{
            operations.assertAccepting();const {getDatabaseAdapter,closeDatabaseAdapter}=await import('../../services/database/adapterFactory');
            retainStore('selected-database-adapter',80,()=>closeDatabaseAdapter());
            await getDatabaseAdapter();adapter.state='RETURNED_UNVERIFIED';
            console.log('[LOADER] Selected database adapter initialization returned; internal/store receipts separate.');
        }catch(error){
            adapter.state='DEGRADED';adapter.error=error;
            operations.recordDiagnostic('database-adapter-fallback',error,'DEGRADED_FALLBACK','UNAVAILABLE');
            console.warn('[LOADER] Falling back to direct SQLite/LanceDB access; selected adapter remains degraded.');
        }

        // The candidate SQLite service is passive. A log about its constructor
        // was not readiness: actually open it and inspect its local receipt.
        const sqlite=receipt('direct-sqlite',false);
        try{
            operations.assertAccepting();const {sqliteService}=await import('../../services/sqliteService');
            retainStore('sqliteService',0,()=>sqliteService.close());
            sqliteService.open();
            if(!sqliteService.getLifecycleStatus().ready)throw new Error('Required SQLite did not become locally ready');
            sqlite.state='LOCAL_READY';
        }catch(error){sqlite.state='DEGRADED';sqlite.error=error;operations.recordDiagnostic('direct-sqlite',error,'DEGRADED_FALLBACK','UNAVAILABLE');}

        const redis=receipt('redis-cache',false);
        try{
            operations.assertAccepting();const {redisClient}=await import('../../services/redisClient');
            retainStore('redisClient',10,()=>redisClient.disconnect());
            await redisClient.connect();
            redis.state=redisClient.isMockMode()?'DEGRADED':'RETURNED_UNVERIFIED';
            redis.detail=redisClient.isMockMode()?'Original in-memory fallback is volatile':'connect returned; no independent socket/persistence claim';
            if(redisClient.isMockMode())operations.recordDiagnostic('redis-cache-fallback',new Error(redis.detail),'DEGRADED_FALLBACK','UNAVAILABLE');
        }catch(error){redis.state='DEGRADED';redis.error=error;operations.recordDiagnostic('redis-cache',error,'DEGRADED_FALLBACK','UNAVAILABLE');}

        const lance=receipt('lancedb',false);
        try{
            operations.assertAccepting();const {lancedbService}=await import('../../services/lancedbService');
            retainStore('lancedbService',20,()=>lancedbService.shutdown());
            await lancedbService.ensureInitialized();lance.state='RETURNED_UNVERIFIED';
            lance.detail='Initializer may retain degraded/native/index state; inspect actual service receipts, not return alone';
        }catch(error){lance.state='DEGRADED';lance.error=error;operations.recordDiagnostic('lancedb',error,'DEGRADED_FALLBACK','UNAVAILABLE');}

        const graphReceipt=receipt('optional-graph',false);
        // Same5s display budget, but retain actual import/connect independently
        // after display timeout; never unowned Promise.race loser.
        const graphActual=operations.run('actual-optional-graph-connect',async()=>{
            operations.assertAccepting();const {graph}=await import('../../services/graphService');
            retainStore('graph',40,()=>graph.close());
            const connected=await graph.connect();
            graphReceipt.state=connected?'RETURNED_UNVERIFIED':'DEGRADED';
            graphReceipt.detail=connected?'Actual connect returned true, internal release separate':'Actual connect returned false/fallback';
        });
        await new Promise<void>(resolve=>{
            let done=false;let timer:ReturnType<typeof setTimeout>|undefined;
            const finish=()=>{if(done)return;done=true;if(timer)clearTimeout(timer);operations.signal.removeEventListener('abort',finish);resolve();};
            graphActual.then(finish,error=>{
                graphReceipt.state='DEGRADED';graphReceipt.error=error;
                operations.recordDiagnostic('optional-graph',error,'DEGRADED_FALLBACK','UNAVAILABLE');finish();
            });
            operations.signal.addEventListener('abort',finish,{once:true});
            if(operations.signal.aborted){finish();return;}
            timer=setTimeout(()=>{
                graphReceipt.state='DISPLAY_TIMEOUT_ACTUAL_PENDING';
                operations.recordDiagnostic('optional-graph-display-timeout',new Error('Graph5s display deadline elapsed, actual connect still owned'),'DEGRADED_FALLBACK','UNVERIFIED');finish();
            },5000);
        });

        const vector=receipt('optional-qdrant',false);
        try{
            operations.assertAccepting();const {vectorMemory}=await import('../../services/vectorMemoryService');
            retainStore('vectorMemory',30,()=>vectorMemory.shutdown());
            const state=await vectorMemory.connect();
            vector.state=state.state==='ready'?'RETURNED_UNVERIFIED':state.state==='disabled'?'DISABLED':'DEGRADED';
            vector.detail=state.state;
        }catch(error){vector.state='DEGRADED';vector.error=error;operations.recordDiagnostic('optional-qdrant',error,'DEGRADED_FALLBACK','UNAVAILABLE');}

        const wal=receipt('continuous-memory-wal',false);
        try{
            operations.assertAccepting();const {continuousMemory}=await import('../../services/memory/continuousMemory');
            retainStore('continuousMemory',100,()=>continuousMemory.shutdown());
            await continuousMemory.initialize();wal.state='RETURNED_UNVERIFIED';
            wal.detail='Original void initializer may start hidden work; WAL durability/recovery/drain NOT inferred';
        }catch(error){wal.state='DEGRADED';wal.error=error;operations.recordDiagnostic('continuous-memory-wal',error,'DEGRADED_FALLBACK','UNAVAILABLE');}

        operations.assertAccepting();assetState='SCHEDULED';
        let settle!:()=>void;const done=new Promise<void>(resolve=>{settle=resolve;});
        void operations.run('asset-catalog-deferred-lifetime',()=>done).catch(error=>operations.recordFailure('asset-lifetime-admission',error));
        const immediate=setImmediate(()=>{
            assetState='RUNNING';
            void operations.run('actual-asset-catalog-sync',async()=>{
                operations.assertAccepting();const {assetCatalog}=await import('../../services/assetCatalog');
                await assetCatalog.cleanupOrphans();
                const {added}=await assetCatalog.syncExistingFiles();
                if(added>0)console.log(`[LOADER] Asset Catalog: ${added} new files (background sync)`);
            }).then(()=>{assetState='COMPLETED_RETURN';settle();},error=>{
                assetState='FAILED';operations.recordFailure('asset-catalog-sync',error);settle();
            });
        });
        operations.own({name:'asset-catalog-immediate',stopIntake:()=>{
            clearImmediate(immediate);if(assetState==='SCHEDULED'){assetState='CANCELED_BEFORE_INVOKE';settle();}
        },close:()=>clearImmediate(immediate)});
    });
    void initialization.catch(error=>operations.recordFailure('database-loader-first-initialization',error));
    return initialization;
}
