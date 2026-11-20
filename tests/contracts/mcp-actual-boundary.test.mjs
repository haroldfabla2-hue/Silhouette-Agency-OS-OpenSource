import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {actionExecutor} from '../../services/actionExecutor.ts';
import {withAuthenticatedPrincipal} from '../../services/security/principalContext.ts';
import {mcpClient} from '../../services/mcp/mcpClient.ts';
import {issueEffectGrant} from '../../services/security/effectGate.ts';
import {runWithEffectContext} from '../../services/security/effectContext.ts';
import {createTaskEvidence,addDataLabels} from '../../services/execution/taskEvidence.ts';
test('actual MCP connect/discovery/call transport consumes exact grant once, rejects replay and concurrent second call',async()=>{
 let calls=0;const server=http.createServer(async(req,res)=>{
  if(req.url==='/sse'){res.writeHead(200);res.end('authored discovery endpoint');return;}
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);res.writeHead(200,{'Content-Type':'application/json'});
  if(body.method==='tools/list')res.end(JSON.stringify({result:{tools:[{name:'authored',inputSchema:{type:'object'}}]}}));
  else{calls++;res.end(JSON.stringify({result:{authored:true}}));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const name='authored-loopback';mcpClient.registerServer({name,url:'http://127.0.0.1:'+server.address().port,autoConnect:false});
 const args={body:'authored private summary'},effect='mcp_external:'+name+':authored';
 try{
 assert.equal(await mcpClient.connect(name),true);
 const ctx=issueEffectGrant(effect,args,'authored-fixture');
 await createTaskEvidence('mcp-private').run(async()=>{addDataLabels(['USER_PRIVATE']);
  assert.deepEqual(await runWithEffectContext(ctx,()=>mcpClient.executeTool(name,'authored',args)),{authored:true});
  assert((await runWithEffectContext(ctx,()=>mcpClient.executeTool(name,'authored',args))).error);
 });assert.equal(calls,1);
 const next=issueEffectGrant(effect,args,'authored-fixture');
 const results=await runWithEffectContext(next,()=>Promise.all([1,2].map(()=>mcpClient.executeTool(name,'authored',args))));
 assert.equal(results.filter(x=>x.authored).length,1);assert.equal(results.filter(x=>x.error).length,1);assert.equal(calls,2);
 // Genuine pending human-confirmation path, decided by authored test principal.
 const principal='authored-mcp-principal';
 const approvalWork=withAuthenticatedPrincipal(principal,()=>createTaskEvidence('mcp-human').run(async()=>{
  addDataLabels(['USER_PRIVATE']);return mcpClient.executeTool(name,'authored',args);
 }));
 let pending;for(let i=0;i<300;i++){pending=actionExecutor.getPendingConfirmations(principal)[0];if(pending)break;await new Promise(r=>setTimeout(r,10));}
 assert(pending,'real human pending created');assert.equal(actionExecutor.approveAction(pending.id,principal),true);
 assert.deepEqual(await approvalWork,{authored:true});assert.equal(calls,3);assert.equal(actionExecutor.approveAction(pending.id,principal),false);
 let accessed=0;const unsafe={get body(){accessed++;return 'must not run';}};
 await assert.rejects(mcpClient.executeTool(name,'authored',unsafe),/DATA_FLOW_DENIED/);assert.equal(accessed,0);assert.equal(calls,3);
 }finally{for(const pending of actionExecutor.getPendingConfirmations('authored-mcp-principal')) actionExecutor.rejectAction(pending.id,'authored-mcp-principal');mcpClient.disconnect(name);await new Promise(resolve=>server.close(resolve));}
});
