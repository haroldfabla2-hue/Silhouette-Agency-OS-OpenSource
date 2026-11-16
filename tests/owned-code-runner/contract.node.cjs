const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
let runOwnedJsonChild, runnerPath, configureCodeResourceRoot;
before(async()=>{ ({runOwnedJsonChild,runnerPath,configureCodeResourceRoot}=await import('../../services/tools/ownedCodeRunner.js')); });
const entry = path.join(__dirname, 'fixture.cjs');
function run(mode, extra={}) {
 process.env.OWNED_TEST_MODE=mode;
 const result=runOwnedJsonChild({executable:process.execPath,entry,cwd:os.tmpdir(),payload:{code:'return args.result;',args:{result:'fixture-result'}},timeoutMs:400,termGraceMs:50,closeWaitMs:100,...extra});
 delete process.env.OWNED_TEST_MODE;return result;
}
async function rejected(promise,code,cleanup='closed') {
 await assert.rejects(promise,e=>{
  assert.equal(e.code,code);assert.equal(e.cleanup,cleanup);
  if(e.details?.pid&&cleanup==='closed')assert.throws(()=>process.kill(e.details.pid,0),{code:'ESRCH'});
  if(e.details){assert.ok(e.details.retainedOutputBytes<=1024*1024);if(code==='TIMEOUT'&&cleanup==='closed')assert.ok(['SIGTERM','SIGKILL'].includes(e.details.signal));if(code==='EXIT_STATUS')assert.ok(e.details.exitCode!==0||e.details.signal);}
  return true;
 });
}
test('actual code/args JSON payload valid child returns unchanged result shape',async()=>assert.equal(await run('valid'),'fixture-result'));
test('missing entry/executable reject',async()=>{await rejected(run('valid',{entry:'/no-owned-fixture'}),'EXIT_STATUS');await rejected(run('valid',{executable:'/no-owned-node'}),'SPAWN_ERROR');});
test('invalidJSON and nonzero successJSON fail',async()=>{await rejected(run('invalid'),'INVALID_JSON');await rejected(run('nonzero'),'EXIT_STATUS');await rejected(run('signal'),'EXIT_STATUS');});
test('existing CODE native JSON wire conversions preserved for COMPOSED and internal callers',async()=>{
 const shared={value:7}; const symbol=Symbol('ignored');
 const args={missing:undefined,date:new Date('2026-11-16T12:00:00Z'),buffer:Buffer.from('authored fixture'),custom:{toJSON(){return {converted:true};}},nan:NaN,infinity:Infinity,fn(){},arr:[undefined,()=>{},,NaN],shared1:shared,shared2:shared,get value(){return 9;},[symbol]:'ignored'};
 Object.defineProperty(args,'hidden',{value:'ignored',enumerable:false});
 const expected=JSON.parse(JSON.stringify({code:'return args;',args}));
 assert.deepEqual(await run('echo-payload',{payload:{code:'return args;',args}}),expected);
 assert.deepEqual(await run('echo-payload',{payload:{code:'return args;',args:undefined}}),{code:'return args;'});
});
test('previously uncapped legitimate code/string/depth not silently rejected',async()=>{
 let deep={leaf:true};for(let i=0;i<22;i++)deep={deep};
 const payload={code:'x'.repeat(128*1024+1),args:{large:'x'.repeat(512*1024+1),deep}};
 assert.deepEqual(await run('echo-payload',{payload}),JSON.parse(JSON.stringify(payload)));
});
test('serialization failures occur before spawn and explicit trusted input limit remains opt-in',async()=>{
 const cyclic={};cyclic.self=cyclic;
 for(const args of [cyclic,{big:1n},{get value(){throw Error('private fixture');}}])await rejected(run('echo-payload',{payload:{code:'x',args}}),'INPUT_SERIALIZATION','not-started');
 await rejected(run('echo-payload',{payload:{code:'x',args:{large:'authored fixture'}},maxInputBytes:8}),'INPUT_LIMIT','not-started');
});
test('arbitrary caller serialization throws never select diagnostics or escape fixed rejection',async()=>{
 const hostile={get code(){throw Error('must not read thrown properties');}};
 for(const thrown of [null,undefined,'caller text',{code:'INPUT_LIMIT'},hostile]){
  await rejected(run('echo-payload',{payload:{code:'x',args:{toJSON(){throw thrown;}}}}),'INPUT_SERIALIZATION','not-started');
 }
});
test('actual closed stdin rejects handled EPIPE and PID absent',async()=>{
 await assert.rejects(run('close-stdin',{payload:{code:'return args.big;',args:{big:'x'.repeat(500000)}}}),e=>{assert.ok(['STDIN_ERROR','STDIN_WRITE'].includes(e.code));assert.equal(e.cleanup,'closed');assert.throws(()=>process.kill(e.details.pid,0),{code:'ESRCH'});assert.ok(!e.message.includes('xxx'));return true;});
});
test('bounded user log data and separate execution error detail preserved',async()=>{
 const logs=[];assert.deepEqual(await run('logs',{payload:{code:'return args;',args:{value:7}},onLog:x=>logs.push(x)}),{value:7});
 assert.equal(logs[0],'visible fixture log');assert.equal(logs.at(-1),'[runner logs truncated]');assert.ok(logs.every(x=>typeof x==='string'));assert.ok(logs.length<=65);
 const longLogs=[];await run('longlogs',{onLog:x=>longLogs.push(x)});assert.deepEqual(longLogs,['[runner logs truncated]']);
 await assert.rejects(run('longerror',{onLog:()=>{}}),e=>e.code==='EXECUTION_ERROR'&&Buffer.byteLength(e.executionMessage)<=2048&&e.executionMessage.endsWith('[truncated]'));
 const errors=[];await assert.rejects(run('error',{onLog:x=>errors.push(x)}),e=>e.code==='EXECUTION_ERROR'&&e.executionMessage==='authored execution detail');assert.deepEqual(errors,['before failure']);
});
test('hang ignoredTERM flood await closed status and retained cap',async()=>{
 await rejected(run('hang'),'TIMEOUT');await rejected(run('ignore-term'),'TIMEOUT');
 await assert.rejects(run('flood',{maxOutputBytes:1024}),e=>{assert.equal(e.code,'OUTPUT_LIMIT');assert.equal(e.cleanup,'closed');assert.ok(e.details.retainedOutputBytes<=1024);assert.ok(e.details.observedOutputBytes>1024);assert.throws(()=>process.kill(e.details.pid,0),{code:'ESRCH'});return true;});
});
async function gone(pid,maxMs){const end=Date.now()+maxMs;while(Date.now()<end){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return true;throw e;}await new Promise(r=>setTimeout(r,20));}return false;}
test('held stdio is UNRESOLVED; real helper PID explicitly awaited/verified with bounded finally cleanup',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owned-held-pid-'));const file=path.join(dir,'pid');let helper;
 try {
  process.env.OWNED_HELPER_PID_FILE=file;
  const result=run('held-stdio',{timeoutMs:150,termGraceMs:20,closeWaitMs:20});delete process.env.OWNED_HELPER_PID_FILE;
  await rejected(result,'TIMEOUT','UNRESOLVED-no-close-after-force');helper=Number(fs.readFileSync(file,'utf8'));assert.ok(helper>0);
  assert.equal(await gone(helper,2500),true,'finite helper failed natural exit/reap');
 } finally {
  delete process.env.OWNED_HELPER_PID_FILE;
  if(!helper&&fs.existsSync(file))helper=Number(fs.readFileSync(file,'utf8'));
  if(helper&&!await gone(helper,0)){try{process.kill(helper,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}assert.equal(await gone(helper,1000),true,'UNRESOLVED fixture helper cleanup');}
  fs.rmSync(dir,{recursive:true,force:true});assert.equal(fs.existsSync(dir),false);
 }
});
test('native cwd default and trusted bootstrap root no tool-payload option',()=>{
 assert.equal(runnerPath(process.cwd()),path.join(process.cwd(),'scripts','sandbox_runner.js'));assert.throws(()=>runnerPath('/no-owned-root'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owned-resource-root-'));
 try{fs.mkdirSync(path.join(dir,'scripts'));fs.writeFileSync(path.join(dir,'scripts','sandbox_runner.js'),'// path fixture only');configureCodeResourceRoot(dir);assert.equal(runnerPath('/unrelated-cwd'),path.join(dir,'scripts','sandbox_runner.js'));assert.throws(()=>configureCodeResourceRoot(dir),/already configured/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});assert.equal(fs.existsSync(dir),false);}
});

test('default native CLI log sink remains visible as labeled bounded DATA',()=>{
 const {spawnSync}=require('node:child_process');
 const modulePath=path.resolve('services/tools/ownedCodeRunner.js');
 const program=`import {runOwnedJsonChild} from ${JSON.stringify('file://'+modulePath)}; await runOwnedJsonChild({executable:process.execPath,entry:${JSON.stringify(entry)},cwd:${JSON.stringify(os.tmpdir())},payload:{code:'return args;',args:{}}});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{env:{...process.env,OWNED_TEST_MODE:'singlelog'},encoding:'utf8',timeout:3000,maxBuffer:32768});
 assert.equal(result.status,0);assert.equal(result.signal,null);assert.equal(result.stdout,'[Sandbox Log] native CLI visible\n');assert.equal(result.stderr,'');
});
