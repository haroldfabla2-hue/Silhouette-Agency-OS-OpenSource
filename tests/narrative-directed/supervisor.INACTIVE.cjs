'use strict';
/* Trusted capsule PID1, INACTIVE. No imports of product at this boundary. */
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
let progressPhase='PRE_RELEASE';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function census(){
 const names=fs.readdirSync('/proc').filter(name=>/^[0-9]+$/.test(name));
 const identities=names.map(name=>{
  const raw=fs.readFileSync('/proc/'+name+'/stat','utf8');
  const end=raw.lastIndexOf(')');assert.ok(end>0);
  const fields=raw.slice(end+2).trim().split(/\s+/);assert.ok(fields.length>=20);
  return [Number(name),fields[19]];
 });
 identities.sort((a,b)=>a[0]-b[0]);return identities;
}
async function onlySupervisor(){
 const first=census();await delay(10);const second=census();
 assert.deepEqual(first,second,'namespace census changed');
 assert.deepEqual(second.map(row=>row[0]),[1],'descendant remains after child close');
}
function phase(mode){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=192','--input-type=module','-e',
   "import {runPhase} from '/app/entry.INACTIVE.mjs'; await runPhase(process.argv[1]);",mode],{
   cwd:'/work',env:{PATH:'/usr/bin:/bin',LC_ALL:'C',HOME:'/work',TMPDIR:'/tmp',NODE_ENV:'test',
    SILHOUETTE_PROVIDERS:'off',SILHOUETTE_BOOT_MODE:'normal',
    SILHOUETTE_DB_PATH:'/work/db/silhouette.sqlite',SILHOUETTE_MIGRATIONS_DIR:'/app/db/migrations/sqlite'},
   stdio:['ignore','pipe','pipe']});
  let outputBytes=0,stdout='',failed=false,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},45000);
  const capture=(stream,raw)=>{
   outputBytes+=raw.length;
   if(outputBytes>65536){failed=true;child.kill('SIGKILL');return;}
   // Bounded raw fixture logs remain local, never the artifact by default.
   fs.appendFileSync('/work/'+mode+'.log',stream+raw.toString());
   if(stream==='OUT ')stdout+=raw.toString();
  };
  child.stdout.on('data',raw=>capture('OUT ',raw));
  child.stderr.on('data',raw=>capture('ERR ',raw));
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',async(code,signal)=>{
   clearTimeout(timer);
   try{
    assert.ok(!timedOut&&!failed);assert.equal(signal,null);assert.equal(code,0);
    const rows=stdout.split('\n').filter(line=>line.startsWith('NARRATIVE_PHASE '));
    assert.equal(rows.length,1);
    assert.deepEqual(JSON.parse(rows[0].slice(16)),{mode,originalWorkEqual:true,preserved:2,lateRefused:true});
    await onlySupervisor();
    resolve({mode,naturalExit:true,exitCode:code,pipesClosed:true,namespaceCensusOnlySupervisor:true,outputBytes});
   }catch(error){reject(error);}
  });
 });
}
async function release(){
 // Fixed token, no arbitrary command/script. Product never runs before host
 // inspect/proc checks and the external watchdog are armed.
 let raw='';
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('HOST_RELEASE_TIMEOUT')),15000);
  process.stdin.setEncoding('utf8');
  const data=value=>{
   raw+=value;
   if(raw.length>8){clearTimeout(timer);reject(Error('RELEASE_PROTOCOL'));return;}
   if(raw.includes('\n')){clearTimeout(timer);process.stdin.off('data',data);resolve();}
  };
  process.stdin.on('data',data);process.stdin.once('end',()=>{if(!raw.includes('\n'))reject(Error('RELEASE_EOF'));});
 });
 assert.equal(raw,'RUN\n');process.stdin.destroy();
}
async function runDirected(){
 assert.equal(process.pid,1);assert.equal(process.getuid(),1000);
 fs.mkdirSync('/work/db',{recursive:true});
 fs.writeFileSync('/work/silhouette.config.json',JSON.stringify({system:{env:'test',port:33005},
  modules:{graph:false,vectorDB:false,redis:false,browser:false},
  autonomy:{enabled:false,allowEvolution:false,enableNarrative:false,enableIntrospection:false},
  scheduler:{enabled:false},llm:{providers:{},fallbackChain:[]},brain:{enabled:false}}));
 await onlySupervisor();await release();
 progressPhase='WRITE';
 const writer=await phase('write');
 const original=fs.readFileSync('/work/data/wal/pending-narrations.json');
 const journal=JSON.parse(original);assert.equal(journal.items.length,2);
 assert.ok(!fs.existsSync('/work/data/wal/.pending-narrations.owner'),'writer ownership lock remains');
 progressPhase='READ';
 const reader=await phase('read');
 const recovered=fs.readFileSync('/work/data/wal/pending-narrations.json');
 assert.deepEqual(JSON.parse(recovered),journal,'fresh process changed original IDs or fields');
 assert.ok(!fs.existsSync('/work/data/wal/.pending-narrations.owner'));
 await onlySupervisor();
 progressPhase='TERMINAL_EVIDENCE';
 process.stdout.write('NARRATIVE_BATCH '+JSON.stringify({kind:'DIRECTED_REAL_NARRATIVE',phases:[writer,reader],
  journalSha256:hash(original),recoveredSha256:hash(recovered),sameOriginalIdsAndFields:true,
  forcedCleanup:false,providersOff:true,scope:'Narrative-only-not-full-app-or-raw-memory-durability'})+'\n');
}
exports.runDirected=async function(){
 try{return await runDirected();}
 catch(error){
  process.stdout.write('NARRATIVE_FAILURE '+JSON.stringify({phase:progressPhase,
   exceptionClass:['AssertionError','Error','TypeError','SyntaxError','RangeError'].includes(error?.constructor?.name)?error.constructor.name:'OtherException',
   reason:error?.code==='ERR_MODULE_NOT_FOUND'?'MODULE_NOT_FOUND':error?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'PHASE_EXCEPTION'})+'\n');
  throw error;
 }
};
if(require.main===module)throw Error('INACTIVE_REQUIRES_REVIEWED_HOST_ADAPTER');
