'use strict';
// Trusted supervisor. No resolver tooling imports here. Host must pin this bootstrap and identities digest.
const cp=require('node:child_process'),fs=require('node:fs'),crypto=require('node:crypto');
const stage=process.argv[2],expectedIdentity=process.argv[3];
if(!['NODE','TSX','VITE_OPTIONAL'].includes(stage)||!/^[a-f0-9]{64}$/.test(expectedIdentity||''))throw Error('R_STAGE_IDENTITY_ARGUMENT');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const started=performance.now();
const CHILD_FAILURES=["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "MODULE_NOT_FOUND", "R_ASYNC_GUARD_READY", "R_ASYNC_GUARD_SNAPSHOT", "R_ASYNC_GUARD_SNAPSHOT_TIMEOUT", "R_ASYNC_GUARD_TIMEOUT", "R_ASYNC_LOAD_CAP", "R_ASYNC_UNEXPECTED_LOAD", "R_BAD_COMPILE", "R_COMPILE_CONTENT_IDENTITY", "R_CONDITION_CONTROL", "R_LOAD_CONTROL", "R_LOAD_COUNT_CAP", "R_LOAD_DENIED", "R_LOAD_IDENTITY", "R_MISSING_CONTROL", "R_MODE_RUNTIME", "R_NATIVE_EXTENSION_CONTROL", "R_NATIVE_LOAD_COUNT", "R_NON_PATH", "R_PARENT_ABSENT", "R_POST_CONTROL_BOUNDARY_VIOLATION", "R_PRE_CONTROL_BOUNDARY_VIOLATION", "R_PRIVATE_EXPORT_CONTROL", "R_RAW_FD_READ_DENIED", "R_READ_COMPILE_CONTROL", "R_READ_COMPILE_LEDGER", "R_SOURCE_CODE_READ_DENIED", "R_SYNTHETIC_CJS_SENTINEL_EXECUTED_LOAD_GUARD_BROKEN", "R_SYNTHETIC_SENTINEL_EXECUTED_LOAD_GUARD_BROKEN", "R_TARGET_MISSING", "R_TARGET_OUTSIDE_SOURCE", "R_TARGET_SELECTION", "R_TARGET_SYMLINK", "R_TOOL_PROCESS_DENIED", "R_UNAPPROVED_CODE_READ", "R_UNCLASSIFIED", "R_UNEXPECTED", "R_UNEXPECTED_BOUNDARY_VIOLATION", "R_VITE_RESOLUTION", "R_VITE_VERSION", "R_WRONG_CONTENT_EXECUTED"];
let terminal=false;let childFailureCode='R_UNCLASSIFIED';
let identity,preHash,child,stdout=[],stderr=[],out=0,err=0;
function failure(predicate){if(terminal)return;terminal=true;process.stdout.write(JSON.stringify({schema:1,stage,status:'INCOMPLETE',failurePredicate:predicate,childFailureCode,runtimeAcceptance:false,rawErrorsWithheld:true})+'\n');process.exitCode=125;}
function verify(){
 const bytes=fs.readFileSync('/control/identities.json');if(bytes.length>16777216||hash(bytes)!==expectedIdentity)throw Error('R_IDENTITY_MANIFEST_HASH');
 const map=JSON.parse(bytes);if(map.schema!==1||map.stage!==stage||Object.keys(map.roots).sort().join(',')!=='/control,/denied,/source,/tooling')throw Error('R_IDENTITY_MANIFEST_SCHEMA');
 const verifyStarted=performance.now();const verified={};let files=0,totalBytes=0;
 const deadline=()=>{if(performance.now()-verifyStarted>80000||performance.now()-started>240000)throw Error('R_AGGREGATE_INVENTORY_DEADLINE');};
 deadline();
 for(const [root,expected] of Object.entries(map.roots)){
  const actual={};let entries=0;
  const visit=folder=>{
   deadline();const stat=fs.lstatSync(folder);if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(folder)!==folder)throw Error('R_IDENTITY_DIRECTORY');
   for(const name of fs.readdirSync(folder).sort()){
    if(++entries>150000)throw Error('R_IDENTITY_ENTRY_CAP');
    const p=folder+'/'+name;if(root==='/control'&&p==='/control/identities.json')continue;
    const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('R_IDENTITY_SYMLINK');
    if(s.isDirectory()){visit(p);continue;}
    if(!s.isFile()||++files>100000||fs.realpathSync(p)!==p)throw Error('R_IDENTITY_FILE_CAP_OR_TYPE');
    totalBytes+=s.size;if(s.size>134217728||totalBytes>2147483648)throw Error('R_INVENTORY_BYTE_CAP');
    deadline();actual[p]=hash(fs.readFileSync(p));deadline();
   }
  };visit(root);
  const keys=Object.keys(actual).sort();if(JSON.stringify(keys)!==JSON.stringify(Object.keys(expected).sort())||keys.some(k=>actual[k]!==expected[k]))throw Error('R_IDENTITY_VIEW_DRIFT');
  verified[root]={files:keys.length,digest:hash(Buffer.from(JSON.stringify(keys.map(k=>[k,actual[k]]))))};
 }
 deadline();identity=map;return verified;
}
try{preHash=verify();}catch{failure('R_PREHASH_FAILED');return;}
child=cp.spawn('/usr/local/bin/node',['--max-old-space-size=2560','--experimental-import-meta-resolve','/control/probe.mjs',stage],{cwd:'/source',env:process.env,stdio:['ignore','pipe','pipe']});
const stop=setTimeout(()=>child.kill('SIGKILL'),60000);
child.stdout.on('data',b=>{out+=b.length;if(out>131072)child.kill('SIGKILL');else stdout.push(b);});
child.stderr.on('data',b=>{err+=b.length;if(err>16384)child.kill('SIGKILL');else stderr.push(b);});
child.on('error',()=>failure('R_CHILD_SPAWN'));
child.on('close',(code,signal)=>{
 if(terminal)return;
 clearTimeout(stop);let postHash;
 try{postHash=verify();if(JSON.stringify(preHash)!==JSON.stringify(postHash))throw Error('drift');}catch{failure('R_POSTHASH_FAILED');return;}
 if(code!==0||signal||out>131072||err>16384){const message=Buffer.concat(stderr).toString();childFailureCode=CHILD_FAILURES.find(code=>message.includes(code))||'R_UNCLASSIFIED';failure('R_CHILD_FAILED_OR_OUTPUT_CAP');return;}
 let result;try{result=JSON.parse(Buffer.concat(stdout).toString());}catch{failure('R_CHILD_JSON');return;}
 if(result.mode!==stage||result.status!=='ROUTING_ASSERTIONS_MATCHED'||result.runtimeBehaviorAccepted!==false||result.productModuleEvaluated!==false||result.targetDependencyModuleEvaluated!==false){failure('R_CHILD_SCHEMA');return;}
 for(const row of result.rows)for(const key of ['import','require']){
  const value=row[key];if(!value?.exists)continue;
  const full='/source/'+value.relative,expected=identity.roots['/source'][full];
  if(performance.now()-started>240000||!expected||hash(fs.readFileSync(full))!==expected){failure('R_TARGET_POSTHASH');return;}
  value.sha256=expected;
 }
 result.inputIdentities={manifestSha256:expectedIdentity,preHash,postHash,fullExactViewPrePostVerified:true,sourceCommit:'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53',qdrantView:'EXACT_7_FILE_CANDIDATE_OVERLAY_NOT_PRISTINE_BASELINE',targetHashReadByTrustedSupervisorOnly:true};
 if(terminal)return;terminal=true;process.stdout.write(JSON.stringify(result)+'\n');
});
