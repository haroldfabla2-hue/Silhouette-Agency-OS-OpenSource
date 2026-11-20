/* Instrumentation only: bounded structured facts, never raw error/log content. */
import fs from 'node:fs';
const mode=process.argv[2];
if(!['write','read'].includes(mode))throw Error('OBSERVER_MODE');
const table=JSON.parse(fs.readFileSync('/app/diagnostic-source-table.json','utf8'));
const targets=JSON.parse(fs.readFileSync('/app/diagnostic-targets.json','utf8')).targets;
const classes=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','AssertionError','AggregateError']);
const codes=new Set(['ERR_ASSERTION','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_REQUIRE_ESM',
 'ERR_UNKNOWN_FILE_EXTENSION','ENOENT','EACCES','EPERM','EROFS','ENOSPC','EIO','ENOMEM','EMFILE','ENFILE',
 'SQLITE_ERROR','SQLITE_CANTOPEN','SQLITE_READONLY','SQLITE_FULL','SQLITE_IOERR','SQLITE_BUSY','SQLITE_LOCKED']);
const markers=new Set(['IMPORT_ENTRY','RUN_PHASE','GUARD','RUNTIME_IMPORT','NARRATIVE_IMPORT','OWNERS_IMPORT',
 'ADMISSIONS','ADMISSIONS_SETTLED','PRESERVE_RECEIPT','OWNERS_CLOSE','MEMORY_CLOSE','NERVOUS_CLOSE','GRAPH_CLOSE',
 'REDIS_CLOSE','SQLITE_CLOSE','RAW_MEMORY_WRITE','RAW_MEMORY_READ','COMPLETE']);
const sites=new Set(['TOP_LEVEL','ADMISSION_0','ADMISSION_1','ORACLE_PRIMARY','OWNERS_CLOSE','MEMORY_CLOSE',
 'NERVOUS_CLOSE','GRAPH_CLOSE','REDIS_CLOSE','SQLITE_CLOSE','FATAL_MONITOR']);
const doc={schemaVersion:1,mode,checkpoint:'IMPORT_ENTRY',checkpoints:[],errors:[],outcome:'RUNNING',framesOmitted:false,fatalObservation:{seen:false,origin:'NONE'},exitObservation:{seen:false,code:null},journalComparison:null};
let persistenceFailed=false;
function persistBestEffort(){
 try{
  const raw=JSON.stringify(doc)+'\n';if(Buffer.byteLength(raw)>16384)return;
  fs.writeFileSync('/tmp/'+mode+'-diagnostic.tmp',raw,{mode:0o600});
  fs.renameSync('/tmp/'+mode+'-diagnostic.tmp','/tmp/'+mode+'-diagnostic.json');
 }catch{}
}
function persistStrict(){
 try{
  const raw=JSON.stringify(doc)+'\n';if(Buffer.byteLength(raw)>16384)throw Error('OBSERVER_BOUND');
  fs.writeFileSync('/tmp/'+mode+'-diagnostic.tmp',raw,{mode:0o600});
  fs.renameSync('/tmp/'+mode+'-diagnostic.tmp','/tmp/'+mode+'-diagnostic.json');
 }catch{persistenceFailed=true;process.exitCode=1;}
}
function checkpoint(value){
 if(!markers.has(value))return;
 doc.checkpoint=value;if(doc.checkpoints.length<24)doc.checkpoints.push(value);persistStrict();
}
function moduleIdentity(error){
 const value={status:'UNMATCHED',targetId:null,importerStatus:'UNKNOWN'};
 try{
  if(error?.code!=='ERR_MODULE_NOT_FOUND'||typeof error.url!=='string')return value;
  const raw=error.url;
  // Reject encoded path segments, credentials/hosts, query/hash and traversal
  // before URL canonicalization can erase their source spelling.
  if(!raw.startsWith('file:///app/')||raw.includes('%')||raw.includes('?')||raw.includes('#'))return value;
  if(raw.slice('file://'.length).split('/').some(p=>p==='.'||p==='..'))return value;
  const url=new URL(raw);
  if(url.protocol!=='file:'||url.hostname||url.username||url.password||url.search||url.hash)return value;
  if(!url.pathname.startsWith('/app/')||url.href!==raw)return value;
  const target=targets.find(row=>row.path===url.pathname);
  if(target)return {status:'MATCHED',targetId:target.targetId,importerStatus:'UNKNOWN'};
 }catch{}
 return value;
}
function errorAt(site,error,bestEffort=false){
 if(!sites.has(site)||doc.errors.length>=8)return;
 const row={site,exceptionClass:classes.has(error?.name)?error.name:'OtherException',
   code:codes.has(error?.code)?error.code:'OTHER',frames:[],framesOmitted:false,moduleIdentity:moduleIdentity(error)};
 // Parse location suffixes only. Never export message, arguments or raw stack.
 const stack=typeof error?.stack==='string'?error.stack:'';
 for(const line of stack.split('\n').slice(1,33)){
  const match=/^\s+at (?:[^()]*\()?((?:file:\/\/)?\/app\/[A-Za-z0-9_./+-]+):(\d+):(\d+)\)?$/.exec(line);
  if(!match){row.framesOmitted=true;continue;}
  const path=match[1].replace(/^file:\/\//,'');const entry=table.find(v=>v.path===path);
  const n=Number(match[2]),column=Number(match[3]);
  if(!entry||n<1||n>entry.lines||column<1||column>1000000){row.framesOmitted=true;continue;}
  if(row.frames.length<4)row.frames.push({moduleId:entry.moduleId,line:n,column});
  else row.framesOmitted=true;
 }
 if(!row.frames.length)row.framesOmitted=true;
 doc.framesOmitted ||= row.framesOmitted;doc.errors.push(row);
 if(bestEffort)persistBestEffort();else persistStrict();
}
// Native monitor observes, never intercepts or changes Node's fatal policy.
process.on('uncaughtExceptionMonitor',(error,origin)=>{
 try{
  doc.fatalObservation={seen:true,origin:origin==='uncaughtException'||origin==='unhandledRejection'?origin:'OTHER'};
  errorAt('FATAL_MONITOR',error,true);persistBestEffort();
 }catch{}
});
process.on('exit',code=>{
 try{
  doc.exitObservation={seen:true,code:Number.isInteger(code)&&code>=0&&code<=255?code:null};
  persistBestEffort();
 }catch{}
});
globalThis[Symbol.for('narrative.direct.observer')]=Object.freeze({checkpoint,errorAt,journalComparison(value){doc.journalComparison=value;persistStrict();}});
try{
 checkpoint('IMPORT_ENTRY');
 const {runPhase}=await import('/app/entry.INACTIVE.mjs');
 checkpoint('RUN_PHASE');await runPhase(mode);
 checkpoint('COMPLETE');doc.outcome='RETURNED';persistStrict();
 if(persistenceFailed)process.exitCode=1;
}catch(error){
 errorAt('TOP_LEVEL',error);doc.outcome='THREW';persistStrict();
 throw error; // Preserve failure and natural nonzero exit. Never process.exit().
}
