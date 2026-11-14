'use strict';
// SOURCE-ONLY PROPOSAL. One pre-credential diagnostic, no screenshot or mutation.
module.exports=function boundaryProbe(context,page,evidence,workEnd,originalBodySettled){
 // Internal state is never the published receipt. finish() takes ONE immutable
 // barrier snapshot, so late completions cannot turn a residual into acceptance.
 const record={version:1,status:'ARMED',startedAt:null,finishedAt:null,http:{result:'NOT_STARTED',status:null,startedAt:null,finishedAt:null},playwright:{result:'NOT_STARTED'},cdp:{session:'NOT_STARTED',evaluation:'NOT_STARTED',detach:'NOT_STARTED',lateDetach:'NOT_NEEDED',geometry:null}};
 const originals=new Set(),disposals=new Set();let cleanupFailed=false,cancelled=false,finishPromise;
 const timeoutResult=Symbol();
 const dispose=async(session,late=false)=>{
  let timer,timedOut=false;if(late)record.cdp.lateDetach='PENDING';const original=Promise.resolve().then(()=>session.detach());
  disposals.add(original);
  // Keep the actual disposal retained until it settles. Timer expiry is NOT
  // a close receipt; a late reject remains observed without mutating evidence.
  void original.then(()=>{if(late)record.cdp.lateDetach=timedOut?'FAILED':'DETACHED';disposals.delete(original);},()=>{cleanupFailed=true;if(late)record.cdp.lateDetach='FAILED';disposals.delete(original);});
  try{await Promise.race([original,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(timeoutResult);},500);})]);return 'DETACHED';}
  catch{cleanupFailed=true;if(late)record.cdp.lateDetach='FAILED';return 'FAILED';}
  finally{clearTimeout(timer);}
 };
 const bound=async(fn,ms,onLate)=>{
  const remaining=workEnd-Date.now();if(remaining<=0)throw 'COMMON_BUDGET';
  let timer,timedOut=false;
  const original=Promise.resolve().then(fn);originals.add(original);
  // Register late-session disposal BEFORE releasing this retained original.
  // dispose() creates its own tracked500ms attempt independent of workEnd.
  void original.then(value=>{if(timedOut&&onLate)void onLate(value);originals.delete(original);},()=>originals.delete(original));
  try{return await Promise.race([original,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(timeoutResult);},Math.min(ms,remaining));})]);}
  catch(e){if(e===timeoutResult)throw 'ACTION_TIMEOUT';throw 'ORIGINAL_REJECTED';}
  finally{clearTimeout(timer);}
 };
 const capture=async()=>{
  if(cancelled||originalBodySettled()){record.status='NOT_NEEDED_ORIGINAL_SETTLED';return;}
  if(evidence.credentialFixtureEntered||evidence.functional){record.status='REFUSED_CREDENTIAL_BOUNDARY';return;}
  record.startedAt=Date.now();record.status='STARTED';
  const http=async()=>{const startedAt=Date.now();try{const response=await bound(()=>context.request.get('http://127.0.0.1:3005/v1/identity/current-session',{timeout:1000}),1000);const status=response.status();if(!Number.isInteger(status)||status<100||status>599)throw 'INVALID_STATUS';record.http={result:'RESPONSE',status,startedAt,finishedAt:Date.now()};}catch(e){record.http={result:e==='ACTION_TIMEOUT'?'ACTION_TIMEOUT':e==='COMMON_BUDGET'?'COMMON_BUDGET':'ORIGINAL_REJECTED',status:null,startedAt,finishedAt:Date.now()};}};
  const pw=async()=>{try{const result=await bound(()=>page.evaluate(()=>true),1000);record.playwright.result=result===true?'RETURNED_TRUE':'INVALID_FIXED_RESULT';}catch(e){record.playwright.result=e==='ACTION_TIMEOUT'?'ACTION_TIMEOUT':e==='COMMON_BUDGET'?'COMMON_BUDGET':'ORIGINAL_REJECTED';}};
  const cdp=async()=>{
   let session;
   try{
    session=await bound(()=>context.newCDPSession(page),1000,late=>dispose(late,true));record.cdp.session='CREATED';
    record.cdp.evaluation='STARTED';
    const response=await bound(()=>session.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const e=document.body;if(!e)return {readyState:document.readyState,body:null};const r=e.getBoundingClientRect(),s=getComputedStyle(e);const allowed=['block','flex','grid','none','contents','inline','inline-block'];return {readyState:document.readyState,body:{children:e.childElementCount,width:r.width,height:r.height,display:allowed.includes(s.display)?s.display:'OTHER',visibility:['visible','hidden','collapse'].includes(s.visibility)?s.visibility:'OTHER'}}})()`}),1000);
    const value=response?.result?.value;
    if(!value||Object.keys(value).sort().join(',')!=='body,readyState'||!['loading','interactive','complete'].includes(value.readyState))throw 'INVALID_FIXED_RESULT';
    if(value.body!==null){const b=value.body;if(Object.keys(b).sort().join(',')!=='children,display,height,visibility,width'||!Number.isInteger(b.children)||b.children<0||b.children>1000000||!['block','flex','grid','none','contents','inline','inline-block','OTHER'].includes(b.display)||!['visible','hidden','collapse','OTHER'].includes(b.visibility)||!['width','height'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=10000000))throw 'INVALID_FIXED_RESULT';}
    record.cdp.geometry=value;record.cdp.evaluation='FIXED_GEOMETRY_RETURNED';
   }catch(e){const result=e==='ACTION_TIMEOUT'?'ACTION_TIMEOUT':e==='COMMON_BUDGET'?'COMMON_BUDGET':'ORIGINAL_REJECTED_OR_INVALID';if(session)record.cdp.evaluation=result;else record.cdp.session=result;}
   finally{if(session)record.cdp.detach=await dispose(session);}
  };
  await Promise.allSettled([http(),pw(),cdp()]);
  record.finishedAt=Date.now();if(record.status==='STARTED')record.status='FIXED_RESULTS_ONLY_NOT_CAUSE';
 };
 let timer,resolveTask;
 const task=new Promise(resolve=>{resolveTask=resolve;timer=setTimeout(()=>{void capture().then(resolve,()=>{record.status='FAILED_UNEXPECTED';resolve();});},1000);});
 return {finish(){
  if(finishPromise)return finishPromise;
  finishPromise=(async()=>{
   if(record.status==='ARMED'){cancelled=true;clearTimeout(timer);record.status='NOT_NEEDED_ORIGINAL_SETTLED';resolveTask();}
   await task;
   // A separate bounded cleanup barrier, not additional browser work time.
   let barrierTimer;
   try{if(disposals.size)await Promise.race([Promise.allSettled([...disposals]),new Promise(resolve=>{barrierTimer=setTimeout(resolve,500);})]);}
   finally{clearTimeout(barrierTimer);}
   const receipt=JSON.parse(JSON.stringify(record));
   receipt.pendingOriginalCount=originals.size;receipt.pendingDisposalCount=disposals.size;
   receipt.cleanupStatus=cleanupFailed?'FAILED':(originals.size||disposals.size?'RESIDUAL_UNVERIFIED':'CLEAN');
   if(receipt.cleanupStatus!=='CLEAN')receipt.status='FAILED_DIAGNOSTIC_CLEANUP';
   evidence.preCredentialBoundary=receipt;
   return receipt;
  })();
  return finishPromise;
 }};
};
