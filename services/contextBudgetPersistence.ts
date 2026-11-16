import {ResourceScope} from '../server/runtime/resourceScope';
import {contextAssembler,type TokenBudgetConfig} from './contextAssembler';
import {redisClient} from './redisClient';

const KEY='silhouette:context:budget';
export interface ContextBudgetReceipt {
    id:number;state:'ACCEPTED'|'LOCAL_APPLIED'|'LOCAL_ONLY'|'REMOTE_READBACK'|'UNKNOWN';
    localApplied:boolean;remoteReadback:boolean;restartDurability:'UNVERIFIED';error?:unknown;
}
/** Actual shared budget owner, not a second Redis connection/config cache.
 * Read/write/load are serialized so a late startup read cannot overwrite an
 * accepted newer mutation. Pending outcome never authorizes replay. */
class ContextBudgetPersistence {
    private readonly operations=new ResourceScope('context-budget');
    private tail:Promise<unknown>=Promise.resolve();
    private initializeTask?:Promise<void>;
    private loadState:'NOT_STARTED'|'LOADED_READBACK'|'DEFAULT_REMOTE_VALUE_UNVERIFIED'|'DEGRADED_UNKNOWN'='NOT_STARTED';
    private readonly receipts:ContextBudgetReceipt[]=[];
    private blocked=false;
    constructor(){
        this.operations.own({name:'context-budget-application',close:()=>({state:'UNVERIFIED',detail:'Accepted config operations drained; pending volatile, Redis shared connection/persistence and cross-process writes remain separate obligations'})});
    }
    status(){return {loadState:this.loadState,blocked:this.blocked,receipts:this.receipts.map(r=>({...r})),pendingDurable:false,
        diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures(),release:'UNVERIFIED'};}
    shutdown(){return this.operations.close();}
    private enqueue<T>(name:string,operation:()=>Promise<T>):Promise<T>{
        return this.operations.run(name,()=>{
            const actual=this.tail.then(operation);
            // Keep actual initiating receipt; only sequence independent accepted work.
            this.tail=actual.catch(()=>{});return actual;
        });
    }
    initialize():Promise<void>{
        this.operations.assertWorkAccepted();
        if(this.initializeTask)return this.initializeTask;
        this.initializeTask=this.enqueue('context-budget-initialize',async()=>{
            try{
                const cached=await redisClient.get(KEY);
                if(redisClient.isMockMode())throw new Error('Context budget startup read is volatile Redis fallback, not restored remote configuration');
                if(cached){
                    const config=JSON.parse(cached) as TokenBudgetConfig;
                    contextAssembler.setTokenBudget(config);
                    this.loadState='LOADED_READBACK';
                    console.log('[CONTEXT_ROUTES] 📥 Loaded persisted token budget from Redis');
                }else{
                    this.loadState='DEFAULT_REMOTE_VALUE_UNVERIFIED';
                    console.log('[CONTEXT_ROUTES] 📌 Using default token budget');
                }
            }catch(error){
                // Original optional/default display behavior remains. Its degraded load is
                // explicit, not READY/persisted. Mutations block until grounded
                // reconciliation; no blind full-snapshot overwrite or replay.
                this.loadState='DEGRADED_UNKNOWN';this.blocked=true;
                this.operations.recordDiagnostic('context-budget-startup',error,'DEGRADED_FALLBACK','UNVERIFIED');
                console.warn('[CONTEXT_ROUTES] Could not load persisted config, using defaults:',error);
            }
        });
        void this.initializeTask.catch(error=>this.operations.recordFailure('context-budget-initialize-admission',error));
        return this.initializeTask;
    }
    update(config:Partial<TokenBudgetConfig>):Promise<{receipt:ContextBudgetReceipt;budget:TokenBudgetConfig}>{
        this.operations.assertWorkAccepted();
        // Capture request/preset bytes before yielding. Never serialize a later
        // external mutation of req.body or the shared nested budget object.
        const captured=JSON.parse(JSON.stringify(config)) as Partial<TokenBudgetConfig>;
        // Schedule initialization synchronously BEFORE this mutation is queued;
        // waiting for a task queued behind ourselves would deadlock.
        const readiness=this.initialize();
        return this.enqueue('context-budget-update',async()=>{
            await readiness;
            if(this.blocked)throw new Error('Context budget has unresolved applied/unknown outcome; reconciliation required, replay blocked');
            const receipt:ContextBudgetReceipt={id:this.receipts.length+1,state:'ACCEPTED',localApplied:false,remoteReadback:false,restartDurability:'UNVERIFIED'};
            this.receipts.push(receipt);
            try{
                contextAssembler.setTokenBudget(captured);
                receipt.localApplied=true;receipt.state='LOCAL_APPLIED';
                const bytes=JSON.stringify(contextAssembler.getTokenBudget());
                const budget=JSON.parse(bytes) as TokenBudgetConfig;
                await redisClient.set(KEY,bytes,0); // Same original key/permanentTTL.
                if(redisClient.isMockMode()){
                    receipt.state='LOCAL_ONLY';this.blocked=true;
                    this.operations.recordDiagnostic('context-budget-local-only',new Error('Budget applied locally, Redis is volatile fallback; remote persistence unverified'),'DEGRADED_FALLBACK','UNAVAILABLE');
                    return {receipt:{...receipt},budget};
                }
                const readback=await redisClient.get(KEY);
                if(redisClient.isMockMode()||readback!==bytes)throw new Error('Context budget remote readback missing/mismatched or fallback changed');
                receipt.remoteReadback=true;receipt.state='REMOTE_READBACK';
                // Readback != Redis disk fsync/AOF/replication, restart or cross-
                // process exclusion. No crash-durability claim is made here.
                return {receipt:{...receipt},budget};
            }catch(error){
                receipt.state='UNKNOWN';receipt.error=error;this.blocked=true;
                this.operations.recordFailure('context-budget-possibly-applied-no-replay',error);
                // Do not roll back/reapply memory or rewrite Redis after an
                // unknown write result. Return truthful pending202 to callers.
                return {receipt:{...receipt},budget:JSON.parse(JSON.stringify(contextAssembler.getTokenBudget()))};
            }
        });
    }
}
export const contextBudgetPersistence=new ContextBudgetPersistence();
