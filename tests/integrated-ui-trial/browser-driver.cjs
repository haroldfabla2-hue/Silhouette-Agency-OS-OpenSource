'use strict';
// Real local browser only. Failure evidence is owed even without a visible body.
const fs=require('node:fs');
const {chromium}=require('/app/node_modules/playwright');
(async()=>{
 let browser,context,page,primary;let overflow=false;
 const evidence={console:[],pageErrors:[],failedResources:[],localResources:[],requests:[],responses:[],setupRequired:null,authenticated:false,chatStorageVerified:false,lifecycleEvents:[],finishedResources:[],checkpoints:[],screenshot:null,bodyVisibleObserved:false,cleanupErrors:[]};
 const bounded=async(promise,ms,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}};
 const checkpoint=stage=>{if(evidence.checkpoints.length<16)evidence.checkpoints.push({stage,at:Date.now()});else overflow=true;fs.writeFileSync('/evidence/browser-checkpoints.json',JSON.stringify({checkpoints:evidence.checkpoints,lifecycleEvents:evidence.lifecycleEvents},null,2)+'\n');};
 const add=(list,value,cap=128)=>{if(list.length>=cap){overflow=true;return;}list.push(value);};
 // Preserve public asset identity without userinfo, query, fragment or headers.
 const resource=u=>{try{const x=new URL(u);return {origin:x.origin,path:x.pathname.slice(0,512)};}catch{return {origin:'UNPARSEABLE',path:'OMITTED'};}};
 try{
  browser=await chromium.launch({executablePath:'/browser-assets/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check']});
  browser.on('disconnected',()=>{add(evidence.lifecycleEvents,{kind:'BROWSER_DISCONNECTED',at:Date.now()},16);checkpoint('BROWSER_DISCONNECTED');});
  checkpoint('BROWSER_LAUNCHED');
  context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();
  page.on('crash',()=>{add(evidence.lifecycleEvents,{kind:'PAGE_CRASH',at:Date.now()},16);checkpoint('PAGE_CRASH');});
  page.on('requestfinished',r=>add(evidence.finishedResources,{...resource(r.url()),kind:r.resourceType()},256));
  checkpoint('PAGE_CREATED');
  page.on('domcontentloaded',()=>checkpoint('ACTUAL_DOMCONTENTLOADED'));
  page.on('load',()=>checkpoint('ACTUAL_LOAD'));
  const sourceStages=new Set(['BOOTSTRAP_BODY_ENTERED','HOST_INSTALLED','ENTRY_IMPORT_CALLED','ENTRY_IMPORT_FULFILLED','ENTRY_IMPORT_REJECTED']);
  page.on('console',m=>{const text=m.text();const prefix='SILHOUETTE_BROWSER_BOUNDARY:';if(text.startsWith(prefix)&&sourceStages.has(text.slice(prefix.length)))checkpoint(text.slice(prefix.length));});
  page.on('console',m=>add(evidence.console,{type:m.type(),text:m.text().slice(0,1000)},100));
  page.on('pageerror',e=>add(evidence.pageErrors,{type:e.name,message:e.message.slice(0,2000)}));
  page.on('requestfailed',r=>add(evidence.failedResources,{...resource(r.url()),kind:r.resourceType(),error:(r.failure()?.errorText||'UNKNOWN').slice(0,256)}));
  page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/v1/'))add(evidence.requests,{path:u.pathname,method:r.method()},256);});
  page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/v1/'))add(evidence.responses,{path:u.pathname,status:r.status()},256);else if(u.origin==='http://127.0.0.1:3005')add(evidence.localResources,{...resource(r.url()),status:r.status(),kind:r.request().resourceType()});});
  const end=Date.now()+45000;let ready=false;
  while(Date.now()<end){try{const r=await context.request.get('http://127.0.0.1:3005/v1/identity/setup-status',{timeout:1500});if(r.ok()){evidence.setupRequired=(await r.json()).needsSetup;ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  checkpoint('READINESS_REQUEST_FINISHED');
  if(!ready)throw Error('ACTUAL_BACKEND_NOT_READY');
  const navigation=await page.goto('http://127.0.0.1:3005/',{waitUntil:'domcontentloaded',timeout:15000});evidence.navigation={status:navigation?.status(),...resource(page.url())};
  checkpoint('BEFORE_BODY_WAIT');
  await page.locator('body').waitFor({state:'visible',timeout:30000});
  evidence.bodyVisibleObserved=true;evidence.title=await bounded(page.title(),2000,'TITLE_TIMEOUT');
  evidence.limitation=evidence.setupRequired?'Fresh store requires setup. Authenticated chat/API/SQLite correlation NOT tested.':'Unexpected identity state requires review; no chat request made.';
 }catch(e){primary=e;checkpoint('ORIGINAL_BROWSER_FAILURE');evidence.primaryFailure={type:e.name,message:e.message.slice(0,3000)};}
 finally{
  // Separate independent diagnostics: failure to read metadata never skips PNG.
  if(page&&!page.isClosed()){

   try{
    // CDP captures ACTUAL viewport pixels, without Playwright's font/layout
    // readiness waits. No DOM/CSS edits, synthetic content or auth bypass.
    const cdp=await bounded(context.newCDPSession(page),2000,'CDP_SESSION_TIMEOUT');
    try{checkpoint('ACTUAL_SCREENSHOT_ATTEMPT_BEGIN');const shot=await bounded(cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true}),5000,'CDP_SCREENSHOT_TIMEOUT');const bytes=Buffer.from(shot.data,'base64');if(bytes.length>8*1024**2)throw Error('ACTUAL_SCREENSHOT_CAP');fs.writeFileSync('/evidence/actual-ui.png',bytes);evidence.screenshot={status:'ACTUAL_VIEWPORT_PIXELS',bytes:bytes.length,noFunctionalUiPassImplied:true};}finally{try{await bounded(cdp.detach(),1000,'CDP_DETACH_TIMEOUT');}catch(e){evidence.cleanupErrors.push({type:e.name,message:e.message.slice(0,500)});if(!primary)primary=e;}}
   }catch(e){evidence.screenshot={status:'CAPTURE_FAILED',type:e.name,message:e.message.slice(0,1000)};if(!primary)primary=e;}
   try{evidence.layout=await bounded(page.evaluate(()=>{const describe=e=>{if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,children:e.childElementCount,display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height};};return {scriptCount:document.scripts.length,stylesheetCount:document.querySelectorAll('link[rel="stylesheet"]').length,readyState:document.readyState,body:describe(document.body),root:describe(document.getElementById('root')),scripts:[...document.scripts].slice(0,128).map(x=>({src:x.getAttribute('src')?.split(/[?#]/)[0]||null,type:x.type})),stylesheets:[...document.querySelectorAll('link[rel="stylesheet"]')].slice(0,128).map(x=>x.getAttribute('href')?.split(/[?#]/)[0]||null)};}),2000,'LAYOUT_TIMEOUT');if(evidence.layout.scriptCount>128||evidence.layout.stylesheetCount>128){evidence.layoutMetadataOverflow=true;if(!primary)primary=Error('LAYOUT_METADATA_CAP');}}catch(e){evidence.layoutFailure={type:e.name,message:e.message.slice(0,500)};if(!primary)primary=e;}
  }else{evidence.screenshot={status:'NO_LIVE_PAGE_NO_PIXELS'};if(!primary)primary=Error('NO_LIVE_PAGE_NO_PIXELS');}
  // Persist genuine pixels/metadata before a potentially stalled close.
  fs.writeFileSync('/evidence/browser.json',JSON.stringify(evidence,null,2)+'\n');
  checkpoint('BEFORE_BROWSER_CLOSE');
  if(browser)try{await bounded(browser.close(),5000,'BROWSER_CLOSE_TIMEOUT');}catch(e){evidence.cleanupErrors.push({type:e.name,message:e.message.slice(0,1000)});if(!primary)primary=e;}
  if(overflow){evidence.captureOverflow=true;if(!primary)primary=Error('BROWSER_CAPTURE_CAP');}
  fs.writeFileSync('/evidence/browser.json',JSON.stringify(evidence,null,2)+'\n');
  if(primary)fs.writeFileSync('/evidence/browser-failure.json',JSON.stringify({type:primary.name,message:primary.message.slice(0,3000)})+'\n');
 }
 if(primary)throw primary;
})().catch(()=>{process.exitCode=1;});
