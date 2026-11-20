// PREPARED ONLY: actual compatible client against authored localhost HTTP protocol.
// No provider credentials, paid endpoint or mocked client success.
import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {OpenAICompatibleClient} from '../../services/llm/openAICompatible.ts';
import {createTaskEvidence} from '../../services/execution/taskEvidence.ts';
import {observeProviderAttempts} from '../../services/usageObservation.ts';
test('real loopback protocol completion, HTTP failure, partial SSE and secret pre-send denial accounting',async()=>{
 const requests=[];let mode='complete';const server=http.createServer(async(req,res)=>{
  let body='';for await(const b of req)body+=b;requests.push(JSON.parse(body));
  if(mode==='error'){res.writeHead(503);res.end('authored failure');return;}
  if(mode==='invalid'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{invalid authored');return;}
  if(mode==='stream'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'authored'},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:4}})+'\n\ndata: [DONE]\n\n');return;}
  if(mode==='partial'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: {"choices":[{"delta":{"content":"authored"}}]}\n\n');return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:'fixture',choices:[{message:{content:'authored response'}}],usage:{prompt_tokens:3,completion_tokens:2}}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const provider={id:'fixture',transport:'openai-compatible',baseUrl:url,apiKeyEnv:'AUTHORED_FIXTURE_KEY',model:'fixture',discovery:false};
 const client=new OpenAICompatibleClient({AUTHORED_FIXTURE_KEY:'authored-nonsecret-fixture'});const task=createTaskEvidence('actual-protocol');const events=[];const stop=observeProviderAttempts(e=>events.push(e));
 try{await task.run(async()=>{
  assert.equal((await client.complete(provider,[{role:'user',content:'ordinary authored prompt fixture@example.invalid'}])).text,'authored response');
  mode='error';await assert.rejects(client.complete(provider,[{role:'user',content:'ordinary'}]),/HTTP 503/);
  mode='partial';await assert.rejects(async()=>{for await(const chunk of client.stream(provider,[{role:'user',content:'ordinary'}]))assert.equal(chunk.type,'text');},/truncated stream/);
  mode='stream';for await(const chunk of client.stream(provider,[{role:'user',content:'ordinary'}])) assert(['text','finish'].includes(chunk.type));
  mode='invalid';await assert.rejects(client.complete(provider,[{role:'user',content:'ordinary'}]),/invalid JSON/);
  mode='partial';for await(const chunk of client.stream(provider,[{role:'user',content:'ordinary'}])){assert.equal(chunk.type,'text');break;}
  const count=requests.length;await assert.rejects(client.complete(provider,[{role:'user',content:'ordinary'}],{tools:[{type:'function',function:{name:'authored',description:'password=authoredfixture',parameters:{}}}]}),/DATA_FLOW_DENIED/);assert.equal(requests.length,count);
  await assert.rejects(client.complete(provider,[{role:'user',content:'password=authoredfixture'}]),/DATA_FLOW_DENIED/);assert.equal(requests.length,count);
 });
 assert.equal(task.snapshot().attempts.length,7);assert.deepEqual(task.snapshot().attempts.map(x=>x.outcome),['completed','failed','partial','completed','failed','cancelled','failed']);assert.equal(task.snapshot().attempts[3].inputTokens,7);assert.equal(task.snapshot().attempts[3].outputTokens,4);
 assert.equal(new Set(events.map(e=>e.invocationId)).size,7);assert.equal(task.snapshot().attempts[0].inputTokens,3);assert.equal(task.snapshot().estimatedUsd,null);
 }finally{stop();await new Promise(resolve=>server.close(resolve));}
});
