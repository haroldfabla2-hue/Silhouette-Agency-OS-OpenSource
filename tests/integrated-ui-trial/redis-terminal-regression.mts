/** SOURCE ONLY, NEVER RUN. Actual production singleton/Host/native timers/local
 * SQLite. No replaced methods, private calls/edits, fake timers or provider mocks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHook } from 'node:async_hooks';
import { createHash } from 'node:crypto';
const MODES=['natural-expiry','pending-terminal','fired-terminal','inflight-terminal','release-reacquire-terminal','multikey-guard','postseal-idempotency','open-survivor'] as const;
const mode=process.argv[2] as typeof MODES[number];
assert.ok(MODES.includes(mode));
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.SILHOUETTE_PROVIDERS,'off');
assert.equal(process.env.SILHOUETTE_INFERENCE_MODE,'cloud-only');
assert.equal(process.env.SILHOUETTE_FINITE_REDIS,'real-terminal-expiry-v1');
const receiptPath=process.env.SILHOUETTE_FINITE_REDIS_RECEIPT;
assert.equal(receiptPath,`/evidence/redis-mode-${mode}.json`);
// Hooks installed BEFORE every production import. Weak resource→id avoids
// retaining unrelated native resources. No async logging inside hooks.
const ids=new WeakMap<object,number>();
const tracked=new Set<number>(),destroyed=new Set<number>();
let hookOverflow=false;
const hook=createHook({
 init(id,type,_trigger,resource){if(type==='Timeout'&&resource&&typeof resource==='object')ids.set(resource,id);},
 destroy(id){if(tracked.has(id)){if(destroyed.size>=32)hookOverflow=true;else destroyed.add(id);}},
});
hook.enable();
const root=fs.mkdtempSync(path.join(os.tmpdir(),'silhouette-redis-terminal-'));
process.chdir(root);
Object.assign(process.env,{SILHOUETTE_DB_PATH:path.join(root,'main.sqlite'),SILHOUETTE_TOOLS_DB_PATH:path.join(root,'tools.sqlite'),WORKSPACE_ROOT:path.join(root,'workspace'),PROPOSAL_OWNER_DIR:root,INGRESS_REPLAY_DIR:root,CONFIRMATION_GATE_DIR:root,REDIS_HOST:'127.0.0.1',REDIS_PORT:'6499'});
delete process.env.REDIS_URL;
const {installPreparationHost}=await import('/app/services/lifecycle/bootstrapAuthority.ts');
const {AdmissionClosed}=await import('/app/services/lifecycle/host.ts');
const host=installPreparationHost({scopes:128,active:512,failures:64,resources:256});
type Entry={reservation:{id:number};timer:object|undefined;state:'PENDING'|'FIRED'|'CANCELLED';cancellationError?:Error};
type View={memoryLockExpiries:Set<Entry>;lockAcquisitionBodies:Set<Promise<boolean>>;mockStore:Map<string,string>};
const ownValue=(object:object,key:string)=>{
 const d=Object.getOwnPropertyDescriptor(object,key);
 assert.ok(d&&Object.hasOwn(d,'value')&&!d.get&&!d.set,'FIXTURE_READONLY_SHAPE');return d.value;
};
let service:Awaited<typeof import('/app/services/redisClient.ts')>['redisClient']|undefined;
let cancellationType:typeof import('/app/services/redisClient.ts')['RedisMemoryLockExpiryTerminalCancelled']|undefined;
let view:View|undefined,bodyOriginal:Promise<boolean>|undefined;
let report:Awaited<ReturnType<typeof host.stop>>|undefined;
let primary:unknown;
const diagnostic={stage:'PRECONDITION_NOT_REACHED',failedStage:'NONE',predicate:'NONE',failedPredicate:'NONE',errorKind:'NOT_OBSERVED',migrationSource:'NOT_OBSERVED',migrationCount:0,incidentsTable:'NOT_OBSERVED',migration004:'NOT_OBSERVED'};
const at=(stage:string,predicate:string)=>{diagnostic.stage=stage;diagnostic.predicate=predicate;};
const recordFailure=(original:unknown)=>{
 if(diagnostic.errorKind!=='NOT_OBSERVED')return;
 diagnostic.failedStage=diagnostic.stage;diagnostic.failedPredicate=diagnostic.predicate;
 if(original&&typeof original==='object'){
  const code=Object.getOwnPropertyDescriptor(original,'code');
  diagnostic.errorKind=code&&'value'in code&&code.value==='SQLITE_ERROR'?'SQLITE_ERROR':original instanceof assert.AssertionError?'ASSERTION_ERROR':original instanceof Error?'OTHER_ERROR':'NON_ERROR_OR_UNKNOWN';
 }else diagnostic.errorKind='NON_ERROR_OR_UNKNOWN';
};
const scenarioNames=['NATURAL_EXPIRY_AND_HELD_GUARD','PUBLIC_DISCONNECT_NOT_TERMINAL','FIRED_BEFORE_TERMINAL','ACQUISITION_PENDING_AT_SEAL','TWO_GENERATIONS_CANCEL_WITHOUT_UNLOCK','MULTIKEY_AND_UNSELECTED_GUARD','PENDING_BEFORE_POSTSEAL_ASSERTION','OLD_EXPIRY_MUST_NOT_DELETE_NEW_LOCK'];
const results:{name:string;status:'EXERCISED_PASSED'|'EXERCISED_FAILED'|'NOT_REACHED'|'NOTEXERCISED'|'NOTRUN'}[]=[
 {name:scenarioNames[MODES.indexOf(mode)],status:'NOT_REACHED'},
 {name:'ACTUAL_TERMINAL_DISPOSITION_AND_PHYSICAL_CANCEL',status:'NOT_REACHED'},
 {name:'QUEUED_NOT_FIRED_RACE',status:'NOTEXERCISED'},
 {name:'NATIVE_SETUP_OR_CANCELLATION_FAILURE',status:'NOTEXERCISED'},
 {name:'ACTUAL_REDIS_NX_PX',status:'NOTRUN'},
];
const setResult=(name:string,status:typeof results[number]['status'])=>{const row=results.find(r=>r.name===name);assert.ok(row);row.status=status;};
const captured:Entry[]=[],observedCancelled:Entry[]=[],observedFired:Entry[]=[];
const cleanup:string[]=[];
let survivor:'NOT_REACHED'|'SURVIVES'|'DELETED'= 'NOT_REACHED';
let sameBodyObserved=false,postSealRejected=false,hostSealedEarly=false;
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const until=async(predicate:()=>boolean,ms:number)=>{const end=performance.now()+ms;while(!predicate()&&performance.now()<end)await delay(2);assert.ok(predicate(),'FIXTURE_OBSERVATION_DEADLINE');};
const shape=()=>{
 at('READONLY_SHAPE','OWN_FIELDS_AND_CAPS');
 assert.ok(service);
 const es=ownValue(service,'memoryLockExpiries'),bs=ownValue(service,'lockAcquisitionBodies'),store=ownValue(service,'mockStore');
 assert.ok(es instanceof Set&&bs instanceof Set&&store instanceof Map,'FIXTURE_READONLY_COLLECTION_SHAPE');
 assert.equal(Object.getPrototypeOf(es),Set.prototype);assert.equal(Object.getPrototypeOf(bs),Set.prototype);assert.equal(Object.getPrototypeOf(store),Map.prototype);
 assert.ok(es.size<=512&&bs.size<=512&&store.size<=10000,'FIXTURE_READONLY_CAP');
 for(const e of es){
  assert.equal(Object.getPrototypeOf(e),Object.prototype);
  const keys=Object.keys(e);assert.ok(keys.length>=3&&keys.length<=4&&keys.every(k=>['reservation','timer','state','cancellationError'].includes(k)));
  assert.ok(['reservation','timer','state'].every(k=>keys.includes(k)));
  for(const k of keys)ownValue(e,k);
  const reservation=ownValue(e,'reservation');assert.equal(Object.getPrototypeOf(reservation),Object.prototype);
  assert.deepEqual(Object.keys(reservation),['id']);assert.ok(Number.isSafeInteger(reservation.id)&&reservation.id>0);
  assert.ok(['PENDING','FIRED','CANCELLED'].includes(ownValue(e,'state')));
 }
 return {memoryLockExpiries:es,lockAcquisitionBodies:bs,mockStore:store} as View;
};
const capture=()=>{
 view=shape();
 for(const e of view.memoryLockExpiries){
  if(captured.includes(e))continue;
  assert.ok(captured.length<16&&e.state==='PENDING'&&typeof e.timer==='object'&&e.timer!==null);
  at('NATIVE_TIMER_CAPTURE','EXACT_TIMEOUT_RESOURCE_ID');
  const id=ids.get(e.timer);assert.ok(id!==undefined,'EXACT_NATIVE_TIMEOUT_NOT_OBSERVED');
  assert.ok(tracked.size<32);tracked.add(id);captured.push(e);
 }
 return captured;
};
const acquire=async(key:string,ttl:number)=>{
 assert.ok(service);
 at('ACQUIRE_BODY','PUBLIC_ORIGINAL_PROMISE');
 const original=service.acquireLock(key,ttl);assert.ok(original instanceof Promise);
 view=shape();assert.ok(view.lockAcquisitionBodies.has(original),'PUBLIC_SAME_BODY_NOT_TRACKED');sameBodyObserved=true;
 at('ACQUIRE_BODY','REAL_ACQUISITION_TRUE');
 assert.equal(await original,true);capture();
};
const mark=async(name:string,body:()=>Promise<void>)=>{try{await body();setResult(name,'EXERCISED_PASSED');}catch(error){recordFailure(error);setResult(name,'EXERCISED_FAILED');throw error;}};
const cancellationCheck=async()=>{
 at('TERMINAL_ASSERTIONS','HOST_AND_CANCELLATION_TYPE');
 assert.ok(report&&view&&cancellationType);
 assert.equal(report.state,'INCOMPLETE');
 for(const e of captured){
  const id=ids.get(e.timer!);assert.ok(id!==undefined);
  if(e.state==='FIRED'){observedFired.push(e);assert.equal(e.cancellationError,undefined);continue;}
  at('TERMINAL_ASSERTIONS','SELECTED_SAME_ORIGINAL_ERROR');
  assert.equal(e.state,'CANCELLED');assert.ok(e.cancellationError instanceof cancellationType);
  assert.equal(report.failures.filter(f=>f.original===e.cancellationError).length,1,'SAME_CANCELLATION_ERROR_NOT_RETAINED_ONCE');
  at('TERMINAL_ASSERTIONS','EXACT_NATIVE_DESTROY');
  await until(()=>destroyed.has(id),1000);observedCancelled.push(e);
 }
 assert.equal(view.memoryLockExpiries.size,0);assert.equal(view.lockAcquisitionBodies.size,0);assert.equal(hookOverflow,false);
};
try{
 at('MIGRATION_SOURCE','PINNED_SOURCE_AND_PRIVATE_DESTINATION');
 const migrationPins={
  '001_baseline_indexes.up.sql':'5fd2b4f9cde9d6f3379a9cb5088afb7e1cd9b6837736638e3eba9762903e1f51',
  '002_facts_table.up.sql':'dfaa2acbf809e9f6ff9ae48041fad92f0c319666fcee949c089e9ae903b34ae6',
  '003_user_profiles.up.sql':'f35a12904a00254affd1c8d3078530d959a13ff25e9ea5853fe5cb88dcdcaf8f',
  '004_incidents.up.sql':'9dbdd0e8505c937caf829f4fa24823740d27a599fbf52331eb4b2aecd821c24a',
 };
 const source='/app/db/migrations/sqlite';
 assert.equal(fs.lstatSync(source).isDirectory(),true);assert.equal(fs.lstatSync(source).isSymbolicLink(),false);
 assert.deepEqual(fs.readdirSync(source).filter(n=>n.endsWith('.up.sql')).sort(),Object.keys(migrationPins));
 const destination=path.join(root,'db','migrations','sqlite');fs.mkdirSync(destination,{recursive:true});
 for(const [name,pin]of Object.entries(migrationPins)){
  const original=path.join(source,name);const st=fs.lstatSync(original);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=65536);
  const bytes=fs.readFileSync(original);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin);
  const target=path.join(destination,name);fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
  assert.equal(createHash('sha256').update(fs.readFileSync(target)).digest('hex'),pin);diagnostic.migrationCount++;
 }
 diagnostic.migrationSource='MATCH_ALL_FOUR';
 at('SQLITE_PRECONDITION','ACTUAL_INCIDENTS_TABLE');
 const {sqliteService,SQLITE_DB_PATH}=await import('/app/services/sqliteService.ts');
 assert.equal(SQLITE_DB_PATH,path.join(root,'main.sqlite'));
 const table=sqliteService.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='incidents'").get() as {name?:string}|undefined;
 diagnostic.incidentsTable=table?.name==='incidents'?'PRESENT':'ABSENT';assert.equal(diagnostic.incidentsTable,'PRESENT');
 at('SQLITE_PRECONDITION','ACTUAL_MIGRATION_004');
 const migration=sqliteService.sql.prepare("SELECT filename FROM system_migrations WHERE version='004'").get() as {filename?:string}|undefined;
 diagnostic.migration004=migration?.filename==='004_incidents.up.sql'?'APPLIED':'ABSENT_OR_MISMATCH';assert.equal(diagnostic.migration004,'APPLIED');
 at('REDIS_IMPORT','ACTUAL_PRODUCTION_SINGLETON');
 const imported=await import('/app/services/redisClient.ts');service=imported.redisClient;cancellationType=imported.RedisMemoryLockExpiryTerminalCancelled;view=shape();
 const key='authored-finite-lock-A',other='authored-finite-lock-B';
 if(mode==='natural-expiry')await mark('NATURAL_EXPIRY_AND_HELD_GUARD',async()=>{
  await acquire(key,120);const first=captured[0];assert.equal(await service!.acquireLock(key,60013),false);
  assert.equal(shape().memoryLockExpiries.size,1);await until(()=>first.state==='FIRED',1500);
  assert.equal(view!.mockStore.has(key),false);await acquire(key,60013);
 });
 if(mode==='pending-terminal')await mark('PUBLIC_DISCONNECT_NOT_TERMINAL',async()=>{
  await acquire(key,60013);const e=captured[0];await service!.disconnect();assert.equal(e.state,'PENDING');
  assert.equal(shape().memoryLockExpiries.has(e),true);assert.equal(view!.mockStore.get(key),'locked');
 });
 if(mode==='fired-terminal')await mark('FIRED_BEFORE_TERMINAL',async()=>{
  await acquire(key,80);await until(()=>captured[0].state==='FIRED',1500);assert.equal(view!.mockStore.has(key),false);
 });
 if(mode==='inflight-terminal'){
  bodyOriginal=service.acquireLock(key,60013);assert.ok(bodyOriginal instanceof Promise);
  assert.ok(shape().lockAcquisitionBodies.has(bodyOriginal));sameBodyObserved=true;
  // Exact still-pending original observed before seal, no injected await gate.
  let settled=false;void bodyOriginal.then(()=>{settled=true;},()=>{settled=true;});
  const stillPending=!settled&&shape().lockAcquisitionBodies.has(bodyOriginal);
  // Registered before Host's bodyjoin observer. Read exact entry after its
  // actual setup returns, before cancellation microtasks consume it.
  const observedBody=bodyOriginal.then(result=>{assert.equal(result,true);capture();});
  void observedBody.catch(()=>undefined);
  const stop=host.stop();hostSealedEarly=true;assert.equal(stop,host.stop());
  assert.equal(await bodyOriginal,true);await observedBody;report=await stop;
  setResult('ACQUISITION_PENDING_AT_SEAL',stillPending?'EXERCISED_PASSED':'NOTEXERCISED');
  if(!stillPending)throw new Error('ACTUAL_INFLIGHT_INTERLEAVING_NOT_OBSERVED');
 }
 if(mode==='release-reacquire-terminal')await mark('TWO_GENERATIONS_CANCEL_WITHOUT_UNLOCK',async()=>{
  await acquire(key,60013);await service!.releaseLock(key);await acquire(key,60113);
  assert.equal(captured.length,2);assert.notEqual(captured[0],captured[1]);assert.equal(view!.mockStore.get(key),'locked');
 });
 if(mode==='multikey-guard')await mark('MULTIKEY_AND_UNSELECTED_GUARD',async()=>{
  await acquire(key,60013);await acquire(other,60113);assert.equal(await service!.acquireLock(key,60213),false);
  assert.equal(captured.length,2);assert.equal(shape().memoryLockExpiries.size,2);
 });
 if(mode==='postseal-idempotency')await mark('PENDING_BEFORE_POSTSEAL_ASSERTION',async()=>{await acquire(key,60013);});
 if(mode==='open-survivor')await mark('OLD_EXPIRY_MUST_NOT_DELETE_NEW_LOCK',async()=>{
  await acquire(key,120);const first=captured[0];await service!.releaseLock(key);await acquire(key,1000);
  await until(()=>first.state==='FIRED',1500);
  survivor=view!.mockStore.has(key)?'SURVIVES':'DELETED';
  at('OPEN_SURVIVOR','NEW_LOCK_SURVIVES_OLD_EXPIRY');
  assert.equal(survivor,'SURVIVES','OPEN_OLD_TIMER_DELETES_NEW_LOCK');
 });
}catch(error){recordFailure(error);primary=error;}
finally{
 // Independent public shutdowns before Hostseal. No native timer mutation from
 // fixture: physical cancellation must be done by actual product onSeal.
 const runtime=await import('/app/services/lifecycle/runtimeStopBindings.ts');
 for(const close of [()=>runtime.drainEvaluatedRuntimeProducers(),()=>runtime.closeEvaluatedRuntimeStorage()]){
  if(hostSealedEarly){cleanup.push('NOT_ATTEMPTED_HOST_ALREADY_SEALED');continue;}
  try{await close();cleanup.push('fulfilled');}catch{cleanup.push('rejected');}
 }
 try{
  if(service)capture();
  const firstStop=host.stop();assert.equal(firstStop,host.stop());
  if(!report)report=await firstStop;else assert.equal(report,await firstStop);
  if(service){
   assert.throws(()=>service!.acquireLock('authored-postseal',60013),e=>e instanceof AdmissionClosed);postSealRejected=true;
   if(captured.length>0)await cancellationCheck();
   // The authored locks survive CANCELLED timer disposal. A naturally FIRED
   // oldtimer's known deletion is kept as actual OPEN failure, not overwritten.
   if(mode!=='natural-expiry'&&mode!=='fired-terminal'&&mode!=='open-survivor')assert.equal(view!.mockStore.get('authored-finite-lock-A'),'locked');
   if(captured.length>0)setResult('ACTUAL_TERMINAL_DISPOSITION_AND_PHYSICAL_CANCEL','EXERCISED_PASSED');
  }
 }catch(error){recordFailure(error);if(primary===undefined)primary=error;setResult('ACTUAL_TERMINAL_DISPOSITION_AND_PHYSICAL_CANCEL','EXERCISED_FAILED');}
 // Exact fixed result rows initialized before production import; early failure
 // leaves NOT_REACHED instead of omitting or substituting another scenario.
 const receipt={version:1,mode,diagnostic,assertionsComplete:primary===undefined&&cleanup.every(x=>x==='fulfilled'||(hostSealedEarly&&x==='NOT_ATTEMPTED_HOST_ALREADY_SEALED'))&&results[0].status==='EXERCISED_PASSED'&&results[1].status==='EXERCISED_PASSED',results,cleanup,hostSealedEarly,productState:report?.state??'UNVERIFIED',productVerdict:'FAIL_OR_INCOMPLETE_NOT_PRODUCT_PASS',survivor,sameBodyObserved,postSealRejected,exactNativeTimers:tracked.size,actualDestroyObserved:destroyed.size,cancelledSameOriginal:observedCancelled.length,firedOriginal:observedFired.length,ownerFailures:report?.ownerFailures??null,taskOutcomeFailures:report?.taskOutcomeFailures??null,lifetimeFailures:report?.lifetimeFailures??null,rawPrivateLogExported:false,global:'INCOMPLETE'};
 fs.writeFileSync(receiptPath!,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 hook.disable();
 // Private root deletion must not race a retained callback/resource. Retain it
 // inside the disposable namespace on missing report or incomplete disposition.
 // Preserve local native-storage files until the namespace is discarded. A
 // fulfilled public close can still report incomplete resource quiescence; it
 // is not authority to unlink a live SQLite file. No private root is exported.
}
// Fixed failure exit only. Never print original errors, messages or stacks.
process.exitCode=primary===undefined&&cleanup.every(x=>x==='fulfilled'||(hostSealedEarly&&x==='NOT_ATTEMPTED_HOST_ALREADY_SEALED'))&&results[0].status==='EXERCISED_PASSED'&&results[1].status==='EXERCISED_PASSED'?0:1;
