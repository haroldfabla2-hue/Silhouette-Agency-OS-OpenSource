import { bootstrapStandaloneFixture } from './standalone-fixture-bootstrap';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Original abrupt probe semantics remain. Bootstrap is not closure evidence.
bootstrapStandaloneFixture();
await import('../../server/config/runtimeCredentials');
const mode=process.argv[2];
const {toolRegistry}=await import('../../services/tools/toolRegistry');
const {chatToolIntegration}=await import('../../services/chatToolIntegration');
const {lancedbService}=await import('../../services/lancedbService');
const {MemoryTier}=await import('../../types');
await toolRegistry.initialize();
fs.mkdirSync('workspace',{recursive:true});fs.writeFileSync('workspace/original.txt','actual original bytes');
if(mode==='denied'){
 const {securityManager}=await import('../../services/security/securityManager');
 securityManager.addToDenylist('read_file');
 const result=await chatToolIntegration.executeTool('read_file',{path:'workspace/original.txt'},'ADMIN');
 assert.equal(result.success,false,'capability refusal must not become a chat success');
 assert.match(result.error||'',/SECURITY_DENIED/);
 console.log(JSON.stringify({mode,actual_denial_preserved:true}));
}else{
 // A real malformed canonical row causes the experience receipt scan to fail.
 // No substituted persistence function or provider response is used.
 await lancedbService.store({id:'audit-original',content:'authored setup',timestamp:Date.now(),tier:MemoryTier.LONG,tags:['audit-fixture'],importance:0.5,accessCount:0,lastAccess:0});
 const table=(lancedbService as any).table;
 const row=(await table.query().limit(1).toArray())[0];
 await table.add([{...row,tags:Array.from(row.tags),id:'actual-corrupt-canonical',json_data:'{broken canonical row'}]);
 if(mode==='success-audit-failed'){
  const result=await chatToolIntegration.executeTool('read_file',{path:'workspace/original.txt'},'ADMIN');
  assert.equal(result.success,true,'actual read succeeded even if experience persistence fails');
  assert.equal(result.result.content,'actual original bytes');
  assert.equal(result.audit?.experience,'failed');
  assert.equal(fs.readFileSync('workspace/original.txt','utf8'),'actual original bytes');
  console.log(JSON.stringify({mode,original_result_preserved:true,audit_failure_separate:true,no_effect_retry:true}));
 }else if(mode==='denied-audit-failed'){
  const {securityManager}=await import('../../services/security/securityManager');
  securityManager.addToDenylist('read_file');
  const result=await chatToolIntegration.executeTool('read_file',{path:'workspace/original.txt'},'ADMIN');
  assert.equal(result.success,false);assert.match(result.error||'',/SECURITY_DENIED/);
  assert.equal(result.audit?.experience,'failed');
  console.log(JSON.stringify({mode,actual_denial_and_failed_memory_receipt_preserved:true}));
 }else if(mode==='failure-audit-failed'){
  const result=await chatToolIntegration.executeTool('read_file',{path:'workspace/missing.txt'},'ADMIN');
  assert.equal(result.success,false);
  assert.match(result.error||'',/Failed to read file|JAIL_DENIED/);
  console.log(JSON.stringify({mode,original_failure_returned_not_thrown:true}));
 }else throw new Error('explicit mode required');
}
process.exit(0);
