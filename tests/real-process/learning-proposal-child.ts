import { bootstrapStandaloneFixture } from './standalone-fixture-bootstrap';
import fs from 'node:fs';import assert from 'node:assert/strict';
// Original abrupt probe semantics remain. Bootstrap is not closure evidence.
bootstrapStandaloneFixture();
assert.equal(process.env.SILHOUETTE_INFERENCE_MODE,'cloud-only','Explicit no-local-model policy required before product imports');
assert.equal(process.env.SILHOUETTE_PROVIDERS,'off','Explicit provider-OFF policy required before product imports');
await import('../../server/config/runtimeCredentials');
const {env}=await import('@xenova/transformers');env.allowRemoteModels=false;
env.allowLocalModels=false;
const {learningLoop}=await import('../../services/learningLoop');
const {incidentRegistry}=await import('../../services/incidentRegistry');
const {continuum}=await import('../../services/continuumMemory');
const {selfDevCycleService}=await import('../../services/selfdev/cycleService');
const {experienceBuffer}=await import('../../services/experienceBuffer');
const {memoryRepairMapping}=await import('../../services/selfdev/incidentMappings');
const phase=process.argv[2];
const insight={failureExperienceIds:[] as string[],context:'continuum-promote',failureCount:5,pattern:'Operator-authored mechanics fixture, not a discovered product fault',rootCause:'Fixture only',suggestedFix:'No executable patch authorized by fixture',confidence:1,autoApplicable:true};
if(phase==='empty'){
 const result=await learningLoop.analyzeFailures();assert.deepEqual(result,{status:'COMPLETE',insights:[],failureCount:0});
 const bad=await learningLoop.analyzeFailures(Number.NaN);assert.equal(bad.status,'FAILED');
}else if(phase==='ingest'){
 const r=incidentRegistry.recordIncident('continuum-embeddings','error','Authored bridge mechanics episode, not actual regression');
 let result=await learningLoop.analyzeFailures();assert.deepEqual(result,{status:'COMPLETE',insights:[],failureCount:1});
 const before=(await experienceBuffer.getRecentDurable(100,'FAILURE')).find(e=>e.incident?.id===r.id)!;assert.equal(before.id,`incident:${r.id}`);
 incidentRegistry.recordIncident('continuum-embeddings','error','Authored bridge mechanics episode, not actual regression');
 result=await learningLoop.analyzeFailures();assert.deepEqual(result,{status:'COMPLETE',insights:[],failureCount:1});
 const after=(await experienceBuffer.getRecentDurable(100,'FAILURE')).find(e=>e.id===before.id)!;assert.deepEqual(after,before);
 incidentRegistry.resolveIncidents('continuum-embeddings','error');
}else if(phase==='failed'){
 const failures=(await experienceBuffer.getRecentDurable(100,'FAILURE')).filter(e=>e.context===insight.context)
  .map(e=>({id:e.id,incident:e.incident,timestamp:e.timestamp,context:e.context,action:e.action,result:'FAILURE',error:e.outcome,solution:e.lesson,source:e.agentId||'SYSTEM'}));
 const ledger=await import('../../services/selfdev/learningAnalysisLedger');
 const {canonicalLearningAnalysisInput}=await import('../../services/selfdev/learningAnalysisInput');
 const input=canonicalLearningAnalysisInput(insight.context,failures);
 const decoded=JSON.parse(input);assert.equal(decoded.version,1);assert.equal(decoded.context,'continuum-promote');
 assert.deepEqual(decoded.failures.map((f:any)=>f.id),failures.map(f=>f.id).sort());
 assert.ok(decoded.failures.every((f:any)=>f.result==='FAILURE'&&f.incident.source==='continuum-promote'&&f.timestamp===f.incident.firstSeen));
 ledger.admitLearningAnalysis(input);
 const result=await learningLoop.analyzeFailures();assert.equal(result.status,'FAILED');
 assert.equal('insights' in result,false);if(result.status==='FAILED')assert.match(result.detail,/UNKNOWN/);
 assert.equal(learningLoop.getStats().autoApplied,0);
}else if(phase==='unavailable'){
 const {MemoryTier}=await import('../../types');
 await continuum.store('Authored invalid EXPERIENCE content, not a real product fault',MemoryTier.LONG,['EXPERIENCE','FAILURE'],true);
 const result=await learningLoop.analyzeFailures();assert.equal(result.status,'UNAVAILABLE');
 assert.equal('insights' in result,false);
}else if(phase==='write'){
 const ledger=await import('../../services/selfdev/learningAnalysisLedger');
 const admitted=ledger.admitLearningAnalysis('authored-unknown-call-input');assert.ok(admitted.hash);
 assert.throws(()=>ledger.admitLearningAnalysis('authored-unknown-call-input'),/UNKNOWN/);
 const cached=ledger.admitLearningAnalysis('authored-completed-call-input');
 ledger.completeLearningAnalysis(cached.hash,'authored non-model result');
 assert.equal(ledger.admitLearningAnalysis('authored-completed-call-input').cachedResult,'authored non-model result');
 for(let i=0;i<5;i++){
  if(i)incidentRegistry.resolveIncidents(insight.context,'error');
  const r=incidentRegistry.recordIncident(insight.context,'error','Authored episode '+i+', NOT a current product fault');
  const original=incidentRegistry.getIncident(r.id)!;
  const id=await experienceBuffer.recordIncidentFailure(original);assert.equal(await experienceBuffer.recordIncidentFailure(original),id);
  incidentRegistry.recordIncident(insight.context,'error',original.summary); // repeat occurrence, not another episode
  assert.equal(await experienceBuffer.recordIncidentFailure(incidentRegistry.getIncident(r.id)!),id);
  insight.failureExperienceIds.push(id);
 }
 assert.equal((await experienceBuffer.getRecentDurable(100,'FAILURE')).filter(e=>e.context===insight.context).length,5);
 assert.equal((await learningLoop.routeInsight({...insight,failureExperienceIds:undefined})).stage,'REJECTED');
 const receipt=await learningLoop.routeInsight(insight);assert.equal(receipt.applied,false);assert.equal(receipt.stage,'PROPOSAL_RECORDED');assert.ok(receipt.cycleId);assert.ok(receipt.proposalMemoryId);
 const memory=await continuum.getLatestObservation('MEMORY_REPAIR');assert.equal(memory?.id,receipt.proposalMemoryId);
 const cycle=selfDevCycleService.list().find(c=>c.id===receipt.cycleId);assert.equal(cycle?.state,'PROPOSAL_PENDING');
 assert.equal(learningLoop.getStats().autoApplied,0);assert.equal(fs.readdirSync('data/selfdev/pr-requests').length,0);
 fs.writeFileSync('learning-receipt.json',JSON.stringify(receipt));
}else{
 const ledger=await import('../../services/selfdev/learningAnalysisLedger');
 assert.throws(()=>ledger.admitLearningAnalysis('authored-unknown-call-input'),/UNKNOWN/);
 assert.equal(ledger.admitLearningAnalysis('authored-completed-call-input').cachedResult,'authored non-model result');
 const history=(await experienceBuffer.getRecentDurable(100,'FAILURE')).filter(e=>e.context===insight.context);assert.equal(history.length,5);
 insight.failureExperienceIds=history.map(e=>e.id).sort();
 const original=JSON.parse(fs.readFileSync('learning-receipt.json','utf8'));const replay=await learningLoop.routeInsight(insight);assert.equal(replay.cycleId,original.cycleId);assert.equal(replay.proposalMemoryId,original.proposalMemoryId);assert.equal(selfDevCycleService.list().length,1);
 incidentRegistry.resolveIncidents(insight.context,'error');
 const resolvedReplay=await learningLoop.routeInsight(insight);assert.equal(resolvedReplay.cycleId,original.cycleId);
 const after=await selfDevCycleService.attempt(replay.cycleId!);assert.equal(after.state,'PROPOSAL_PENDING');assert.match(after.lastError!,/no planner called/);assert.equal(after.patch,undefined);assert.deepEqual(after.scope,memoryRepairMapping(insight.context)!.scope);assert.equal(after.learningProposal?.applied,false);assert.equal(after.learningProposal?.stage,'HUMAN_APPROVAL_PENDING');
 assert.throws(()=>selfDevCycleService.requestPR(replay.cycleId!,'fixture-operator'),/independent baseline/);assert.equal(learningLoop.getStats().autoApplied,0);
}
console.log(JSON.stringify({phase,real_sqlite_incident:phase!=='empty',real_memory_receipt:phase!=='empty',real_cycle_persisted:['write','read'].includes(phase),analysis_generation_exercised:false,planner_calls:0,patches_applied:0,learning_successes:0,applied:false,fixture_only:true}));process.exit(0);
