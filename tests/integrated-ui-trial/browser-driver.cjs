'use strict';
// Real local browser only. Failure evidence is owed even without a visible body.
const fs=require('node:fs');
const workEnd=Date.now()+120000;
const {chromium}=require('/app/node_modules/playwright');
(async()=>{
 let browser,context,page,primary,bodyProbe;let overflow=false;let workAborted=false;const workPending=new Set();
 const evidence={operations:[],console:[],pageErrors:[],failedResources:[],localResources:[],requests:[],responses:[],setupRequired:null,authenticated:false,chatStorageVerified:false,safeAuthenticatedPixels:false,lifecycleEvents:[],finishedResources:[],checkpoints:[],screenshot:null,bodyVisibleObserved:false,cleanupErrors:[]};
 const bounded=async(promise,ms,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}};
 const work=async(fn,operation)=>{
  const remaining=workEnd-Date.now();if(remaining<=0)throw Error('BROWSER_WORK_BUDGET');
  if(evidence.operations.length>=64){overflow=true;throw Error('BROWSER_OPERATION_CAP');}
  const row={ordinal:evidence.operations.length,operation,startedAt:Date.now(),originalSettledAt:null,wrapperFinishedAt:null,originalResult:'PENDING',wrapperResult:'PENDING',deadlineKind:remaining<15000?'COMMON_WORK_END':'ACTION_15_SECONDS'};
  evidence.operations.push(row);const timeout=Symbol();let timer;
  const original=Promise.resolve().then(fn);workPending.add(original);
  void original.then(value=>{
   row.originalResult='FULFILLED';row.originalSettledAt=Date.now();workPending.delete(original);
   if(workAborted&&value&&typeof value.close==='function'){
    void bounded(Promise.resolve().then(()=>value.close()),1000,'LATE_SCOPE_CLOSE_TIMEOUT').catch(()=>{add(evidence.cleanupErrors,{kind:'LATE_BROWSER_SCOPE_CLOSE_FAILURE'});process.exitCode=1;});
   }
  },error=>{row.originalResult=error instanceof Error&&error.name==='TimeoutError'?'REJECTED_TIMEOUT_CLASS':'REJECTED_OTHER';row.originalSettledAt=Date.now();workPending.delete(original);});
  try{const value=await Promise.race([original,new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout),Math.min(15000,remaining));})]);row.wrapperResult='FULFILLED';return value;}
  catch(error){row.wrapperResult=error===timeout?'WRAPPER_DEADLINE':'ORIGINAL_REJECTED';throw error;}
  finally{clearTimeout(timer);row.wrapperFinishedAt=Date.now();}
 };
 const checkpoint=(stage,pageOrdinal=0)=>{if(evidence.checkpoints.length<64)evidence.checkpoints.push({stage,pageOrdinal,at:Date.now()});else overflow=true;fs.writeFileSync('/evidence/browser-checkpoints.json',JSON.stringify({checkpoints:evidence.checkpoints,lifecycleEvents:evidence.lifecycleEvents},null,2)+'\n');};
 const add=(list,value,cap=128)=>{if(list.length>=cap){overflow=true;return;}list.push(value);};
 // Preserve public asset identity without userinfo, query, fragment or headers.
 const resource=u=>{try{const x=new URL(u);return {origin:['http://127.0.0.1:3005','https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(x.origin)?x.origin:'OTHER_ORIGIN',path:/^\/[A-Za-z0-9_./-]{0,511}$/.test(x.pathname)?x.pathname:'OMITTED'};}catch{return {origin:'UNPARSEABLE',path:'OMITTED'};}};
 const attachPage=(page,pageOrdinal)=>{
  page.on('crash',()=>{add(evidence.lifecycleEvents,{kind:'PAGE_CRASH',pageOrdinal,at:Date.now()},16);checkpoint('PAGE_CRASH',pageOrdinal);});
  page.on('requestfinished',r=>add(evidence.finishedResources,{pageOrdinal,...resource(r.url()),kind:r.resourceType()},256));
  checkpoint('PAGE_CREATED',pageOrdinal);
  page.on('domcontentloaded',()=>checkpoint('ACTUAL_DOMCONTENTLOADED',pageOrdinal));
  page.on('load',()=>checkpoint('ACTUAL_LOAD',pageOrdinal));
  const sourceStages=new Set(['BOOTSTRAP_BODY_ENTERED','HOST_INSTALLED','ENTRY_IMPORT_CALLED','ENTRY_IMPORT_FULFILLED','ENTRY_IMPORT_REJECTED']);
  page.on('console',m=>{const text=m.text();const prefix='SILHOUETTE_BROWSER_BOUNDARY:';if(text.startsWith(prefix)&&sourceStages.has(text.slice(prefix.length)))checkpoint(text.slice(prefix.length),pageOrdinal);});
  page.on('console',m=>add(evidence.console,{pageOrdinal,kind:['error','warning','info','log','debug','warn'].includes(m.type())?m.type():'OTHER'},100));
  page.on('pageerror',()=>add(evidence.pageErrors,{pageOrdinal,kind:'ACTUAL_PAGE_ERROR'}));
  page.on('requestfailed',r=>add(evidence.failedResources,{pageOrdinal,...resource(r.url()),kind:r.resourceType(),kindOfFailure:'ACTUAL_REQUEST_FAILED'}));
  page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/v1/'))add(evidence.requests,{pageOrdinal,path:resource(r.url()).path,method:r.method()},256);});
  page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/v1/'))add(evidence.responses,{pageOrdinal,path:resource(r.url()).path,status:r.status()},256);else if(u.origin==='http://127.0.0.1:3005')add(evidence.localResources,{pageOrdinal,...resource(r.url()),status:r.status(),kind:r.request().resourceType()});});
 };
 const captureActual=async(context,page)=>{
   let captureStage='CDP_SESSION';
   try{
    // CDP captures ACTUAL viewport pixels, without Playwright's font/layout
    // readiness waits. No DOM/CSS edits, synthetic content or auth bypass.
    const cdp=await bounded(context.newCDPSession(page),2000,'CDP_SESSION_TIMEOUT');
    try{captureStage='CDP_SCREENSHOT';checkpoint('ACTUAL_SCREENSHOT_ATTEMPT_BEGIN');const shot=await bounded(cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true}),5000,'CDP_SCREENSHOT_TIMEOUT');const bytes=Buffer.from(shot.data,'base64');if(bytes.length>8*1024**2)throw Error('ACTUAL_SCREENSHOT_CAP');fs.writeFileSync('/evidence/actual-ui.png',bytes);evidence.screenshot={status:'PRIVATE_VIEWPORT_PIXELS_NOT_EXPORTED',bytes:bytes.length,noFunctionalUiPassImplied:true,exported:false,visualVerification:'NOT_INSPECTED_PRIVATE_ONLY'};}finally{try{await bounded(cdp.detach(),1000,'CDP_DETACH_TIMEOUT');}catch(e){evidence.cleanupErrors.push({kind:'CDP_DETACH_FAILURE'});if(!primary)primary=e;}}
   }catch(e){evidence.screenshot={status:'CAPTURE_FAILED',kind:'ACTUAL_CAPTURE_FAILURE',stage:captureStage};if(!primary)primary=e;}
   try{evidence.layout=await bounded(page.evaluate(()=>{const describe=e=>{if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,children:e.childElementCount,display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height};};return {scriptCount:document.scripts.length,stylesheetCount:document.querySelectorAll('link[rel="stylesheet"]').length,readyState:document.readyState,body:describe(document.body),root:describe(document.getElementById('root')),scripts:[...document.scripts].slice(0,128).map(x=>({src:x.getAttribute('src')?.split(/[?#]/)[0]||null,type:x.type})),stylesheets:[...document.querySelectorAll('link[rel="stylesheet"]')].slice(0,128).map(x=>{const href=x.getAttribute('href');if(!href)return null;try{const u=new URL(href,location.origin);if(u.origin===location.origin)return{origin:'LOCAL',path:u.pathname};if(u.origin==='https://fonts.googleapis.com'&&u.pathname==='/css2')return{origin:'GOOGLE_FONTS',path:'/css2'};if(u.origin==='https://cdn.jsdelivr.net'&&u.pathname==='/npm/xterm@5.3.0/css/xterm.css')return{origin:'JSDELIVR_XTERM',path:'/npm/xterm@5.3.0/css/xterm.css'};return{origin:'OTHER_OMITTED',path:'OMITTED'};}catch{return{origin:'OTHER_OMITTED',path:'OMITTED'};}})};}),2000,'LAYOUT_TIMEOUT');if(evidence.layout.scriptCount>128||evidence.layout.stylesheetCount>128){evidence.layoutMetadataOverflow=true;if(!primary)primary=Error('LAYOUT_METADATA_CAP');}}catch(e){evidence.layoutFailure={kind:'ACTUAL_LAYOUT_FAILURE'};if(!primary)primary=e;}
 };
 try{
  browser=await work(()=>chromium.launch({executablePath:'/browser-assets/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check']}),'BROWSER_LAUNCH');
  browser.on('disconnected',()=>{add(evidence.lifecycleEvents,{kind:'BROWSER_DISCONNECTED',at:Date.now()},16);checkpoint('BROWSER_DISCONNECTED');});
  checkpoint('BROWSER_LAUNCHED');
  context=await work(()=>browser.newContext({viewport:{width:1280,height:900}}),'FIRST_CONTEXT_CREATE');page=await work(()=>context.newPage(),'FIRST_PAGE_CREATE');
  attachPage(page,1);
  const end=Math.min(workEnd,Date.now()+45000);let ready=false;
  while(Date.now()<end){try{const r=await work(()=>context.request.get('http://127.0.0.1:3005/v1/identity/setup-status',{timeout:1500}),'BACKEND_READINESS_REQUEST');if(r.ok()){evidence.setupRequired=(await work(()=>r.json(),'BACKEND_READINESS_JSON')).needsSetup;ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  checkpoint('READINESS_REQUEST_FINISHED');
  if(!ready)throw Error('ACTUAL_BACKEND_NOT_READY');
  const navigation=await work(()=>page.goto('http://127.0.0.1:3005/',{waitUntil:'domcontentloaded',timeout:15000}),'FIRST_NAVIGATION');evidence.navigation={status:navigation?.status(),...resource(page.url())};
  checkpoint('BEFORE_BODY_WAIT');
  const bodyWait=work(()=>page.locator('body').waitFor({state:'visible',timeout:Math.min(30000,workEnd-Date.now())}),'FIRST_BODY_VISIBLE');
  // Observe the same original, never replace it or change its timeout.
  const bodyOperation=evidence.operations[evidence.operations.length-1];
  bodyProbe=require('/driver/browser-boundary-probe.cjs')(context,page,evidence,workEnd,()=>bodyOperation.originalResult!=='PENDING');
  await bodyWait;
  await bodyProbe.finish();
  if(evidence.preCredentialBoundary.cleanupStatus!=='CLEAN'||evidence.preCredentialBoundary.pendingOriginalCount||evidence.preCredentialBoundary.pendingDisposalCount||!['NOT_NEEDED_ORIGINAL_SETTLED','FIXED_RESULTS_ONLY_NOT_CAUSE'].includes(evidence.preCredentialBoundary.status))throw Error('BOUNDARY_DIAGNOSTIC_INCOMPLETE');
  evidence.bodyVisibleObserved=true;await work(()=>page.title(),'FIRST_TITLE');evidence.titleObserved=true;
  if(evidence.setupRequired!==true)throw Error('EXPECTED_FRESH_STORE');
  evidence.credentialFixtureEntered=true;
  await require('/driver/functional-auth.cjs')(browser,context,page,evidence,workEnd,async(ctx,p)=>{await captureActual(ctx,p);if(evidence.screenshot?.status!=='PRIVATE_VIEWPORT_PIXELS_NOT_EXPORTED')throw Error('AUTHENTICATED_CAPTURE_FAILED');},attachPage);
  evidence.limitation='Narrow genuine local setup/login/session SQLite only. Chat, AI, learning and full security NOT PROVEN. Credentialed PNG retained privately, not exported or pixel-inspected. Visual correctness/privacy remain unverified; narrow authentication checks do not establish full functional success.';
 }catch(e){primary=e;checkpoint('ORIGINAL_BROWSER_FAILURE');evidence.primaryFailure={kind:'ACTUAL_BROWSER_OR_FUNCTIONAL_FAILURE'};}
 finally{
  workAborted=true;
  if(bodyProbe)await bodyProbe.finish();
  if(workPending.size){evidence.pendingWorkAtCleanup=workPending.size;if(!primary)primary=Error('LATE_BROWSER_WORK_PENDING');}
  // No first-context fallback. Capture failure preserves its original state.
  if(!evidence.screenshot)evidence.screenshot={status:'NO_VERIFIED_SECOND_PAGE_PRIVATE_PIXELS'};
  // Persist genuine pixels/metadata before a potentially stalled close.
  fs.writeFileSync('/evidence/browser.json',JSON.stringify(evidence,null,2)+'\n');
  checkpoint('BEFORE_BROWSER_CLOSE');
  if(browser)try{await bounded(browser.close(),5000,'BROWSER_CLOSE_TIMEOUT');}catch(e){evidence.cleanupErrors.push({kind:'BROWSER_CLOSE_FAILURE'});if(!primary)primary=e;}
  if(overflow){evidence.captureOverflow=true;if(!primary)primary=Error('BROWSER_CAPTURE_CAP');}
  if(primary&&evidence.functional){evidence.functional.status='FAILED';if(evidence.functional.failedStage==='NONE')evidence.functional.failedStage='DRIVER_CLEANUP';evidence.authenticated=false;}
  fs.writeFileSync('/evidence/browser.json',JSON.stringify(evidence,null,2)+'\n');
  if(primary)fs.writeFileSync('/evidence/browser-failure.json',JSON.stringify({kind:'ACTUAL_BROWSER_OR_FUNCTIONAL_FAILURE'})+'\n');
 }
 if(primary)throw primary;
})().catch(()=>{process.exitCode=1;});
