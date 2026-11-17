import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createTaskEvidence,withToolEvidence} from '../../services/execution/taskEvidence.ts';
test('actual SQLite timeout row preserves verdict, late evidence and original output across reopen',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'authored-evidence-db-'));process.env.SILHOUETTE_DB_PATH=path.join(root,'evidence.sqlite');process.env.SILHOUETTE_PROVIDERS='off';
 const {sqliteService,SqliteService}=await import('../../services/sqliteService.ts');
 const {recordPlanTasks,markTaskRunning,markTaskDone,recordLateSettlement}=await import('../../services/execution/taskLedger.ts');let reopened;
 try{
 const step={order:1,taskDescription:'authored timeout fixture',agentId:'authored',agentRole:'fixture'};
 recordPlanTasks({id:'authored-plan',steps:[step]});markTaskRunning('authored-plan',step);
 const evidence=createTaskEvidence('task_authored-plan_1');
 await evidence.run(async()=>{await withToolEvidence('read_file',{},'local',['USER_PRIVATE'],async()=>'authored original private fixture');});
 markTaskDone('authored-plan',step,{stepOrder:1,success:false,error:'authored timeout',output:'authored timeout evidence',abandonedInFlight:Date.now(),executionEvidence:evidence.snapshot()});
 await evidence.run(async()=>{await withToolEvidence('late_read',{},'local',['PII'],async()=>'authored late fixture');});
 recordLateSettlement('authored-plan',1,{stepOrder:1,success:true,output:'authored late output',executionEvidence:evidence.snapshot()});
 sqliteService.close();reopened=new SqliteService();
 const rows=reopened.getTasksByPlan('authored-plan');assert.equal(rows.length,1);assert.equal(rows[0].status,'failed');
 const data=JSON.parse(rows[0].data);assert.equal(data.output,'authored timeout evidence');assert.equal(data.lateSettlement.output,'authored late output');assert.equal(data.abandonedInFlight,undefined);
 assert.equal(data.executionEvidence.callsObserved,2);assert(data.executionEvidence.labels.includes('PII'));assert.equal(data.lateSettlement.executionEvidence.callsObserved,2);
 data.executionEvidence.detailExpiresAt=0;data.lateSettlement.executionEvidence.detailExpiresAt=0;
 reopened.upsertTask({id:rows[0].id,description:rows[0].description,assigned_to:rows[0].assigned_to,status:rows[0].status,data});
 const expired=JSON.parse(reopened.getTasksByPlan('authored-plan')[0].data);assert.equal(expired.executionEvidence.calls.length,0);assert.equal(expired.lateSettlement.executionEvidence.calls.length,0);
 const raw=JSON.parse(reopened.db.prepare('SELECT data FROM tasks WHERE id=?').get(rows[0].id).data);assert.equal(raw.executionEvidence.calls.length,2);assert.equal(raw.lateSettlement.executionEvidence.calls.length,2);
 }finally{reopened?.close();sqliteService.close();fs.rmSync(root,{recursive:true,force:true});}
});
