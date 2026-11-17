import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskEvidence,withToolEvidence,inspectData,assertDataSink,currentDataLabels,minimizeExpiredEvidence} from '../../services/execution/taskEvidence.ts';
import {emitUsage} from '../../services/usageObservation.ts';

test('private source lineage blocks arbitrary/external sinks even after transformations; no raw capture',async()=>{
 const owner=createTaskEvidence('authored-task');let sent=0;
 await owner.run(async()=>{
  await withToolEvidence('read_file',{path:'fixture'},'local',['USER_PRIVATE'],async()=>({text:'authored-private-fixture'}));
  await assert.rejects(withToolEvidence('send_email',{body:'transformed summary'},'external',[],async()=>{sent++;}),/DATA_FLOW_DENIED/);
  await assert.rejects(withToolEvidence('execute_code',{},'unconfined',[],async()=>{sent++;}),/DATA_FLOW_DENIED/);
  assert.deepEqual(currentDataLabels(),['USER_PRIVATE']);
 });
 assert.equal(sent,0);const evidence=owner.snapshot();assert.equal(evidence.callsObserved,3);assert.equal(evidence.activeCalls,0);
 assert.equal(evidence.calls.filter(c=>c.outcome==='blocked').length,2);assert.equal(evidence.estimatedUsd,null);
 assert(!JSON.stringify(evidence).includes('authored-private-fixture'));assert(!JSON.stringify(evidence).includes('transformed summary'));
});
test('explicit secret fields/PII/accessors/over-budget input fail closed without invoking getters',()=>{
 assert(inspectData({password:'authored-not-a-real-secret'}).labels.includes('SECRET'));
 assert(inspectData('fixture@example.invalid').labels.includes('PII'));
 let reads=0;const item={get payload(){reads++;return 'never';}};
 assert(inspectData(item).labels.includes('SECRET'));assert.equal(reads,0);
 assert(inspectData('x'.repeat(1_048_577)).labels.includes('SECRET'));
 assert.throws(()=>assertDataSink('external',{authorization:'authored'}),/DATA_FLOW_DENIED/);
});
test('concurrent async tasks keep lineage and real usage attribution separate',async()=>{
 const a=createTaskEvidence('A'),b=createTaskEvidence('B');
 await Promise.all([
  a.run(async()=>{await withToolEvidence('read_inbox',{},'local',['USER_PRIVATE'],async()=>'' );await Promise.resolve();emitUsage({source:'legacy-estimator',model:'fixture-free',inputTokens:2,outputTokens:3,estimatedUsd:0,pricing:'configured-estimate'});}),
  b.run(async()=>{await Promise.resolve();assert.deepEqual(currentDataLabels(),[]);emitUsage({source:'openai-compatible',model:'fixture-unknown',inputTokens:null,outputTokens:null,estimatedUsd:null,pricing:'unknown'});})]);
 assert.equal(a.snapshot().estimatedUsd,0);assert.equal(a.snapshot().usage[0].inputTokens,2);assert.deepEqual(b.snapshot().labels,[]);
 assert.equal(b.snapshot().estimatedUsd,null);assert.equal(b.snapshot().unknownPriceCalls,1);
});
test('bounded metadata, honest omission, returned errors and expiry without deleting original evidence',async()=>{
 const owner=createTaskEvidence('bounded');
 await owner.run(async()=>{for(let i=0;i<140;i++)await withToolEvidence('local',{},'local',[],async()=>({error:'authored-error'}));});
 const evidence=owner.snapshot();assert.equal(evidence.callsObserved,140);assert.equal(evidence.calls.length,128);assert.equal(evidence.callsOmitted,12);
 assert(evidence.calls.every(c=>c.outcome==='error'));const original={output:'preserved memory',executionEvidence:evidence};
 const expired=minimizeExpiredEvidence(original,evidence.detailExpiresAt);assert.equal(expired.executionEvidence.calls.length,0);
 assert.equal(original.executionEvidence.calls.length,128);assert.equal(expired.output,'preserved memory');
});
test('exact approved private disclosure preserves features but never secrets or arbitrary code',async()=>{
 const owner=createTaskEvidence('explicit-disclosure');let effects=0;
 await owner.run(async()=>{
  await withToolEvidence('read_file',{},'local',['USER_PRIVATE'],async()=>'private authoredfixture');
  await withToolEvidence('send_email',{body:'authored approved summary'},'external',[],async()=>{effects++;},true);
  await assert.rejects(withToolEvidence('send_email',{password:'authoredcredential'},'external',[],async()=>{effects++;},true),/DATA_FLOW_DENIED/);
 });assert.equal(effects,1);
});
test('nested task scopes cannot clear private labels and join on rejection and late settlement',async()=>{
 const parent=createTaskEvidence('parent');let release;const gate=new Promise(resolve=>{release=resolve;});let child;
 await parent.run(async()=>{
  await withToolEvidence('read_file',{},'local',['USER_PRIVATE'],async()=>'authored');
  child=createTaskEvidence('nested');
  await assert.rejects(child.run(async()=>{assert.deepEqual(currentDataLabels(),['USER_PRIVATE']);throw new Error('authored throw');}),/authored throw/);
  assert.deepEqual(currentDataLabels(),['USER_PRIVATE']);
  const late=child.run(async()=>{await gate;await withToolEvidence('local',{},'local',['PII'],async()=>'late');});
  release();await late;assert(currentDataLabels().includes('PII'));
 });
 assert(parent.snapshot().labels.includes('PII'));assert(child.snapshot().callsObserved===1);
});
test('stable invocation cost deduplicates enrichment, counts failures unknown and joins nested task once',async()=>{
 const {emitProviderAttempt}=await import('../../services/usageObservation.ts');
 const a=createTaskEvidence('priced-parent');let child;
 await a.run(async()=>{
  child=createTaskEvidence('priced-child');
  await child.run(async()=>{
   const attempt={invocationId:'authored-fixed',provider:'fixture',model:'priced',inputTokens:2,outputTokens:3};
   emitProviderAttempt({...attempt,outcome:'started'});
   const cost={invocationId:attempt.invocationId,source:'legacy-estimator',model:'priced',inputTokens:2,outputTokens:3,estimatedUsd:0.01,pricing:'configured-estimate'};
   emitUsage(cost);emitUsage(cost);emitProviderAttempt({...attempt,outcome:'completed'});
  });
 });
 assert.equal(a.snapshot().estimatedUsd,0.01);assert.equal(child.snapshot().estimatedUsd,0.01);
 await a.run(async()=>{emitProviderAttempt({invocationId:'authored-failure',provider:'fixture',model:'priced',outcome:'failed',inputTokens:null,outputTokens:null});});
 assert.equal(a.snapshot().estimatedUsd,null);assert.equal(a.snapshot().knownEstimatedUsd,0.01);assert.equal(a.snapshot().unknownPriceCalls,1);
});
test('concurrent child scopes see new sibling private lineage before that sibling settles',async()=>{
 const parent=createTaskEvidence('parent-barrier');let release;const gate=new Promise(resolve=>{release=resolve;});
 await parent.run(async()=>{
  const a=createTaskEvidence('child-A'),b=createTaskEvidence('child-B');
  const work=a.run(async()=>{await withToolEvidence('read_file',{},'local',['USER_PRIVATE'],async()=>{await gate;return 'authored';});});
  await b.run(async()=>{await assert.rejects(withToolEvidence('external_send',{},'external',[],async()=>'must not send'),/DATA_FLOW_DENIED/);});
  release();await work;
 });
});
test('child omission counts join idempotently and attempt metadata is bounded/redacted',async()=>{
 const {emitProviderAttempt}=await import('../../services/usageObservation.ts');const parent=createTaskEvidence('omission-parent');let child;
 await parent.run(async()=>{child=createTaskEvidence('omission-child');await child.run(async()=>{
  for(let i=0;i<140;i++){
   emitProviderAttempt({invocationId:'authored-'+i,provider:'authored private provider value',model:'x'.repeat(200),outcome:'completed',inputTokens:1,outputTokens:1});
   emitUsage({source:'legacy-estimator',model:'fixture',inputTokens:1,outputTokens:1,estimatedUsd:0,pricing:'configured-estimate'});
  }
 });});
 const first=parent.snapshot();assert.equal(first.attemptsOmitted,12);assert.equal(first.usageOmitted,12);assert(first.attempts.every(x=>x.model==='unknown'&&x.provider==='unknown'));
 await parent.run(async()=>{await child.run(async()=>{});});
 const second=parent.snapshot();assert.equal(second.attemptsOmitted,first.attemptsOmitted);assert.equal(second.usageOmitted,first.usageOmitted);assert.equal(second.attempts.length,128);assert.equal(second.usage.length,128);
 const expired=minimizeExpiredEvidence({executionEvidence:first},first.detailExpiresAt);const twice=minimizeExpiredEvidence(expired,first.detailExpiresAt+1);assert.deepEqual(twice,expired);
});
