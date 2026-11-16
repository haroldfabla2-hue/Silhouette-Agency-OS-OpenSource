'use strict';
// Host-pinned supervisor. No build tooling imports here. Host must pin this bootstrap and identities digest.
const cp=require('node:child_process'),fs=require('node:fs'),crypto=require('node:crypto');
const stage=process.argv[2],expectedIdentity=process.argv[3];
if(!['SSR'].includes(stage)||!/^[a-f0-9]{64}$/.test(expectedIdentity||''))throw Error('R_STAGE_IDENTITY_ARGUMENT');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const started=performance.now();
const CHILD_FAILURES=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED','SSR_BOUNDARY_LOAD','SSR_BOUNDARY_SPAWN_SCOPE','SSR_BOUNDARY_SERVICE_KILL','SSR_BOUNDARY_NETWORK','SSR_BOUNDARY_CONFIG_AST_KIND','SSR_BOUNDARY_READ_ROOT','SSR_BOUNDARY_WORKER'];
let terminal=false;let childFailureCode='R_UNCLASSIFIED';
let identity,preHash,child,stdout=[],stderr=[],out=0,err=0;
let childState='NOT_STARTED',spawnThrow=false,childErrorObserved=false,childClosed=false,childCode=null,childSignal=null,timeoutFired=false;
let retainedOut=0,retainedErr=0,countsClamped=false;
const COUNT_MAX=2147483648;
function observed(previous,bytes){if(previous>COUNT_MAX-bytes){countsClamped=true;return COUNT_MAX;}return previous+bytes;}
function parseDocument(){
 const bytes=Buffer.concat(stdout);if(bytes.length===0)return {status:'EMPTY'};
 try{const value=JSON.parse(bytes.toString('utf8'));return value!==null&&typeof value==='object'&&!Array.isArray(value)?{status:'JSON_OBJECT',value}:{status:'JSON_NONOBJECT'};}catch{return {status:'INVALID_JSON'};}
}
function childDiagnostic(parsed){return {state:childState,spawnThrow,childErrorObserved,closed:childClosed,exitCode:childCode,signal:childSignal,stdoutObservedBytes:out,stdoutRetainedBytes:retainedOut,stderrObservedBytes:err,stderrRetainedBytes:retainedErr,countsClamped,stdoutCapExceeded:out>131072,stderrCapExceeded:err>16384,timeoutFired,stdoutParse:parsed.status};}
function failure(predicate){if(terminal)return;terminal=true;const parsed=parseDocument();const buildFailure=parsed.status==='JSON_OBJECT'?parsed.value:undefined;process.stdout.write(JSON.stringify({buildFailure,childDiagnostic:childDiagnostic(parsed),schema:1,stage,status:'INCOMPLETE',failurePredicate:predicate,childFailureCode,runtimeAcceptance:false,rawErrorsWithheld:true})+'\n');process.exitCode=125;}
function verify(){
 const bytes=fs.readFileSync('/control/identities.json');if(bytes.length>16777216||hash(bytes)!==expectedIdentity)throw Error('R_IDENTITY_MANIFEST_HASH');
 const map=JSON.parse(bytes);if(map.schema!==1||map.stage!==stage||Object.keys(map.roots).sort().join(',')!=='/control,/denied,/source')throw Error('R_IDENTITY_MANIFEST_SCHEMA');
 const verifyStarted=performance.now();const verified={};let files=0,totalBytes=0;
 const deadline=()=>{if(performance.now()-verifyStarted>80000||performance.now()-started>240000)throw Error('R_AGGREGATE_INVENTORY_DEADLINE');};
 deadline();
 for(const [root,expected] of Object.entries(map.roots)){
  const actual={};let entries=0;
  const visit=folder=>{
   deadline();const stat=fs.lstatSync(folder);if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(folder)!==folder)throw Error('R_IDENTITY_DIRECTORY');
   for(const name of fs.readdirSync(folder).sort()){
    if(++entries>150000)throw Error('R_IDENTITY_ENTRY_CAP');
    const p=folder+'/'+name;if(root==='/source'&&(p==='/source/dist'||p==='/source/node_modules/.vite-temp'))continue;if(root==='/control'&&p==='/control/identities.json')continue;
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
try{child=cp.spawn('/usr/local/bin/node',['--max-old-space-size=2560','/control/build.mjs',stage],{cwd:'/source',env:process.env,stdio:['ignore','pipe','pipe']});childState='SPAWNED';}catch{spawnThrow=true;childState='SPAWN_THROW';failure('R_CHILD_SPAWN_THROW');return;}
const stop=setTimeout(()=>{if(terminal)return;timeoutFired=true;child.kill('SIGKILL');},180000);
child.stdout.on('data',b=>{if(terminal)return;out=observed(out,b.length);if(out>131072)child.kill('SIGKILL');else{stdout.push(b);retainedOut+=b.length;}});
child.stderr.on('data',b=>{if(terminal)return;err=observed(err,b.length);if(err>16384)child.kill('SIGKILL');else{stderr.push(b);retainedErr+=b.length;}});
child.on('error',()=>{if(terminal)return;childErrorObserved=true;childState='CHILD_ERROR';});
child.on('close',(code,signal)=>{
 clearTimeout(stop);if(terminal)return;
 childClosed=true;childState='CLOSED';childCode=code;childSignal=signal;
 let postHash;
 try{postHash=verify();if(JSON.stringify(preHash)!==JSON.stringify(postHash))throw Error('drift');}catch{failure('R_POSTHASH_FAILED');return;}
 if(childErrorObserved||timeoutFired||code!==0||signal||out>131072||err>16384){const parsed=parseDocument();try{if(parsed.status==='JSON_OBJECT'&&parsed.value.stage==='SSR')fs.writeFileSync('/tmp/failed-build-receipt.json',JSON.stringify(parsed.value));}catch{}const message=Buffer.concat(stderr).toString();childFailureCode=CHILD_FAILURES.find(code=>message.includes(code))||'R_UNCLASSIFIED';failure(timeoutFired?'R_CHILD_TIMEOUT':out>131072?'R_CHILD_STDOUT_CAP':err>16384?'R_CHILD_STDERR_CAP':childErrorObserved?'R_CHILD_ERROR':signal?'R_CHILD_SIGNAL':'R_CHILD_EXIT');return;}
 const parsed=parseDocument();if(parsed.status!=='JSON_OBJECT'){failure('SSR_CHILD_JSON');return;}const result=parsed.value;
 if(result.stage!=='SSR'||result.status!=='SSR_BUILD_RETURNED'||result.runtimeAcceptance!==false||result.typeAcceptance!==false||result.generatedServerEvaluated!==false||result.targetPackageEvaluated!==false){failure('SSR_BUILD_DID_NOT_RETURN');return;}
 if(result.boundary?.violations!==7||result.boundary.nativeLoads!==1||result.boundary.spawnCount!==1||result.boundary.configLoads!==1||result.boundary.service?.code!==0||result.boundary.service?.signal){failure('SSR_BOUNDARY_RECEIPTS');return;}
 // Read actual emitted bytes ONLY as data. Reject extras/omissions/path traversal/symlinks.
 const outputs={};const writableRoots={};let outputBytes=0,outputCount=0;
 function inventoryWritable(root){
  const files={},directories=[];let totalBytes=0,entries=0;
  const visit=folder=>{const d=fs.lstatSync(folder);if(!d.isDirectory()||d.isSymbolicLink()||fs.realpathSync(folder)!==folder)throw Error('SSR_WRITABLE_ROOT_TYPE');
   for(const name of fs.readdirSync(folder).sort()){
    if(++entries>4096)throw Error('SSR_WRITABLE_ENTRY_CAP');
    const p=folder+'/'+name,s=fs.lstatSync(p),rel=p.slice(root.length+1);
    if(s.isSymbolicLink()||fs.realpathSync(p)!==p)throw Error('SSR_WRITABLE_SYMLINK');
    if(s.isDirectory()){directories.push(rel);visit(p);continue;}
    if(!s.isFile()||s.size>16777216||(totalBytes+=s.size)>50331648)throw Error('SSR_WRITABLE_FILE_CAP');
    files[rel]={sha256:hash(fs.readFileSync(p)),bytes:s.size};
   }
  };visit(root);return {files,directories,totalBytes};
 }
 const readOutput=()=>{
  const dist=inventoryWritable('/source/dist'),temp=inventoryWritable('/source/node_modules/.vite-temp'),tmp=inventoryWritable('/tmp'),shm=inventoryWritable('/dev/shm');
  // No unexplained distsiblings, nonserverdirectories or temp remnants qualify.
  if(dist.directories.some(d=>d!=='server'&&!d.startsWith('server/'))||Object.keys(dist.files).some(f=>!f.startsWith('server/')))throw Error('SSR_DIST_SIBLING');
  if(temp.directories.length||Object.keys(temp.files).length||tmp.directories.length||Object.keys(tmp.files).length||shm.directories.length||Object.keys(shm.files).length)throw Error('SSR_UNEXPLAINED_TEMP_LEFTOVER');
  for(const [rel,row]of Object.entries(dist.files)){if(++outputCount>2048)throw Error('SSR_OUTPUT_CAP');outputs[rel.slice('server/'.length)]=row;outputBytes+=row.bytes;}
  writableRoots['/source/dist']={...dist,classification:'EXPECTED_SERVER_OUTPUT_ONLY'};
  writableRoots['/source/node_modules/.vite-temp']={...temp,classification:'CONFIG_TEMP_REMOVED'};
  writableRoots['/tmp']={...tmp,classification:'EMPTY_NO_UNEXPLAINED_TEMP'};
  writableRoots['/dev/shm']={...shm,classification:'UNCHANGED_16M_SHM_EMPTY'};
 };

 try{readOutput();
 const expected=new Set(result.artifact.chunks.map(c=>c.file));
 for(const c of result.artifact.chunks){const o=outputs[c.file];if(!o||o.sha256!==c.sha256||o.bytes!==c.bytes)throw Error('SSR_CHUNK_POSTHASH');}
 const publicAssets=JSON.parse(fs.readFileSync('/control/public-assets.json','utf8'));
 for(const [p,d] of Object.entries(publicAssets)){
  const rel=p.slice('/source/public/'.length);if(expected.has(rel))throw Error('SSR_PUBLIC_OUTPUT_COLLISION');expected.add(rel);if(!outputs[rel]||outputs[rel].sha256!==d)throw Error('SSR_PUBLIC_COPY_MISMATCH');
 }
 if(Object.keys(outputs).some(k=>!expected.has(k)))throw Error('SSR_UNATTRIBUTED_OUTPUT');
 const expectedDirs=new Set(['server']);for(const f of expected){let pieces=('server/'+f).split('/');pieces.pop();while(pieces.length){expectedDirs.add(pieces.join('/'));pieces.pop();}}
 if(writableRoots['/source/dist'].directories.some(d=>!expectedDirs.has(d)))throw Error('SSR_UNEXPLAINED_EMPTY_OUTPUT_DIR');
 if(fs.readdirSync('/source/node_modules/.vite-temp').length)throw Error('SSR_CONFIG_TEMP_RETAINED');
 // Full input maps are retained, so this is independently reconstructible, unlike prior routing summary.
 result.inputIdentities={manifestSha256:expectedIdentity,preHash,postHash,fullExactViewPrePostVerified:true,sourceCommit:'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53',qdrantView:'EXACT_7_FILE_CANDIDATE_OVERLAY_NOT_BASELINE'};
 result.outputs={files:outputs,totalBytes:outputBytes,fullFileSetVerified:true,publicAssetsCopiedExactly:true,writableRoots};
 }catch{failure('SSR_OUTPUT_OR_ASSET_POSTHASH');return;}
 if(terminal)return;terminal=true;process.stdout.write(JSON.stringify(result)+'\n');
});
