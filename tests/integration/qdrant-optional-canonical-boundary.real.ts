import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import ts from 'typescript';
import * as lance from '@lancedb/lancedb';
import {VectorMemoryService} from '../../services/vectorMemoryService.ts';
import {LanceDbService} from '../../services/lancedbService.ts';
const root=process.env.QDRANT_OPTIONAL_ROOT!;assert.ok(root?.startsWith('/tmp/qdrant-eval-20261112/'));
const repo=path.resolve(import.meta.dirname,'../..');const filename=path.join(repo,'services/continuumMemory.ts');const source=fs.readFileSync(filename,'utf8');
const begin=source.indexOf('                    try {\n                        const { vectorMemory }');
const end=source.indexOf('\n                }\n            } catch (err)',begin);assert.ok(begin>0&&end>begin);
const block=source.slice(begin,end);assert.ok(block.includes("console.warn('[CONTINUUM] Canonical deep memory retained; optional Qdrant projection unavailable.');"));assert.ok(!block.includes('lancedbService.store'));
assert.equal(source.slice(end,source.indexOf('// L3/L4',end)).match(/await lancedbService\.store\(nodeToStore\);/g)?.length,1);
const lines=[source.slice(0,begin).split('\n').length,source.slice(0,end).split('\n').length];const sourceSha=createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha,'d0e59370f99021a03ee3f0a45d8e693da62634bd43b7b49881cada7e64d3dbe5');
assert.deepEqual(lines,[519,531]);
assert.equal(createHash('sha256').update(block).digest('hex'),'ac1e33844714a5d66e513d5195c70cf89baa2aaf7cd8fa760560bf4633ba3f1c');
const importLine="const { vectorMemory } = await import('./vectorMemoryService');";
assert.equal(block.split(importLine).length,2);
// The only seam rewrites the module location to the same real exported adapter
// class instance with the isolated URL. No method/service/model is replaced.
const executable=block.replace(importLine,'const vectorMemory = backend;');
const js=ts.transpileModule(executable,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const executeBlock=new AsyncFunction('backend','nodeToStore','embedded',js);
const url='http://127.0.0.1:16437',collection='optional_boundary';
const log=fs.openSync(path.join(root,'qdrant.log'),'a');const q=spawn('/tmp/qdrant-eval-20261112/bin/qdrant',['--config-path',path.join(root,'config.yaml')],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root},stdio:['ignore',log,log]});
try{
 for(let i=0;i<100;i++){try{if((await fetch(url+'/collections')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const r=await fetch(url+'/collections/'+collection,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({vectors:{size:768,distance:'Cosine'},wal_config:{wal_capacity_mb:1}})});assert.ok(r.ok);
 const backend=new VectorMemoryService({url,collectionName:collection,enabled:async()=>true});assert.equal((await backend.connect()).state,'ready');
 const identity={model:'PUBLIC_BOUNDARY',version:'1',dimension:768};const vector=Array(768).fill(0);vector[0]=1;
 const node:any={id:'00000000-0000-4000-8000-000000000002',content:'Public canonical retained at optional failure boundary',tier:'DEEP',tags:['PUBLIC'],timestamp:1,importance:0.5,accessCount:0,lastAccess:1,embeddingIdentity:identity};
 const canonical=new LanceDbService(path.join(root,'lance'));await canonical.store(node,vector);
 const db=await lance.connect(path.join(root,'lance'));const snapshot=async()=>{
  const result:any={};for(const name of await db.tableNames()){const t=await db.openTable(name);const rows=await t.query().toArray();result[name]={version:await t.version(),digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),count:rows.length};}return result;
 };
 const before=await snapshot();assert.ok(Object.keys(before).some(k=>k.startsWith('memory_vectors_')));
 const exit=new Promise<void>(resolve=>q.once('exit',()=>resolve()));q.kill('SIGTERM');await exit;
 assert.ok(backend.isReady(),'no health/connect call may pre-clear readiness before branch');
 await executeBlock(backend,node,{vector,identity});
 assert.equal(backend.isReady(),false);const after=await snapshot();assert.deepEqual(after,before);assert.deepEqual(await canonical.getNodeById(node.id),node);
 const result={scope:'Exact optional try/catch block only plus static outer-catch boundary; not full Continuum.store/embedding/dispatch',sourceSha,lines,blockSha:createHash('sha256').update(block).digest('hex'),seam:'replace one module import with real isolated backend instance',readyBeforeBlock:true,unavailableAfterBlock:true,normalReturn:true,canonicalRowsVectorRowsVersionsDigestsIdentical:true,before,after};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(q.exitCode===null){q.kill('SIGTERM');await new Promise(r=>q.once('exit',r));}fs.closeSync(log);}
