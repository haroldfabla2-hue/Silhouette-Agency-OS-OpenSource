import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {VectorMemoryService} from '../../services/vectorMemoryService.ts';
const root=process.env.QDRANT_LIFECYCLE_ROOT!;
assert.ok(root?.startsWith('/tmp/qdrant-eval-20261112/'));
const url='http://127.0.0.1:16433',collection='public_lifecycle';
const log=fs.openSync(path.join(root,'qdrant.log'),'a');
let processHandle:ChildProcess|undefined;
async function start() {
 processHandle=spawn('/tmp/qdrant-eval-20261112/bin/qdrant',['--config-path',path.join(root,'config.yaml')],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root},stdio:['ignore',log,log]});
 const until=Date.now()+10000;
 while(Date.now()<until){try{if((await fetch(url+'/collections')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw new Error('isolated Qdrant start failed');
}
async function stop(){if(processHandle&&processHandle.exitCode===null){const exited=new Promise<void>(r=>processHandle!.once('exit',()=>r()));processHandle.kill('SIGTERM');await exited;}}
async function api(s:string,method='GET',body?:unknown){const r=await fetch(url+s,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
const a=new VectorMemoryService({url,collectionName:collection,enabled:async()=>true});
const steps:string[]=[];
try {
 assert.equal((await a.connect()).state,'unavailable');assert.equal(a.isReady(),false);steps.push('off_not_ready');
 await start();
 assert.equal((await a.getHealth()).status,'down');assert.equal((await api('/collections/'+collection)).status,404);steps.push('health_does_not_create_missing_collection');
 assert.equal((await a.connect()).state,'unavailable');assert.equal((await api('/collections/'+collection)).status,404);steps.push('connect_does_not_create_missing_collection');
 assert.equal((await api('/collections/'+collection,'PUT',{vectors:{size:768,distance:'Cosine'},wal_config:{wal_capacity_mb:1}})).status,200);
 const pair=await Promise.all([a.connect(),a.connect()]);assert.ok(pair.every(x=>x.state==='ready'));assert.ok(a.isReady());steps.push('same_adapter_ready_after_explicit_compatible_provision');
 const vector=Array(768).fill(0);vector[0]=1;
 await a.storeMemory('00000000-0000-4000-8000-000000000001',vector,{content:'Public lifecycle vector fixture',ownerId:'PUBLIC',timestamp:1});
 assert.equal((await a.searchMemory(vector,1))[0]?.id,'00000000-0000-4000-8000-000000000001');steps.push('public_uuid_store_query_no_model');
 await stop();await assert.rejects(()=>a.searchMemory(vector,1),/Qdrant is unavailable/);assert.equal(a.isReady(),false);steps.push('shutdown_operation_observable_and_readiness_false');
 await start();assert.equal((await a.connect()).state,'ready');assert.equal((await a.searchMemory(vector,1)).length,1);steps.push('same_adapter_recovers_after_restart_existing_data');
 await api('/collections/'+collection,'DELETE');await api('/collections/'+collection,'PUT',{vectors:{size:384,distance:'Cosine'},wal_config:{wal_capacity_mb:1}});
 const before=await api('/collections/'+collection);
 assert.equal((await a.connect()).state,'unavailable');assert.equal((await a.getHealth()).status,'down');assert.equal(a.isReady(),false);
 const after=await api('/collections/'+collection);assert.deepEqual(after.body.result.config,before.body.result.config);assert.equal(after.body.result.points_count,0);steps.push('incompatible_rejected_not_recreated_or_mutated');
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({scope:'isolated real Qdrant lifecycle only; no production data/canonical migration/models',steps},null,2));console.log(JSON.stringify({steps}));
}finally{await stop();fs.closeSync(log);}
