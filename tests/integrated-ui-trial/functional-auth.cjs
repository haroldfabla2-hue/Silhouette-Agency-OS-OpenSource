'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const Database=require('/app/node_modules/better-sqlite3');
const assert=require('node:assert/strict');
module.exports=async function functionalAuth(browser,context,page,evidence,workEnd,capture,attachPage){
 const f=evidence.functional={version:2,status:'NOT_COMPLETE',stage:'INITIAL',failedStage:'NONE',freshSetup:false,actualDiagnostics:false,telemetryOff:false,evolutionOff:false,noGitEffectsObserved:false,setupActual:false,setupSessionStored:false,setupSqliteCorrelated:false,consentPersistedOff:false,negativeUnauthorized:false,negativeWrongPassword:false,negativeInvalidSession:false,negativeMasterOnly:false,cookieOnly:false,headerPrecedence:false,postSetupDiagnosticsRejected:false,realBearerPreserved:false,secondContextLogin:false,loginSessionStored:false,loginSqliteCorrelated:false,protectedSessionRequest:false,reloadAuthenticated:false,reloadUnchangedSqlite:false,revokedSessionRejected:false,twoIdentityIsolation:'NOT_EXERCISED',expiredSession:'NOT_EXERCISED',storeUnavailable:'NOT_EXERCISED',global:'INCOMPLETE'};
 let observer,second,anonymous;let failed=false;const secrets=[];
 const secretFile='/evidence/.export-deny-browser-secrets.json';
 const fd=fs.openSync(secretFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 const denyIdentity=fs.fstatSync(fd);assert.ok(denyIdentity.isFile()&&(denyIdentity.mode&0o777)===0o600);
 const retain=value=>{
  assert.equal(typeof value,'string');assert.match(value,/^[A-Za-z0-9_-]{16,128}$/);
  if(!secrets.includes(value)){
   assert.ok(secrets.length<8);secrets.push(value);
   const bytes=Buffer.from(JSON.stringify(secrets));assert.ok(bytes.length<=2048);
   const st=fs.fstatSync(fd),path=fs.lstatSync(secretFile);assert.ok(path.isFile()&&!path.isSymbolicLink()&&st.ino===denyIdentity.ino&&st.dev===denyIdentity.dev&&path.ino===st.ino&&path.dev===st.dev&&(path.mode&0o777)===0o600);
   fs.ftruncateSync(fd,0);assert.equal(fs.writeSync(fd,bytes,0,bytes.length,0),bytes.length);fs.fsyncSync(fd);
  }
 };
 const time=()=>{const left=workEnd-Date.now();assert.ok(left>0,'FUNCTIONAL_BUDGET');return Math.min(left,15000);};
 const tracked=new Set();
 const within=async(fn,cap=15000)=>{
  const ms=Math.min(time(),cap);let timer;
  const original=Promise.resolve().then(fn);tracked.add(original);
  void original.then(value=>{tracked.delete(original);if(f.status==='FAILED'&&value&&typeof value.close==='function'){let timer;void Promise.race([Promise.resolve().then(()=>value.close()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('LATE_FIXTURE_SCOPE_CLOSE')),1000);})]).then(()=>clearTimeout(timer),()=>{clearTimeout(timer);process.exitCode=1;});}},()=>tracked.delete(original));
  try{return await Promise.race([original,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FUNCTIONAL_OPERATION_BUDGET')),ms);})]);}finally{clearTimeout(timer);}
 };
 const observedWait=promise=>{const observed=promise.then(value=>({ok:true,value}),()=>({ok:false}));tracked.add(observed);void observed.then(()=>tracked.delete(observed));return async()=>{const result=await within(()=>observed);assert.ok(result.ok);return result.value;};};
 const stage=s=>{f.stage=s;time();};
 const email='isolated-auth-fixture@example.invalid',name='Isolated Auth Fixture';
 const password=crypto.randomBytes(32).toString('base64url');retain(password);
 const origin='http://127.0.0.1:3005';
 const sessionFrom=async p=>{const session=await within(()=>p.evaluate(()=>localStorage.getItem('silhouette_session_id')));retain(session);return session;};
 const noGit=()=>{
  assert.equal(fs.existsSync('/app/.env.local'),false);assert.equal(fs.existsSync('/app/.git'),false);
  assert.equal(fs.existsSync('/home/test/.gitconfig'),false);assert.equal(fs.existsSync('/home/test/.config/git'),false);
 };
 const snapshot=session=>{
  time();const row=observer.prepare('SELECT u.id,u.email,u.name,u.role,s.id AS sid,s.expires_at,d.id AS did,d.trusted,d.fingerprint FROM users u JOIN sessions s ON s.user_id=u.id JOIN devices d ON d.id=s.device_id AND d.user_id=u.id WHERE s.id=?').get(session);
  assert.ok(row&&row.email===email&&row.name===name&&row.role==='CREATOR'&&row.sid===session&&row.expires_at>Date.now()&&row.trusted===1);
  assert.equal(observer.prepare('SELECT count(*) AS n FROM users').get().n,1);
  const count=observer.prepare('SELECT count(*) AS n FROM sessions').get().n;
  time();return {row,count}; // Private only, never exported or hashed.
 };
 const api=async(ctx,path,options={})=>within(()=>ctx.request.get(origin+path,{...options,timeout:time()}));
 const actualSession=async(ctx,sid,extra={})=>{
  const r=await api(ctx,'/v1/identity/current-session',{headers:{'x-session-id':sid,...extra}});assert.equal(r.status(),200);
  const body=await within(()=>r.json());assert.deepEqual(Object.keys(body).sort(),['success','user']);assert.equal(body.success,true);
  assert.deepEqual(Object.keys(body.user).sort(),['email','googleLinked','id','name','role']);assert.equal(body.user.email,email);assert.equal(body.user.name,name);assert.equal(body.user.role,'CREATOR');assert.equal(body.user.googleLinked,false);
 };
 try{
  assert.equal(process.env.SILHOUETTE_PROVIDERS,'off');assert.equal(process.env.SILHOUETTE_INFERENCE_MODE,'cloud-only');
  assert.equal(process.env.SILHOUETTE_DB_PATH,'/app/db/test.db');noGit();
  stage('FRESH_SETUP_READINESS');
  await within(()=>page.getByRole('heading',{name:'1. Admin Account',exact:true}).waitFor({state:'visible',timeout:time()}));f.freshSetup=true;
  observer=new Database('/app/db/test.db',{readonly:true,fileMustExist:true,timeout:0});assert.equal(observer.prepare('SELECT count(*) AS n FROM users').get().n,0);
  stage('REAL_SETUP_FIELDS');
  await within(()=>page.getByPlaceholder('John Doe',{exact:true}).fill(name,{timeout:time()}));await within(()=>page.getByPlaceholder('admin@silhouette.local',{exact:true}).fill(email,{timeout:time()}));
  const passwords=page.locator('input[type=password]');assert.equal(await within(()=>passwords.count()),2);
  await within(()=>passwords.nth(0).fill(password,{timeout:time()}));await within(()=>passwords.nth(1).fill(password,{timeout:time()}));
  const diag=observedWait(page.waitForResponse(r=>r.url()===origin+'/v1/system/diagnostics'&&r.request().method()==='GET',{timeout:time()}));
  await within(()=>page.getByRole('button',{name:'Continue to Environment Setup',exact:false}).click({timeout:time()}));
  const dr=await diag();assert.equal(dr.status(),200);const data=await within(()=>dr.json());assert.ok(data?.ram?.totalGB>0);f.actualDiagnostics=true;
  await within(()=>page.getByRole('button',{name:'Continue to Privacy & Telemetry',exact:false}).click({timeout:time()}));
  stage('OFF_CHOICES_VERIFIED');
  await within(()=>page.getByRole('heading',{name:'3. Privacy & Telemetry',exact:true}).waitFor({timeout:time()}));
  assert.equal(await within(()=>page.locator('input[type=checkbox]').count()),1);assert.equal(await within(()=>page.locator('input[type=checkbox]').isChecked()),false);f.telemetryOff=true;
  await within(()=>page.getByRole('button',{name:'Continue to Auto-Evolution',exact:false}).click({timeout:time()}));
  await within(()=>page.getByRole('heading',{name:'4. Auto-Evolution API',exact:true}).waitFor({timeout:time()}));
  assert.equal(await within(()=>page.locator('input[type=checkbox]').count()),1);assert.equal(await within(()=>page.locator('input[type=checkbox]').isChecked()),false);
  assert.equal(await within(()=>page.getByPlaceholder('ghp_xxxxxxxxxxxx',{exact:true}).count()),0);f.evolutionOff=true;
  const response=observedWait(page.waitForResponse(r=>r.url()===origin+'/v1/identity/setup'&&r.request().method()==='POST',{timeout:time()}));
  const consent=observedWait(page.waitForResponse(r=>r.url()===origin+'/v1/analytics/consent'&&r.request().method()==='PUT',{timeout:time()}));
  await within(()=>page.getByRole('button',{name:'Initialize & Boot OS',exact:true}).click({timeout:time()}));
  stage('REAL_SETUP_COMMIT');const setup=await response();assert.equal(setup.status(),200);
  const outgoing=setup.request().postDataJSON();assert.deepEqual(Object.keys(outgoing).sort(),['email','name','password']);assert.equal(outgoing.email,email);assert.equal(outgoing.password,password);
  const result=await within(()=>setup.json());assert.equal(result.success,true);assert.equal(result.user.email,email);retain(result.session.id);f.setupActual=true;
  const cr=await consent();assert.equal(cr.status(),200);assert.deepEqual(cr.request().postDataJSON(),{optedIn:false});const cd=await within(()=>cr.json());assert.equal(cd.consent.optedIn,false);
  await within(()=>page.locator('#sidebar-tab-dashboard').waitFor({state:'visible',timeout:time()}));evidence.safeAuthenticatedPixels=true;
  const first=await sessionFrom(page);assert.equal(first,result.session.id);f.setupSessionStored=true;snapshot(first);f.setupSqliteCorrelated=true;
  const opted=observer.prepare('SELECT opted_in FROM analytics_consent WHERE id=1').get();assert.equal(opted?.opted_in,0);f.consentPersistedOff=true;noGit();f.noGitEffectsObserved=true;
  stage('NEGATIVE_AUTH_BOUNDARIES');
  anonymous=await within(()=>browser.newContext());
  for(const path of ['/v1/identity/current-session','/v1/identity/google-status'])assert.equal((await api(anonymous,path)).status(),401);f.negativeUnauthorized=true;
  const invalid=crypto.randomUUID();retain(invalid);
  assert.equal((await api(anonymous,'/v1/identity/current-session',{headers:{'x-session-id':invalid}})).status(),401);f.negativeInvalidSession=true;
  assert.equal((await api(anonymous,'/v1/identity/current-session',{headers:{Authorization:'Bearer '+process.env.SILHOUETTE_API_TOKEN}})).status(),401);f.negativeMasterOnly=true;
  assert.equal((await api(anonymous,'/v1/system/diagnostics')).status(),401);
  for(const token of ['Bearer','Bearer invalid-fixture-token'])assert.ok([401,403].includes((await api(anonymous,'/v1/system/diagnostics',{headers:{Authorization:token}})).status()));f.postSetupDiagnosticsRejected=true;
  assert.equal((await api(anonymous,'/v1/system/diagnostics',{headers:{Authorization:'Bearer '+process.env.SILHOUETTE_API_TOKEN}})).status(),200);f.realBearerPreserved=true;
  const before=snapshot(first);await actualSession(anonymous,first);
  assert.equal((await api(anonymous,'/v1/identity/current-session',{headers:{Cookie:'silhouette_session='+first}})).status(),200);f.cookieOnly=true;
  assert.equal((await api(anonymous,'/v1/identity/current-session',{headers:{Cookie:'silhouette_session='+first,'x-session-id':invalid}})).status(),401);
  await actualSession(anonymous,first,{Cookie:'silhouette_session='+invalid});f.headerPrecedence=true;assert.deepEqual(snapshot(first),before);
  stage('NEW_CONTEXT_REAL_LOGIN');
  second=await within(()=>browser.newContext({viewport:{width:1280,height:900}}));const p=await within(()=>second.newPage());attachPage(p,2);
  await within(()=>p.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:time()}));await within(()=>p.getByRole('button',{name:'Access Neural Core',exact:true}).waitFor({state:'visible',timeout:time()}));
  await within(()=>p.getByPlaceholder('Email Address',{exact:true}).fill(email,{timeout:time()}));await within(()=>p.getByPlaceholder('Password',{exact:true}).fill(password+'-wrong',{timeout:time()}));
  const wrong=observedWait(p.waitForResponse(r=>r.url()===origin+'/v1/identity/login'&&r.request().method()==='POST',{timeout:time()}));
  await within(()=>p.getByRole('button',{name:'Access Neural Core',exact:true}).click({timeout:time()}));assert.equal((await wrong()).status(),401);f.negativeWrongPassword=true;
  await within(()=>p.getByPlaceholder('Password',{exact:true}).fill(password,{timeout:time()}));
  const logged=observedWait(p.waitForResponse(r=>r.url()===origin+'/v1/identity/login'&&r.request().method()==='POST',{timeout:time()}));
  await within(()=>p.getByRole('button',{name:'Access Neural Core',exact:true}).click({timeout:time()}));const lr=await logged();assert.equal(lr.status(),200);
  const login=await within(()=>lr.json());assert.equal(login.success,true);retain(login.session.id);await within(()=>p.locator('#sidebar-tab-dashboard').waitFor({state:'visible',timeout:time()}));f.secondContextLogin=true;
  const sid=await sessionFrom(p);assert.equal(sid,login.session.id);f.loginSessionStored=true;snapshot(sid);f.loginSqliteCorrelated=true;
  stage('PROTECTED_REQUEST_RELOAD');const pre=snapshot(sid);await actualSession(anonymous,sid);f.protectedSessionRequest=true;
  await within(()=>p.reload({waitUntil:'domcontentloaded',timeout:time()}));await within(()=>p.locator('#sidebar-tab-dashboard').waitFor({state:'visible',timeout:time()}));
  assert.equal(await sessionFrom(p),sid);assert.deepEqual(snapshot(sid),pre);f.reloadAuthenticated=true;f.reloadUnchangedSqlite=true;
  await within(()=>capture(second,p));
  stage('REAL_SESSION_REVOCATION');
  const logout=await within(()=>anonymous.request.post(origin+'/v1/identity/logout',{headers:{'x-session-id':sid},timeout:time()}));assert.equal(logout.status(),200);
  assert.equal((await api(anonymous,'/v1/identity/current-session',{headers:{'x-session-id':sid}})).status(),401);assert.equal(observer.prepare('SELECT count(*) AS n FROM sessions WHERE id=?').get(sid).n,0);f.revokedSessionRejected=true;
  noGit();f.stage='NARROW_AUTH_COMPLETE';f.status='COMPLETE_NARROW_AUTH_ONLY';evidence.authenticated=true;
 }catch{failed=true;f.failedStage=f.stage;f.status='FAILED';throw Error('REAL_FUNCTIONAL_AUTH_PATH_FAILED');}
 finally{
  if(observer)observer.close();fs.closeSync(fd);
  // Secondary scopes are all covered by browser.close + outer cgroup too.
  // Observe late work immediately. Failure leaves acceptance FAIL, never rc0.
  for(const ctx of [second,anonymous])if(ctx){let timer;try{await Promise.race([ctx.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FUNCTIONAL_CONTEXT_CLOSE_TIMEOUT')),1000);})]);}catch{f.status='FAILED';f.failedStage='CONTEXT_CLEANUP';failed=true;}finally{clearTimeout(timer);}}
  if(tracked.size){f.status='FAILED';f.failedStage='PENDING_FUNCTIONAL_WORK';failed=true;}
  if(failed&&f.status!=='FAILED')f.status='FAILED';
  if(failed){evidence.authenticated=false;throw Error('REAL_FUNCTIONAL_AUTH_PATH_FAILED');}
 }
};
