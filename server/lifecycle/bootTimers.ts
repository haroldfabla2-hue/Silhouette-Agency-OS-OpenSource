/** Fixed original server-loader timer frontier. Pure until explicitly called.
 * No generic exported label/target selector, hidden host or stop-time imports.
 */
import { serverOwner } from '../../services/lifecycle/preparationBindings';
import { AdmissionClosed, type Scope } from '../../services/lifecycle/host';
import { RuntimeConstructionAdmissionClosed } from '../../services/lifecycle/runtimeStopBindings';
type Slot = { label:string; recurring:boolean; failureKind:'task'|'owner'; phase:'UNSEEN'|'SCHEDULED'|'RUNNING'|'SETTLED'|'CANCELLED'|'UNVERIFIED'; cancel?:()=>void; original?:Promise<void>; fires:number; failures:number };
const slot=(label:string,recurring=false,failureKind:'task'|'owner'='task'):Slot=>({label,recurring,failureKind,phase:'UNSEEN',fires:0,failures:0});
const asset=slot('asset-catalog-immediate');
const janitor=slot('janitor-initial-maintenance');
const initialLearning=slot('initial-learning-analysis');
const nervous=slot('nervous-system-startup');
const scheduler=slot('autonomous-scheduler-startup');
const heartbeat=slot('heartbeat-job',true);
const metrics=slot('cost-metrics-job',true,'owner');
const graphStartup=slot('original-graph-startup');
const systemTick=slot('system-tick-job',true);
const learning=slot('periodic-learning-analysis',true);
const evolution=slot('periodic-tool-evolution',true);
const slots=[graphStartup,asset,janitor,initialLearning,nervous,scheduler,heartbeat,metrics,systemTick,learning,evolution];
let sealed=false;
let ownership:Scope|undefined;
let drained:Promise<void>|undefined;
function owner():Scope {
    if(!ownership) {
        const original=serverOwner();
        original.onSeal(()=>sealAndDrainBootTimers());
        ownership=original;
    }
    return ownership;
}
function fire(item:Slot,body:()=>unknown):Promise<void>|undefined {
    if(sealed)return;
    // Declared single-flight per original timer. Original task promises stay
    // rejected on failure; their independent settlement join is not task success.
    if(item.phase==='RUNNING')return item.original;
    let yes!:()=>void;let no!:(error:unknown)=>void;
    const original=new Promise<void>((resolve,reject)=>{yes=resolve;no=reject;});
    item.original=original;item.phase='RUNNING';item.fires++;
    void original.then(()=>{if(item.phase!=='UNVERIFIED')item.phase='SETTLED';},error=>{if(item.phase!=='UNVERIFIED')item.phase='SETTLED';console.error('[BOOT TIMER] Original task failed:',item.label,error);});
    try {
        owner().invoke('original-timer-settlement:'+item.label,()=>{
            try {
                void Promise.resolve(body()).then(yes,error=>{
                    item.failures++;
                    if(item.failureKind==='owner')owner().failure('original-timer-integrity:'+item.label,error);
                    else owner().taskFailed('original-timer-outcome:'+item.label,error);
                    no(error);
                });
            } catch(error) {
                item.failures++;
                    if(item.failureKind==='owner')owner().failure('original-timer-integrity:'+item.label,error);
                    else owner().taskFailed('original-timer-outcome:'+item.label,error);
                    no(error);
            }
            // The original failed receipt above is retained separately. Host
            // owns the join and exact outcome record, not a fabricated result.
            return original.then(()=>undefined,()=>undefined);
        });
    } catch(error) {
        item.failures++;owner().failure('original-timer-admission:'+item.label,error);
        try {item.cancel?.();}
        catch(cancelError) {item.phase='UNVERIFIED';owner().failure('original-timer-admission-cleanup:'+item.label,cancelError);}
        finally {no(error);}
    }
    return original;
}
function schedule(item:Slot,milliseconds:number,body:()=>unknown,immediate=false):boolean {
    if(sealed)return false;
    if(!Number.isSafeInteger(milliseconds)||milliseconds<0)throw new Error('Invalid original boot timer interval');
    owner();
    if(item.phase!=='UNSEEN')return false; // explicit idempotent source slot
    const originalCallback=()=>fire(item,body);
    if(immediate) {const handle=setImmediate(originalCallback);item.cancel=()=>clearImmediate(handle);}
    else if(item.recurring) {const handle=setInterval(originalCallback,milliseconds);item.cancel=()=>clearInterval(handle);}
    else {const handle=setTimeout(originalCallback,milliseconds);item.cancel=()=>clearTimeout(handle);}
    item.phase='SCHEDULED';return true;
}
export function prepareOriginalBootTimerFrontier():void {owner();}
export function bootTimersAreSealed():boolean{return sealed;}
export function expectedBootShutdownAdmission(error:unknown):boolean {
    return sealed&&(error instanceof AdmissionClosed||error instanceof RuntimeConstructionAdmissionClosed);
}
export function holdOriginalGraphStartup(body:()=>unknown):Promise<void> {
    return fire(graphStartup,body)??Promise.reject(new AdmissionClosed('graph-startup-after-boot-seal'));
}
export function scheduleAssetCatalogSync(body:()=>unknown):boolean{return schedule(asset,0,body,true);}
export function scheduleInitialJanitor(body:()=>unknown,interval:number):boolean{return schedule(janitor,interval,body);}
export function scheduleInitialLearning(body:()=>unknown,interval:number):boolean{return schedule(initialLearning,interval,body);}
export function scheduleNervousSystemStartup(body:()=>unknown,interval:number):boolean{return schedule(nervous,interval,body);}
export function scheduleAutonomousSchedulerStartup(body:()=>unknown,interval:number):boolean{return schedule(scheduler,interval,body);}
export function startHeartbeatTimer(body:()=>unknown,interval:number):boolean{return schedule(heartbeat,interval,body);}
export function startCostMetricsTimer(body:()=>unknown,interval:number):boolean{return schedule(metrics,interval,body);}
export function startSystemTickTimer(body:()=>unknown,interval:number):boolean{return schedule(systemTick,interval,body);}
export function startLearningAnalysisTimer(body:()=>unknown,interval:number):boolean{return schedule(learning,interval,body);}
export function startToolEvolutionTimer(body:()=>unknown,interval:number):boolean{return schedule(evolution,interval,body);}
export function sealAndDrainBootTimers():Promise<void> {
    sealed=true;
    if(drained)return drained;
    const cancelErrors:unknown[]=[]; // at most one per source-fixed11 slots
    // No original task callback runs in cancellation, but a real cancel error
    // must not skip the remaining independent handles or active-work joins.
    for(const item of slots) {
        try {item.cancel?.();if(item.phase==='SCHEDULED')item.phase='CANCELLED';}
        catch(error) {
            item.phase='UNVERIFIED';cancelErrors.push(error);
            owner().failure('original-timer-cancel:'+item.label,error);
        }
    }
    drained=Promise.allSettled(slots.flatMap(item=>item.original?[item.original]:[])).then(()=>{
        if(cancelErrors.length)throw new AggregateError(cancelErrors,'Original boot timer cancellation failed');
    });
    return drained;
}
export function bootTimerFrontier():readonly Readonly<{label:string;phase:string;fires:number;failures:number}>[] {
    return slots.map(({label,phase,fires,failures})=>Object.freeze({label,phase,fires,failures}));
}
