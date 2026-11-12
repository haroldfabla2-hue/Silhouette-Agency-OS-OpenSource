/** Actual WebSocket ingress + complete handler. Providers OFF returns its real
 * credential error, never a synthetic model response or cognitive success. */
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {WebSocket} from 'ws';
const mode=process.argv[2];
const {agentPersistence}=await import('../../services/agentPersistence');
const {INITIAL_AGENTS}=await import('../../constants');
for(const agent of INITIAL_AGENTS)agentPersistence.saveAgent(agent);
const {orchestrator}=await import('../../services/orchestrator');
if(mode.startsWith('restart-')){
 const entries=JSON.parse(fs.readFileSync('data/wal/memory_wal.json','utf8'));
 const entry=entries.filter((e:any)=>e.data.input==='authored-web-handler-request').at(-1);
 assert.ok(entry);assert.equal(entry.status,mode==='restart-committed'?'COMMITTED':'INTERRUPTED');
 const bytes=fs.readFileSync('data/agents/core-01/MEMORY.md','utf8');
 assert.ok(bytes.includes(`WAL_${entry.status==='COMMITTED'?'COMMIT':'INTERRUPTION'}:${entry.id}`));
 if(entry.status==='COMMITTED')assert.ok(bytes.includes(entry.data.metadata.deliveryReceipt.id));
 assert.equal(entry.data.input,'authored-web-handler-request');
 console.log(JSON.stringify({mode,wal_id:entry.id,wal_timestamp:entry.timestamp,wal_status:entry.status,no_request_reexecution:true}));process.exit(0);
}
await orchestrator.hydrateAgent('core-01');
const memory='data/agents/core-01/MEMORY.md';
if(mode==='post-delivery-wal-failed'){
 fs.mkdirSync('data/agents/core-01',{recursive:true});fs.writeFileSync(memory,'original authored memory bytes');fs.chmodSync(memory,0o400);
}
const {gateway}=await import('../../server/gateway/wsGateway');
const server=http.createServer();gateway.initialize(server);
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as {port:number}).port;
async function connect(clientId:string){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);const frames:any[]=[];
 ws.on('message',data=>frames.push(JSON.parse(data.toString())));
 await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.send(JSON.stringify({type:'connect',params:{clientId,clientType:'web-ui'}}));
 const deadline=Date.now()+2000;while(!frames.some(f=>f.type==='connect-ok')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(frames.some(f=>f.type==='connect-ok'));
 return{ws,frames,sessionId:frames.find(f=>f.type==='connect-ok').sessionId};
}
const first=await connect('actual-origin-client');const other=await connect('actual-other-client');
if(mode==='invalid-session'){
 first.ws.send(JSON.stringify({type:'req',id:'wrong-session',method:'agent.send',params:{sessionId:'not-this-connection',message:'must not enter handler'}}));
 const deadline=Date.now()+2000;while(!first.frames.some(f=>f.type==='res'&&f.id==='wrong-session')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 const response=first.frames.find(f=>f.type==='res'&&f.id==='wrong-session');assert.equal(response.ok,false);assert.match(response.error.message,/session unavailable/);
 assert.equal(fs.existsSync('data/wal/memory_wal.json') ? JSON.parse(fs.readFileSync('data/wal/memory_wal.json','utf8')).length : 0,0);
 console.log(JSON.stringify({mode,wrong_reply_destination_refused:true,no_handler_execution:true}));process.exit(0);
}
if(mode==='route-once'){
 const origin=[...(gateway as any).connections.values()].find((entry:any)=>entry.conn.clientId==='actual-origin-client');
 const token=gateway.issueReplyRoute(origin.conn.id);assert.ok(token);
 const receipt=await gateway.deliverReply(token,'Authored local transport payload, not a model response');assert.ok(receipt);
 assert.equal(await gateway.deliverReply(token,'must never repeat'),null);
 await new Promise(resolve=>setTimeout(resolve,100));
 const frames=first.frames.filter(f=>f.type==='event'&&f.event==='session.message');assert.equal(frames.length,1);assert.equal(frames[0].payload.message.id,receipt);
 assert.equal(other.frames.filter(f=>f.type==='event'&&f.event==='session.message').length,0);
 console.log(JSON.stringify({mode,actual_transport_receipt_matches_received_frame:true,one_shot_route:true,not_cognition:true}));process.exit(0);
}
const marker=mode==='confirmation-early-return'?'RECHAZAR TODO':'authored-web-handler-request';
if(mode==='confirmation-early-return'){
 const {identityService}=await import('../../services/identityService');await identityService.init();
 const principal=await identityService.upsertUser({email:'signed-fixture@fixture.invalid',name:'Authored fixture principal'});
 const {channelIngress}=await import('../../services/security/ingressEnvelope');
 const connection=(gateway as any).connections.values();
 const origin=[...connection].find((entry:any)=>entry.conn.clientId==='actual-origin-client');
 const replyRoute=gateway.issueReplyRoute(origin.conn.id);assert.ok(replyRoute);
 const payload={channel:'web-ui',senderId:'signed-fixture-sender',messageId:'signed-fixture-message',principalId:principal.id,sessionId:first.sessionId,message:marker,replyRoute};
 const envelope=channelIngress.issue({channel:payload.channel,senderId:payload.senderId,messageId:payload.messageId,principalId:payload.principalId,conversationId:payload.sessionId,content:marker});
 await orchestrator.handleUserMessage({...payload,envelope});
}else first.ws.send(JSON.stringify({type:'req',id:'actual-web-request',idempotencyKey:'actual-key',method:'agent.send',params:{message:marker}}));
const deadline=Date.now()+10000;
while(!first.frames.some(f=>f.type==='event'&&f.event==='session.message')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
const replies=first.frames.filter(f=>f.type==='event'&&f.event==='session.message');
assert.equal(replies.length,1,'actual origin must receive one complete handler result');
if(mode==='confirmation-early-return')assert.match(replies[0].payload.message.content,/No tienes acciones pendientes/);
else assert.match(replies[0].payload.message.content,/API Key not found/,'real OFF-path output, not model cognition');
await new Promise(resolve=>setTimeout(resolve,120));
assert.equal(other.frames.filter(f=>f.type==='event'&&f.event==='session.message').length,0,'shared personal session must not broadcast this reply to another connection');
const entries=JSON.parse(fs.readFileSync('data/wal/memory_wal.json','utf8'));
const entry=entries.filter((e:any)=>e.data.input===marker).at(-1);assert.ok(entry);
if(mode==='post-delivery-wal-failed'){
 assert.equal(entry.status,'PENDING');assert.equal(fs.readFileSync(memory,'utf8'),'original authored memory bytes');
}else{
 assert.equal(entry.status,'COMMITTED');assert.equal(entry.data.metadata.deliveryReceipt.id,replies[0].payload.message.id);assert.equal(entry.data.metadata.deliveryReceipt.transport,'websocket');assert.ok(fs.readFileSync(memory,'utf8').includes(`WAL_COMMIT:${entry.id}`));
}
if(mode==='normal'){
 first.ws.send(JSON.stringify({type:'req',id:'duplicate-request',idempotencyKey:'actual-key',method:'agent.send',params:{message:'must not execute duplicate'}}));
 const deadline=Date.now()+2000;while(!first.frames.some(f=>f.type==='res'&&f.id==='duplicate-request')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(first.frames.find(f=>f.type==='res'&&f.id==='duplicate-request')?.ok);
 assert.equal(JSON.parse(fs.readFileSync('data/wal/memory_wal.json','utf8')).filter((e:any)=>e.data.input==='must not execute duplicate').length,0);
 other.ws.send(JSON.stringify({type:'req',id:'other-request',idempotencyKey:'actual-key',method:'agent.send',params:{message:'authored other connection request'}}));
 const end=Date.now()+15000;while(!other.frames.some(f=>f.type==='event'&&f.event==='session.message')&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(other.frames.filter(f=>f.type==='event'&&f.event==='session.message').length,1,'same idempotency key on another connection must not reuse first connection result');
 assert.equal(first.frames.filter(f=>f.type==='event'&&f.event==='session.message').length,1);
}
console.log(JSON.stringify({mode,actual_web_reply_count:replies.length,other_connection_reply_count:0,wal_status:entry.status,real_off_output_not_cognition:true,transport_message_id:replies[0].payload.message.id}));
first.ws.close();other.ws.close();gateway.shutdown();server.close();process.exit(0);
