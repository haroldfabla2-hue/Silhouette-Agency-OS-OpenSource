/* INACTIVE product test entry. Call only inside the separately reviewed capsule.
 * All service methods below are the real emitted modules, never extracted or
 * replaced. Public fixture text is not provider output. No success process.exit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const fixture=[
 {source:'CONSCIOUS',content:'Public fixture accepted thought one',importance:0.9,metadata:{fixture:1}},
 {source:'AGENCY',content:'Public fixture accepted thought two',importance:0.8,metadata:{fixture:2}}
];
const observer=globalThis[Symbol.for('narrative.direct.observer')];
export async function runPhase(mode){
 assert.ok(mode==='write'||mode==='read');
 assert.equal(process.cwd(),'/work');
 assert.equal(process.env.SILHOUETTE_PROVIDERS,'off');
 assert.equal(process.env.SILHOUETTE_BOOT_MODE,'normal');
 assert.equal(process.getuid(),1000);
 observer?.checkpoint('GUARD');
 createRequire(import.meta.url)('/app/native-selection-guard.cjs').verify('/app');
 observer?.checkpoint('RUNTIME_IMPORT');
 await import('/app/server/config/runtimeCredentials.js');
 observer?.checkpoint('NARRATIVE_IMPORT');
 const {narrative}=await import('/app/services/narrativeService.js');
 observer?.checkpoint('OWNERS_IMPORT');
 const {drainOwnedProducers}=await import('/app/services/lifecycle/ownedProducers.js');
 let originalError;let pending;let receipt;const cleanupFailures=[];
 try{
  if(mode==='write'){
   // Real private-TS method at its runtime JS boundary, not a replacement.
   // Each call owns its ticket synchronously, before admitThought's first await.
   observer?.checkpoint('ADMISSIONS');
   const accepted=fixture.map(item=>narrative.queueOrEmitThought(item.source,item.content,item.importance,item.metadata));
   assert.equal(narrative.pendingAdmissions.size,2);
   const stop=narrative.preserveAndStopBatchProcessor();
   const settled=await Promise.allSettled(accepted);
   observer?.checkpoint('ADMISSIONS_SETTLED');
   settled.forEach((value,index)=>{if(value.status==='rejected')observer?.errorAt(index===0?'ADMISSION_0':'ADMISSION_1',value.reason);});
   assert.ok(settled.every(value=>value.status==='fulfilled'),'accepted work rejected across stop');
   receipt=await stop;
  }else{
   pending=await narrative.pendingNarrationSnapshot();
   assert.deepEqual(pending.map(({id,...item})=>item),fixture);
   receipt=await narrative.preserveAndStopBatchProcessor();
  }
  observer?.checkpoint('PRESERVE_RECEIPT');
  assert.equal(receipt.error,null);
  assert.equal(receipt.boundExhausted,false);
  assert.equal(receipt.remainingItems,0);
  assert.equal(receipt.pendingPreserved,2);
  assert.equal(receipt.admissionFailures,0);
  const journal=JSON.parse(fs.readFileSync('/work/data/wal/pending-narrations.json','utf8'));
  assert.deepEqual(journal.items.map(({id,...item})=>item),fixture);
  assert.equal(new Set(journal.items.map(item=>item.id)).size,2);
  assert.deepEqual(journal.completed,[]);
  if(pending)assert.deepEqual(journal.items,pending);
  await assert.rejects(narrative.enqueuePendingNarration({source:'AGENCY',content:'Public fixture too late',importance:0.9}));
  const again=await narrative.preserveAndStopBatchProcessor();
  assert.equal(again.error,null);assert.equal(again.pendingPreserved,2);
  assert.deepEqual(JSON.parse(fs.readFileSync('/work/data/wal/pending-narrations.json','utf8')).items,journal.items);
 }catch(error){observer?.errorAt('ORACLE_PRIMARY',error);originalError=error;}
 finally{
  // Attempt every actual lifecycle close; never replace a failure with success.
  try{
   observer?.checkpoint('OWNERS_CLOSE');
   const stops=await drainOwnedProducers();
   for(const value of Object.values(stops)){
    assert.ok(value&&!value.stopFailed&&!value.boundExhausted);
    if('error' in value)assert.equal(value.error,null);
    for(const key of ['remainingItems','remainingQueue','activeAdmissions','activeQueueRuns'])
     if(key in value)assert.equal(value[key],0);
   }
  }catch(error){observer?.errorAt('OWNERS_CLOSE',error);cleanupFailures.push(error);}
  for(const [file,key,method] of [
   ['/app/services/memory/continuousMemory.js','continuousMemory','shutdown'],
   ['/app/services/connectionNervousSystem.js','nervousSystem','stop'],
   ['/app/services/graphService.js','graph','close'],
   ['/app/services/redisClient.js','redisClient','disconnect'],
   ['/app/services/sqliteService.js','sqliteService','close']
  ]){
   const site={continuousMemory:'MEMORY_CLOSE',nervousSystem:'NERVOUS_CLOSE',graph:'GRAPH_CLOSE',redisClient:'REDIS_CLOSE',sqliteService:'SQLITE_CLOSE'}[key];
   observer?.checkpoint(site);
   try{const service=(await import(file))[key];await service[method]();}
   catch(error){observer?.errorAt(site,error);cleanupFailures.push(error);}
  }
 }
 if(originalError)throw originalError;
 if(cleanupFailures.length)throw new AggregateError(cleanupFailures,'REAL_LIFECYCLE_CLOSE_FAILED');
 // This receipt is an oracle checkpoint only. Parent must still observe natural
 // process exit and EOF. It must not treat this print as termination evidence.
 process.stdout.write('NARRATIVE_PHASE '+JSON.stringify({mode,originalWorkEqual:true,preserved:2,lateRefused:true})+'\n');
}
