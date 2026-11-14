// Real production loop, real timers, real SqliteAdmission. Controlled promises
// are lifecycle work fixtures only: no app/provider response, UI or DB is faked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installPreparationHost } from '/app/services/lifecycle/bootstrapAuthority.ts';
const host = installPreparationHost({scopes:128,active:512,failures:64,resources:256});
const { SystemTelemetryPoll } = await import('/app/services/lifecycle/systemTelemetryPoll.ts');
const { runtimeSqliteAdmission, runSqliteOperation } = await import('/app/services/lifecycle/sqliteAdmission.ts');
const results: {name:string;status:string}[]=[];
const loops: InstanceType<typeof SystemTelemetryPoll>[]=[];
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const refresh=(body:()=>Promise<unknown>)=>()=>runSqliteOperation('finite-original-refresh-fixture',body);
const control=()=>{let resolve!:()=>void;let reject!:(e:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});return{promise,resolve,reject};};
const test=async(name:string,body:()=>Promise<void>)=>{await body();results.push({name,status:'ACTUAL_PRODUCTION_LOOP_PASSED_NOT_PRODUCT_UI_PASS'});};
try {
 await test('idle stop is idempotent and does not start refresh',async()=>{let calls=0;const p=new SystemTelemetryPoll(refresh(async()=>{calls++;}));loops.push(p);const a=p.stop();assert.equal(a,p.stop());await a;p.start();assert.equal(calls,0);});
 await test('active original join blocks until SAME refresh settles; no rearm',async()=>{const d=control();let calls=0,joined=false;const p=new SystemTelemetryPoll(refresh(()=>{calls++;return d.promise;}));loops.push(p);p.start();p.start();assert.equal(calls,1);const a=p.stop();assert.equal(a,p.stop());void a.then(()=>{joined=true;});await delay(15);assert.equal(joined,false);d.resolve();await a;await delay(5100);assert.equal(calls,1);});
 await test('actual repeated timer fires then cancellation stops next timer',async()=>{let calls=0;const p=new SystemTelemetryPoll(refresh(async()=>{calls++;}));loops.push(p);p.start();const end=Date.now()+7000;while(calls<2&&Date.now()<end)await delay(25);assert.equal(calls,2);await p.stop();await delay(5100);assert.equal(calls,2);});
 await test('original refresh rejection identity survives exact join',async()=>{const original=new Error('FINITE_TELEMETRY_FIXTURE_ORIGINAL_FAILURE');const d=control();const p=new SystemTelemetryPoll(refresh(()=>d.promise));loops.push(p);p.start();const join=p.stop();d.reject(original);await assert.rejects(join,e=>e===original);assert.equal(join,p.stop());});
 await test('SQLite seal cancels armed and in-flight producer; joins originals',async()=>{const d=control();let aCalls=0,bCalls=0;const a=new SystemTelemetryPoll(refresh(async()=>{aCalls++;}));const b=new SystemTelemetryPoll(refresh(()=>{bCalls++;return d.promise;}));loops.push(a,b);a.start();b.start();await delay(15);let joined=false;const sealed=runtimeSqliteAdmission().sealAndJoin();void sealed.then(()=>{joined=true;});await delay(15);assert.equal(joined,false);d.resolve();await sealed;await Promise.all([a.stop(),b.stop()]);await delay(5100);assert.equal(aCalls,1);assert.equal(bCalls,1);assert.equal(runtimeSqliteAdmission().snapshot().pendingOriginals,0);});
 await test('new production loop registration after seal is rejected',async()=>{assert.throws(()=>new SystemTelemetryPoll(async()=>{}),/SQLite producer registration sealed/);});
 fs.writeFileSync('/evidence/telemetry-regression.json',JSON.stringify({status:'FINITE_REAL_LOOP_REGRESSIONS_PASSED_NOT_PRODUCT_PASS',realTimers:true,realAdmission:true,actualDatabaseOrControllerIntegration:false,expectedOriginalFailureWasAsserted:true,results},null,2)+'\n');
} catch(original) {
 fs.writeFileSync('/evidence/telemetry-regression.json',JSON.stringify({status:'FAIL',results,error:{type:original instanceof Error?original.name:'UNKNOWN',message:original instanceof Error?original.message:'NON_ERROR'}},null,2)+'\n');throw original;
} finally {
 // Independent original joins attempted even when an assertion fails.
 for(const p of loops)p.sealProducer();
 await Promise.allSettled(loops.map(p=>p.stop()));
 // Do not call host.stop: expected fixture task failure/global unsafe marker
 // cannot be rewritten as a clean product report. No physical DB was opened.
 void host;
}
