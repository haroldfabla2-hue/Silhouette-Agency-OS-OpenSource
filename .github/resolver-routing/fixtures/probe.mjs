// Resolution only. No product config/module, dependency target, or returned file is imported.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire,register,Module} from 'node:module';
import {MessageChannel} from 'node:worker_threads';
import boundary from './load-boundary.cjs';
const mode=process.argv[2];
if(!['NODE','TSX','VITE_OPTIONAL'].includes(mode)||process.version!=='v22.23.4')throw Error('R_MODE_RUNTIME');
const cases=JSON.parse(fs.readFileSync('/control/cases.json','utf8'));
boundary.install();
let loaderPort,loaderSnapshot=null;
if(mode==='TSX'){
 // Match product package script: node --import tsx/esm. Tool path is a separate hash-pinned view.
 const channel=new MessageChannel();loaderPort=channel.port1;
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('R_ASYNC_GUARD_TIMEOUT')),5000);loaderPort.once('message',m=>{clearTimeout(timer);m.kind==='ASYNC_GUARD_READY'?resolve():reject(Error('R_ASYNC_GUARD_READY'));});});
 register('file:///control/async-guard.mjs',{parentURL:import.meta.url,data:{port:channel.port2},transferList:[channel.port2]});
 await ready;
 await import('file:///tooling/node_modules/tsx/dist/esm/index.mjs');
}
let viteResolve;
if(mode==='VITE_OPTIONAL'){
 const vite=await import('file:///tooling/node_modules/vite/dist/node/index.js');
 if(vite.version!=='6.4.1')throw Error('R_VITE_VERSION');
 const config=await vite.resolveConfig({root:'/source',configFile:false,envFile:false,plugins:[],publicDir:false,cacheDir:'/tmp/vite-resolver-unused',logLevel:'silent',clearScreen:false,build:{ssr:true,lib:{entry:'/source/server/index.ts',formats:['es'],fileName:()=> 'index.js'},outDir:'/tmp/NEVER_BUILD',emptyOutDir:false,rollupOptions:{external:id=>!id.startsWith('.')&&!path.isAbsolute(id)&&!id.startsWith('@/')}},resolve:{alias:{'@':'/source'}}},'build','production','production');
 viteResolve=config.createResolver();
}
const rows=[];
function capture(fn){try{return {url:fn()};}catch(e){return {error:e.code||'R_UNEXPECTED'};}}
function inspect(result){
 if(result.url){
  if(!result.url.startsWith('file:///source/'))throw Error('R_TARGET_OUTSIDE_SOURCE');
  const p=fileURLToPath(result.url);result.relative=path.relative('/source',p);result.exists=fs.existsSync(p)&&fs.statSync(p).isFile();
  if(result.exists&&fs.realpathSync(p)!==p)throw Error('R_TARGET_SYMLINK');
 }
 return result;
}
function expect(row,result,kind){
 if(row.error){if(result.error!==row.error)throw Error('R_PRIVATE_EXPORT_CONTROL');return;}
 if(row.missing){if(!(result.error==='ERR_MODULE_NOT_FOUND'||result.error==='MODULE_NOT_FOUND'||result.exists===false))throw Error('R_MISSING_CONTROL');return;}
 const error=kind==='require'?row.requireError:undefined;
 if(error){if(result.error!==error)throw Error('R_CONDITION_CONTROL');return;}
 const target=kind==='require'?row.requireTarget:(mode!=='NODE'&&row.tsxTarget?row.tsxTarget:row.importTarget);
 if(result.error||result.relative!==target)throw Error('R_TARGET_SELECTION');
 if(row.nativeMissing&&mode==='NODE'){if(result.exists)throw Error('R_NATIVE_EXTENSION_CONTROL');}
 else if(!result.exists)throw Error('R_TARGET_MISSING');
}
for(const row of cases){
 const parent='/source/'+row.parent;if(!fs.existsSync(parent))throw Error('R_PARENT_ABSENT');
 const parentURL=pathToFileURL(parent).href;
 let imported;
 if(mode==='VITE_OPTIONAL'&&row.local){
  // Only local imports enter Vite's resolver. Bare specifiers are external under product Rollup predicate.
  let id;try{id=await viteResolve(row.specifier,parent,false,true);}catch(e){imported={error:e.code||'R_VITE_RESOLUTION'};}
  if(!imported)imported=id?{url:pathToFileURL(id).href}:{error:'ERR_MODULE_NOT_FOUND'};
 }else imported=capture(()=>import.meta.resolve(row.specifier,parentURL));
 inspect(imported);expect(row,imported,'import');
 const out={id:row.id,parent:row.parent,specifier:row.specifier,route:mode==='VITE_OPTIONAL'?(row.local?'VITE_SSR_LOCAL_ID_ONLY':'PRODUCT_ROLLUP_EXTERNAL_THEN_NODE_IMPORT'):(mode==='TSX'?'ACTUAL_REGISTERED_TSX_ESM_RESOLVE':'NODE_IMPORT_META_RESOLVE'),import:imported};
 if(!row.local){const required=inspect(capture(()=>pathToFileURL(createRequire(parentURL).resolve(row.specifier)).href));expect(row,required,'require');out.require=required;out.requireRoute='NODE_CREATE_REQUIRE_RESOLVE_ONLY';}
 rows.push(out);
}
// Synthetic load controls never import application or dependency target modules.
const beforeControls=boundary.snapshot();if(beforeControls.violationCount!==0)throw Error('R_UNEXPECTED_BOUNDARY_VIOLATION');
const readCompileControls=createRequire(import.meta.url)('/control/boundary-controls.cjs').run();
const controlOffset=readCompileControls.after.violationCount;
let denied=0;
for(const attempt of [
 ()=>import('file:///denied/sentinel.mjs'),
 ()=>Promise.resolve(createRequire(import.meta.url)('/denied/sentinel.cjs')),
 ()=>Promise.resolve(new Module('/denied/manual.cjs')._compile("throw Error('R_BAD_COMPILE')",'/denied/manual.cjs')),
 ()=>import('data:text/javascript,throw%20Error(%22R_BAD_DATA_URL%22)')
]){try{await attempt();}catch(e){if(e.code==='R_LOAD_DENIED')denied++;else throw e;}}
let nativeDenied=false;try{process.dlopen({exports:{}},'/denied/native-sentinel.node');}catch(e){nativeDenied=e.code==='R_LOAD_DENIED';}
let codeReadDenied=false;try{fs.readFileSync('/source/services/apiKeyService.ts');}catch(e){codeReadDenied=e.code==='R_SOURCE_CODE_READ_DENIED';}
const expectedControlEvents=[
 {rule:'MODULE_NOT_ALLOWLISTED',subject:'/denied/sentinel.mjs'},
 {rule:'MODULE_NOT_ALLOWLISTED',subject:'/denied/sentinel.cjs'},
 {rule:'MODULE_NOT_ALLOWLISTED',subject:'/denied/manual.cjs'},
 {rule:'NON_FILE_PROTOCOL',subject:'data:text/javascript,throw%20Error(%22R_BAD_DATA_URL%22)'},
 {rule:'NATIVE_NOT_ALLOWLISTED',subject:'/denied/native-sentinel.node'},
 {rule:'SOURCE_CODE_READ',subject:'/source/services/apiKeyService.ts'}
];
const afterControls=boundary.snapshot();
if(denied!==4||!nativeDenied||!codeReadDenied||afterControls.violationCount!==controlOffset+6||afterControls.events.length!==controlOffset+6||afterControls.events.slice(controlOffset).some((e,i)=>e.rule!==expectedControlEvents[i].rule||e.subject!==expectedControlEvents[i].subject))throw Error('R_LOAD_CONTROL');
if(loaderPort){
 loaderSnapshot=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('R_ASYNC_GUARD_SNAPSHOT_TIMEOUT')),5000);loaderPort.once('message',m=>{clearTimeout(timer);m.kind==='ASYNC_GUARD_SNAPSHOT'?resolve(m):reject(Error('R_ASYNC_GUARD_SNAPSHOT'));});loaderPort.postMessage('SNAPSHOT');});
 if(!loaderSnapshot.controlsMatched||!loaderSnapshot.readCompileControls||JSON.stringify(loaderSnapshot.violations)!==JSON.stringify(loaderSnapshot.readCompileControls.after))throw Error('R_ASYNC_UNEXPECTED_LOAD');
 loaderPort.close();
}
const successfulNativeLoads=boundary.loaded.filter(row=>row.native);
if(successfulNativeLoads.length!==(mode==='VITE_OPTIONAL'?1:0))throw Error('R_NATIVE_LOAD_COUNT');
if(JSON.stringify(boundary.snapshot())!==JSON.stringify(afterControls))throw Error('R_POST_CONTROL_BOUNDARY_VIOLATION');
process.stdout.write(JSON.stringify({schema:1,mode,status:'ROUTING_ASSERTIONS_MATCHED',rows,loadBoundary:{beforeControls,readCompileControls,afterControls,syntheticLoadRejected:denied,nativeLoadControlRejected:nativeDenied,sourceCodeReadControlRejected:codeReadDenied,unexpectedProcesses:boundary.blocked.processes},allowedLoadsObserved:boundary.loaded,asyncLoaderBoundary:loaderSnapshot,toolingEvaluated:mode!=='NODE',toolingNativeAllowed:mode==='VITE_OPTIONAL',productModuleEvaluated:false,targetDependencyModuleEvaluated:false,buildExecuted:false,lifecycleAccepted:false,runtimeBehaviorAccepted:false,scope:'ROUTING_ONLY_NOT_MODULE_EXECUTION_COMPATIBILITY'})+'\n');
