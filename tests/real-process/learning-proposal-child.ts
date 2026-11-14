import { bootstrapStandaloneFixture } from './standalone-fixture-bootstrap';
import fs from 'node:fs';import assert from 'node:assert/strict';
// Original abrupt probe semantics remain. Bootstrap is not closure evidence.
bootstrapStandaloneFixture();
await import('../../server/config/runtimeCredentials');
const {env}=await import('@xenova/transformers');env.allowRemoteModels=false;
env.allowLocalModels=false;
const {learningLoop}=await import('../../services/learningLoop');
const {incidentRegistry}=await import('../../services/incidentRegistry');
const {continuum}=await import('../../services/continuumMemory');
const {selfDevCycleService}=await import('../../services/selfdev/cycleService');
const {memoryRepairMapping}=await import('../../services/selfdev/incidentMappings');
const phase=process.argv[2];
const insight={context:'continuum-promote',failureCount:5,pattern:'Operator-authored mechanics fixture, not a discovered product fault',rootCause:'Fixture only',suggestedFix:'No executable patch authorized by fixture',confidence:1,autoApplicable:true};
if(phase==='write'){
 const incident=incidentRegistry.recordIncident(insight.context,'error','Authored linkage mechanics fixture, not actual product regression');assert.ok(incident.id);
 const receipt=await learningLoop.routeInsight(insight);assert.equal(receipt.applied,false);assert.equal(receipt.stage,'PROPOSAL_RECORDED');assert.ok(receipt.cycleId);assert.ok(receipt.proposalMemoryId);
 const memory=await continuum.getLatestObservation('MEMORY_REPAIR');assert.equal(memory?.id,receipt.proposalMemoryId);
 const cycle=selfDevCycleService.list().find(c=>c.id===receipt.cycleId);assert.equal(cycle?.state,'PROPOSAL_PENDING');
 assert.equal(learningLoop.getStats().autoApplied,0);assert.equal(fs.readdirSync('data/selfdev/pr-requests').length,0);
 fs.writeFileSync('learning-receipt.json',JSON.stringify(receipt));
}else{
 const original=JSON.parse(fs.readFileSync('learning-receipt.json','utf8'));const replay=await learningLoop.routeInsight(insight);assert.equal(replay.cycleId,original.cycleId);assert.equal(replay.proposalMemoryId,original.proposalMemoryId);assert.equal(selfDevCycleService.list().length,1);
 const after=await selfDevCycleService.attempt(replay.cycleId!);assert.equal(after.state,'PROPOSAL_PENDING');assert.match(after.lastError!,/no planner called/);assert.equal(after.patch,undefined);assert.deepEqual(after.scope,memoryRepairMapping(insight.context)!.scope);assert.equal(after.learningProposal?.applied,false);assert.equal(after.learningProposal?.stage,'HUMAN_APPROVAL_PENDING');
 assert.throws(()=>selfDevCycleService.requestPR(replay.cycleId!,'fixture-operator'),/independent baseline/);assert.equal(learningLoop.getStats().autoApplied,0);
}
console.log(JSON.stringify({phase,real_sqlite_incident:true,real_memory_receipt:true,real_cycle_persisted:true,planner_calls:0,patches_applied:0,learning_successes:0,applied:false,fixture_only:true}));process.exit(0);
