/** References only: no runtime identity import or constructor/init on teardown.
 * Auth middleware and public identity routes capture the SAME actual singleton. */
let acquired:typeof import('../identityService').identityService|undefined;
let closeTask:Promise<unknown>|undefined;
let resources:unknown;
export function retainAcquiredIdentity(service:typeof import('../identityService').identityService){acquired=service;}
export function getAcquiredIdentityLifecycleStatus(){return {acquired:!!acquired,closing:!!closeTask,resources,
    readiness:'UNVERIFIED',release:'UNVERIFIED',otherCallers:'UNVERIFIED'};}
/** Actual entry must drain HTTP and known producers BEFORE this shared store.
 * Other identity callers remain separate root ownership obligations. */
export function shutdownAcquiredIdentityAfterHttpDrain():Promise<unknown>{
    if(closeTask)return closeTask;
    closeTask=(async()=>{resources=await acquired?.shutdown();return {resources,status:getAcquiredIdentityLifecycleStatus(),release:'UNVERIFIED'};})();
    return closeTask;
}
