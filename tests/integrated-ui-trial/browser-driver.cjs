'use strict';
// REVIEW ONLY: real local browser; no intercept/fulfill/mock data and no inference.
const fs=require('node:fs');
const {chromium}=require('/app/node_modules/playwright');
(async()=>{
 let requestOverflow=0,responseOverflow=0;const evidence={console:[],requests:[],responses:[],setupRequired:null,authenticated:false,chatStorageVerified:false};
 const browser=await chromium.launch({executablePath:'/browser-assets/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check']});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();
  page.on('console',m=>{if(evidence.console.length<100)evidence.console.push({type:m.type(),text:m.text().slice(0,1000)})});
  page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/v1/'))(evidence.requests.length<256?evidence.requests.push({path:u.pathname,method:r.method()}):requestOverflow++)});
  page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/v1/'))(evidence.responses.length<256?evidence.responses.push({path:u.pathname,status:r.status()}):responseOverflow++)});
  // Readiness depends on actual HTTP, not staged/delayed render.
  const end=Date.now()+45000;let ready=false;
  while(Date.now()<end){try{const r=await context.request.get('http://127.0.0.1:3005/v1/identity/setup-status',{timeout:1500});if(r.ok()){evidence.setupRequired=(await r.json()).needsSetup;ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!ready)throw Error('ACTUAL_BACKEND_NOT_READY');
  await page.goto('http://127.0.0.1:3005/',{waitUntil:'domcontentloaded',timeout:15000});
  await page.locator('body').waitFor({state:'visible'});
  await page.screenshot({path:'/evidence/actual-ui.png',fullPage:true});
  if(requestOverflow||responseOverflow)throw Error('BROWSER_NETWORK_CAPTURE_CAP');evidence.title=await page.title();evidence.url=page.url();
  // Stop at real setup/auth UI. No invented test password, synthetic identity,
  // header principal bypass, direct SQLite seed or mock chat completion.
  evidence.limitation=evidence.setupRequired?'Fresh store requires setup. Authenticated chat/API/SQLite correlation NOT tested.':'Existing unexpected identity state requires review; no chat request made.';
 }finally{await browser.close();fs.writeFileSync('/evidence/browser.json',JSON.stringify(evidence,null,2)+'\n');}
})().catch(e=>{fs.writeFileSync('/evidence/browser-failure.json',JSON.stringify({type:e.name,message:e.message})+'\n');process.exitCode=1;});
