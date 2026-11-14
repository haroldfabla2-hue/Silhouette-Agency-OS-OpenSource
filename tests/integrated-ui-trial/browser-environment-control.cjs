'use strict';
// Environmental qualification only. No new target, timer loop, DOM data or request.
module.exports=function environmentControl(browser,page,workEnd){
 const record={version:1,status:'NOT_QUALIFIED',baseline:'NOT_STARTED',samples:[],cleanupStatus:'NOT_FINISHED',pendingOriginalCount:0,pendingDisposalCount:0};
 const originals=new Set(),disposals=new Set();let session,closing=false,failed=false,finishPromise;
 const timeout=Symbol();
 const dispose=async value=>{
  let timer;const original=Promise.resolve().then(()=>value.detach());disposals.add(original);
  void original.then(()=>disposals.delete(original),()=>{failed=true;disposals.delete(original);});
  try{await Promise.race([original,new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout),500);})]);}
  catch{failed=true;}finally{clearTimeout(timer);}
 };
 const bound=async(fn,onLate)=>{
  const left=workEnd-Date.now();if(left<=0){failed=true;throw timeout;}
  let timer,timedOut=false;const original=Promise.resolve().then(fn);originals.add(original);
  void original.then(value=>{if((timedOut||closing)&&onLate)void onLate(value);originals.delete(original);},()=>originals.delete(original));
  try{return await Promise.race([original,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(timeout);},Math.min(left,1000));})]);}
  catch(e){failed=true;throw e;}finally{clearTimeout(timer);}
 };
 const sample=async phase=>{
  if(!['BASELINE','FIRST_NAVIGATION','FIRST_BODY_VISIBLE'].includes(phase)||record.samples.some(r=>r.phase===phase)||closing)throw Error('ENVIRONMENT_FIXED_PHASE');
  const row={phase,startedAt:Date.now(),finishedAt:null,browser:'NOT_STARTED',page:phase==='BASELINE'?'NOT_STARTED':'NOT_APPLICABLE'};record.samples.push(row);
  const version=async()=>{
   try{if(!session)throw Error('NO_SESSION');const v=await bound(()=>session.send('Browser.getVersion'));row.browser=v?.product==='HeadlessChrome/145.0.7632.6'||v?.product==='Chrome/145.0.7632.6'?'PINNED_VERSION_RETURNED':'INVALID_FIXED_VERSION';if(row.browser!=='PINNED_VERSION_RETURNED')failed=true;}
   catch(e){row.browser=e===timeout?'ACTION_TIMEOUT':'ORIGINAL_REJECTED';}
  };
  const empty=async()=>{try{const value=await bound(()=>page.evaluate(()=>true));row.page=value===true?'RETURNED_TRUE':'INVALID_FIXED_RESULT';if(value!==true)failed=true;}catch(e){row.page=e===timeout?'ACTION_TIMEOUT':'ORIGINAL_REJECTED';}};
  await Promise.allSettled(phase==='BASELINE'?[version(),empty()]:[version()]);row.finishedAt=Date.now();
  return row.browser==='PINNED_VERSION_RETURNED'&&(phase!=='BASELINE'||row.page==='RETURNED_TRUE');
 };
 return {
  async baseline(){
   if(page.url()!=='about:blank'){failed=true;record.baseline='FAILED';return false;}
   try{session=await bound(()=>browser.newBrowserCDPSession(),late=>dispose(late));}
   catch{record.baseline='FAILED';return false;}
   const ok=await sample('BASELINE');record.baseline=ok?'QUALIFIED_ORIGINAL_ABOUT_BLANK_ONLY':'FAILED';return ok;
  },
  sample,
  finish(){
   if(finishPromise)return finishPromise;
   closing=true;finishPromise=(async()=>{
    if(session)await dispose(session);
    let timer;try{if(disposals.size)await Promise.race([Promise.allSettled([...disposals]),new Promise(resolve=>{timer=setTimeout(resolve,500);})]);}finally{clearTimeout(timer);}
    const result=JSON.parse(JSON.stringify(record));result.pendingOriginalCount=originals.size;result.pendingDisposalCount=disposals.size;
    result.cleanupStatus=failed?'FAILED':originals.size||disposals.size?'RESIDUAL_UNVERIFIED':'CLEAN';
    result.status=result.baseline==='QUALIFIED_ORIGINAL_ABOUT_BLANK_ONLY'&&result.cleanupStatus==='CLEAN'?'FIXED_ENVIRONMENT_RESULTS_NOT_PRODUCT_PROOF':'FAILED_OR_UNQUALIFIED';
    return result;
   })();return finishPromise;
  }
 };
};
