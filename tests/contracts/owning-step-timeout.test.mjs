// PREPARED PROPOSAL, NOT YET RUN: actual owning entry points with complete installed dependencies.
// Actual production-used narrow timeout owner, without importing PlanExecutor graph.
// No monkeypatches, fake provider responses, model calls, server or daemon launch.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
test('actual PlanExecutor timeout helper reconciles late evidence into SQLite without changing failed verdict',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'authored-plan-timeout-'));
 const names=['SILHOUETTE_STEP_TIMEOUT_MS','SILHOUETTE_PROVIDERS','SILHOUETTE_DB_PATH','SILHOUETTE_TOOLS_DB_PATH','SILHOUETTE_IDENTITY_DB_PATH','SILHOUETTE_LANCEDB_PATH'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{SILHOUETTE_STEP_TIMEOUT_MS:'10',SILHOUETTE_PROVIDERS:'off',SILHOUETTE_DB_PATH:path.join(root,'system.sqlite'),SILHOUETTE_TOOLS_DB_PATH:path.join(root,'tools.sqlite'),SILHOUETTE_IDENTITY_DB_PATH:path.join(root,'identity.sqlite'),SILHOUETTE_LANCEDB_PATH:path.join(root,'memory.lancedb')});
 // Run this file in its own fresh process with disposable stores. Its actual
 // timeout method is called without replacing the work or ledger implementation.
 let reopened,sqliteService,pendingWork;
 try{
 const {withStepTimeout,getAbandonedStepsInFlight}=await import('../../services/execution/stepTimeout.ts');
 const {sqliteService:store,SqliteService}=await import('../../services/sqliteService.ts');
 const {markTaskDone,recordPlanTasks}=await import('../../services/execution/taskLedger.ts');
 const {createTaskEvidence,withToolEvidence}=await import('../../services/execution/taskEvidence.ts');
 const {emitProviderAttempt}=await import('../../services/usageObservation.ts');
 const step={order:1,agentId:'authored',agentRole:'fixture',taskDescription:'authored timeout',dependsOn:[],requiredCapabilities:[],priority:'NORMAL'},planId='authored-actual-timeout';
 const evidence=createTaskEvidence('task_'+planId+'_1');
 sqliteService=store;
  recordPlanTasks({id:planId,steps:[step]});
  const work=pendingWork=evidence.run(async()=>{
   await withToolEvidence('read_file',{},'local',['USER_PRIVATE'],async()=>'authored');
   await new Promise(resolve=>setTimeout(resolve,75));
   emitProviderAttempt({invocationId:'authored-late',provider:'fixture',model:'unknown',outcome:'failed',inputTokens:null,outputTokens:null});
   return {stepOrder:1,agentId:'authored',success:true,output:'authored late settlement',tokensUsed:0,executionTimeMs:75};
  });
  const result=await withStepTimeout(planId,step,work,evidence);
  assert.equal(result.success,false);assert(result.abandonedInFlight);assert(getAbandonedStepsInFlight().some(x=>x.planId===planId));
  markTaskDone(planId,step,{...result,executionEvidence:evidence.snapshot()});
  await work;await Promise.resolve();
  const row=sqliteService.getTasksByPlan(planId)[0];const data=JSON.parse(row.data);assert.equal(row.status,'failed');assert.equal(data.lateSettlement.output,'authored late settlement');assert.equal(data.executionEvidence.attempts[0].invocationId,'authored-late');assert.equal(data.abandonedInFlight,undefined);assert(!getAbandonedStepsInFlight().some(x=>x.planId===planId));
  // Reopen the exact same real DB, without replacing ledger methods.
  sqliteService.close();reopened=new SqliteService();assert.equal(JSON.parse(reopened.getTasksByPlan(planId)[0].data).executionEvidence.attempts[0].outcome,'failed');
 }finally{
  const cleanup=[];
  // Never close the ledger or remove the fixture while authored work is alive.
  try{if(pendingWork)await pendingWork;}catch(error){cleanup.push(error);}
  try{reopened?.close();}catch(error){cleanup.push(error);}
  try{sqliteService?.close();}catch(error){cleanup.push(error);}
  try{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}}catch(error){cleanup.push(error);}
  try{fs.rmSync(root,{recursive:true,force:true});}catch(error){cleanup.push(error);}
  if(cleanup.length)throw new AggregateError(cleanup,'authored timeout fixture cleanup failed');
 }
});
