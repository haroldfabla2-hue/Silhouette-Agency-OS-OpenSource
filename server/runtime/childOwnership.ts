import { exec, type ChildProcess, type ExecOptions } from 'child_process';
import { ResourceScope } from './resourceScope';

export interface ChildReceipt {
    pid?:number;
    direct:'PENDING'|'CLOSED';
    code?:number|null;
    signal?:NodeJS.Signals|null;
    descendants:'UNVERIFIED';
    errors:unknown[];
}
/** Takes an actual acquired child, not a PID guessed from a port. No group-kill
 * claim or timeout-to-success. 'close' includes direct-child stdio completion. */
export function ownChild(scope:ResourceScope,child:ChildProcess,name:string,receipts:ChildReceipt[]) {
    const receipt:ChildReceipt={pid:child.pid,direct:'PENDING',descendants:'UNVERIFIED',errors:[]};
    receipts.push(receipt);
    let ended=false,stopRequested=false;
    let resolveClosed!:()=>void;
    const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
    const onError=(error:Error)=>{receipt.errors.push(error);scope.recordDiagnostic(name,error,'OPERATION_REJECTED','UNVERIFIED');};
    const onClose=(code:number|null,signal:NodeJS.Signals|null)=>{
        ended=true;receipt.direct='CLOSED';receipt.code=code;receipt.signal=signal;
        child.off('error',onError);resolveClosed();
    };
    const stop=()=>{
        if(ended||stopRequested||child.exitCode!==null||child.signalCode!==null)return;
        stopRequested=true;
        try { if(!child.kill()) scope.recordFailure(name+':termination',new Error('Direct child did not accept termination signal')); }
        catch(error){receipt.errors.push(error);scope.recordFailure(name+':termination',error);}
    };
    // Install observation before stop can run. No await/acquisition gap.
    child.on('error',onError);child.once('close',onClose);
    scope.own({name,stopIntake:stop,close:async()=>{
        stop();await closed;
        return {state:'UNVERIFIED',detail:'Actual direct child and stdio closed; shell/worker descendants are not certified'};
    }});
    return {closed,stop,receipt};
}
/** Scope owns both the real exec callback and direct child's close. */
export function execOwned(scope:ResourceScope,name:string,command:string,receipts:ChildReceipt[],options:ExecOptions={}):Promise<{stdout:string,stderr:string}> {
    return scope.run(name,async()=>{
        scope.assertAccepting();
        let child!:ChildProcess;
        let resolveOutput!:(value:{stdout:string,stderr:string})=>void,rejectOutput!:(error:unknown)=>void;
        const output=new Promise<{stdout:string,stderr:string}>((resolve,reject)=>{resolveOutput=resolve;rejectOutput=reject;});
        try {
            child=exec(command,{...options,encoding:'utf8'},(error,stdout,stderr)=>{
                if(error)rejectOutput(error);else resolveOutput({stdout:String(stdout),stderr:String(stderr)});
            });
        } catch(error) { rejectOutput(error); return await output; }
        const owned=ownChild(scope,child,name,receipts);
        try{return await output;}finally{await owned.closed;}
    });
}
