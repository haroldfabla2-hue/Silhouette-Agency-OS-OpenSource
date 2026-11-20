// Real core effect/data boundaries with authored arguments. No provider invocation.
import test from 'node:test';import assert from 'node:assert/strict';
import {createTaskEvidence,addDataLabels,currentDataLabels} from '../../services/execution/taskEvidence.ts';
import {withToolDataBoundary,toolDataPolicy} from '../../services/security/toolDataBoundary.ts';
import {issueEffectGrant,effectBinding,ensureEffectConsent} from '../../services/security/effectGate.ts';
import {runWithEffectContext} from '../../services/security/effectContext.ts';
import {bindingDigest,approvalGrants} from '../../services/security/approvalGrants.ts';
test('actual semantic source policy labels dynamic database/logs/config/screenshot reads',()=>{
 for(const name of ['query_fixture_db_table','read_system_logs','get_system_config','system_get_screenshot']) assert(toolDataPolicy(name).source.includes('USER_PRIVATE'));
});
test('actual consumed exact-grant chain authorizes downstream guard but wrong args/unconsented/secret fail',async()=>{
 const args={to:'authored@example.invalid',subject:'authored',body:'authored approved private summary'};
 const ctx=issueEffectGrant('send_email',args,'authored-test');const binding=effectBinding('send_email',args);
 assert.equal(approvalGrants.consume(ctx.grant.token,binding).ok,true);ctx.validated.add(bindingDigest(binding));
 const owner=createTaskEvidence('authored');let invoked=0;
 await owner.run(async()=>{addDataLabels(['USER_PRIVATE']);
  await runWithEffectContext(ctx,()=>withToolDataBoundary('send_email',args,false,async()=>{invoked++;}));
  await assert.rejects(withToolDataBoundary('send_email',args,false,async()=>{invoked++;}),/DATA_FLOW_DENIED/);
  await assert.rejects(runWithEffectContext(ctx,()=>withToolDataBoundary('send_email',{...args,body:'different'},false,async()=>{invoked++;})),/DATA_FLOW_DENIED/);
  await assert.rejects(runWithEffectContext(ctx,()=>withToolDataBoundary('send_email',{...args,password:'authored'},false,async()=>{invoked++;})),/DATA_FLOW_DENIED/);
 });assert.equal(invoked,1);assert.equal(approvalGrants.consume(ctx.grant.token,binding).ok,false);
});
test('concurrent tasks and thrown private source cannot erase parent lineage',async()=>{
 const a=createTaskEvidence('A'),b=createTaskEvidence('B');
 await Promise.all([a.run(async()=>{
  await assert.rejects(withToolDataBoundary('read_file',{},false,async()=>{throw new Error('authored read failure');}),/authored read failure/);
  assert(currentDataLabels().includes('USER_PRIVATE'));
 }),b.run(async()=>{assert.deepEqual(currentDataLabels(),[]);})]);
});

test('actual provider consume-once under concurrency still allows downstream private data guard',async()=>{
 const args={destination:'authored',value:'approved authored private summary'},name='mcp_external:authored:fixture';
 const ctx=issueEffectGrant(name,args,'authored-test');const scope=createTaskEvidence('concurrent-consent');let invoked=0;
 await scope.run(async()=>{addDataLabels(['USER_PRIVATE']);
  const attempts=await Promise.allSettled([1,2].map(()=>runWithEffectContext(ctx,async()=>{
   await ensureEffectConsent(name,args,'authored-provider',{providerBoundary:true});
   return withToolDataBoundary(name,args,false,async()=>{invoked++;});
  })));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
 });assert.equal(invoked,1);
});
test('unsafe accessor and toJSON shapes are rejected before effect binding even with active grant',async()=>{
 const ctx=issueEffectGrant('send_email',{to:'authored@example.invalid',body:'authored'},'authored');let executed=0;
 for(const args of [{get to(){executed++;return 'unsafe';}},{toJSON(){executed++;return {};}}]){
  await assert.rejects(runWithEffectContext(ctx,()=>withToolDataBoundary('send_email',args,false,async()=>{executed++;})),/DATA_FLOW_DENIED/);
 }assert.equal(executed,0);
});
