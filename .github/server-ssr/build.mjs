// Only this reviewed control evaluates tooling. Application/generated server files are data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const B=require('/control/boundary.cjs');const H=b=>crypto.createHash('sha256').update(b).digest('hex');
let report={schema:1,stage:'SSR',status:'INCOMPLETE',runtimeAcceptance:false,typeAcceptance:false,generatedServerEvaluated:false,targetPackageEvaluated:false};
const diagnostics=[];let diagnosticBytes=0;let finished=false;
function diag(kind,value){const text=String(value);diagnosticBytes+=Buffer.byteLength(text);if(diagnosticBytes>65536||diagnostics.length>=128)throw Error('DIAGNOSTIC_CAP');diagnostics.push({kind,text,bytes:Buffer.byteLength(text),sha256:H(Buffer.from(text))});}
function finish(){if(finished)return;finished=true;report.boundary=B.snapshot();report.diagnostics=diagnostics;report.diagnosticBytes=diagnosticBytes;process.stdout.write(JSON.stringify(report)+'\n');}
function assert(v,k){if(!v)throw Error(k);}
function walk(n,fn){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(v=>walk(v,fn));return;}if(n.type)fn(n);for(const [k,v]of Object.entries(n))if(!['start','end','loc','raw'].includes(k)&&v&&typeof v==='object')walk(v,fn);}
try{
 fs.mkdirSync('/source/dist/server',{recursive:true});fs.writeFileSync('/source/dist/server/negative-output.cjs','throw Error("OUTPUT_EXECUTED")');
 B.install();
 // Actual negative-control entrypoints, before tooling; no targetfile is evaluated.
 const before=B.snapshot().violations;let caught=0;
 for(const [kind,action]of [
  ['LOAD',()=>require('/denied/sentinel.cjs')],
  ['LOAD',()=>require('/source/dist/server/negative-output.cjs')],
  ['PROCESS',()=>require('node:child_process').execFileSync('/bin/true')],
  ['NETWORK',()=>require('node:net').connect({host:'127.0.0.1',port:9})],
  ['WORKER',()=>new (require('node:worker_threads').Worker)('0',{eval:true})],
  ['NATIVE',()=>process.dlopen({exports:{}},'/denied/native-sentinel.node')],
  ['WRITE_ROOT',()=>fs.writeFileSync('/source/server/main.ts','not written')]
 ]){try{action();throw Error('CONTROL_BYPASS');}catch(e){assert(e.code==='SSR_BOUNDARY_'+kind,'CONTROL_WRONG_REJECTION');caught++;}}
 assert(before===0&&caught===7&&B.snapshot().violations===7,'CONTROL_LEDGER');
 fs.unlinkSync('/source/dist/server/negative-output.cjs');
 report.controls=B.snapshot().events;const controlFloor=B.snapshot().violations;
 const {parseAst}=await import('/source/node_modules/rollup/dist/es/parseAst.js');B.setParser(parseAst);
 const {build}=await import('/source/node_modules/vite/dist/node/index.js');
 let resolved=false,artifact;
 const audit={name:'reviewed-server-artifact-audit',enforce:'post',
  configResolved(c){
   assert(c.root==='/source'&&c.configFile==='/source/vite.server.config.ts'&&c.mode==='production'&&c.command==='build','RESOLVED_CONTEXT');
   assert(c.build.ssr===true&&c.build.outDir==='/source/dist/server'&&c.build.emptyOutDir===true&&!c.build.watch,'RESOLVED_BUILD');
   assert(c.build.lib.entry==='/source/server/main.ts'&&JSON.stringify(c.build.lib.formats)==='["es"]'&&c.build.lib.fileName()==='index.js','RESOLVED_ENTRY');
   assert(c.publicDir==='/source/public'&&c.build.copyPublicDir===true&&c.envDir==='/source','IMPLICIT_CONTEXT');
   assert(!c.plugins.some(p=>/react|typescript|commonjs-external/.test(p.name)),'UNEXPECTED_PLUGIN');
   resolved=true;report.resolved={root:c.root,configFile:c.configFile,mode:c.mode,ssr:true,outDir:c.build.outDir,emptyOutDir:true,copyPublicDir:c.build.copyPublicDir,publicDir:c.publicDir,envDir:c.envDir,configLoader:'bundle-default',externalPredicateUnmodified:true,plugins:c.plugins.map(p=>p.name)};
  },
  generateBundle(options,bundle){
   assert(resolved&&options.format==='es','OUTPUT_CONTEXT');const chunks=[],externals=[],dynamicUnknown=[],moduleGraph=[];let modules=0;
   for(const id of this.getModuleIds()){
    const m=this.getModuleInfo(id);if(m.isExternal){externals.push({id,importers:m.importers,dynamicImporters:m.dynamicImporters});continue;}
    assert(id.startsWith('/source/')||id.startsWith('\0'),'BUNDLED_MODULE_ROOT');
    if(++modules>10000)throw Error('MODULE_CAP');moduleGraph.push({id,importedIds:m.importedIds,dynamicallyImportedIds:m.dynamicallyImportedIds,isEntry:m.isEntry});
   }
   for(const [name,item]of Object.entries(bundle)){
    assert(!name.startsWith('/')&&!name.split('/').includes('..'),'OUTPUT_PATH');
    assert(item.type==='chunk','UNSUPPORTED_GENERATED_ASSET');
    const ast=this.parse(item.code);const imports=[],dynamic=[],calls=[],declarations=[];
    walk(ast,n=>{
     if(n.type==='ImportDeclaration'||n.type==='ExportNamedDeclaration'&&n.source||n.type==='ExportAllDeclaration')imports.push(n.source.value);
     if(n.type==='ImportExpression'){if(n.source.type==='Literal'&&typeof n.source.value==='string')dynamic.push(n.source.value);else dynamicUnknown.push({file:name,start:n.start,end:n.end});}
     if(n.type==='FunctionDeclaration'&&n.id?.name==='startProductionServer')declarations.push(n.id.name);
    });
    // Top-level call path only: never count a dormant function-body reference as launch.
    function top(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(top);return;}if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ClassDeclaration','ClassExpression'].includes(n.type))return;if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='startProductionServer')calls.push({start:n.start,end:n.end});for(const [k,v]of Object.entries(n))if(!['start','end','loc','raw'].includes(k)&&v&&typeof v==='object')top(v);}
    top(ast);
    chunks.push({file:name,isEntry:item.isEntry,facade:item.facadeModuleId,imports:item.imports,dynamicImports:item.dynamicImports,astStaticSpecifiers:imports,astDynamicSpecifiers:dynamic,modules:Object.entries(item.modules).map(([id,m])=>({id,renderedLength:m.renderedLength,originalLength:m.originalLength})),startupTopLevelCalls:calls,startupDeclarations:declarations,bytes:Buffer.byteLength(item.code),sha256:H(Buffer.from(item.code))});
   }
   assert(chunks.length>0&&chunks.length<=512&&externals.length<=2048&&dynamicUnknown.length<=512,'INVENTORY_CAP');
   const entry=chunks.find(c=>c.file==='index.js'&&c.isEntry&&c.facade==='/source/server/main.ts');assert(entry,'ENTRY_ARTIFACT');
   const reachable=new Set();function reach(name){if(reachable.has(name))return;reachable.add(name);const c=chunks.find(x=>x.file===name);if(c)for(const edge of c.imports)if(chunks.some(x=>x.file===edge))reach(edge);}reach(entry.file);
   const declarationReachable=chunks.some(c=>reachable.has(c.file)&&c.startupDeclarations.length>0);
   artifact={chunks,externals,dynamicUnknown,moduleGraph,modules,reachability:{sourceEntry:'/source/server/main.ts',entry:entry.file,entryTopLevelStartCall:entry.startupTopLevelCalls.length===1,declarationInStaticOutputClosure:declarationReachable,staticClosure:[...reachable].sort(),classification:entry.startupTopLevelCalls.length===1&&declarationReachable?'LIMITED_STATIC_CALL_PATH_PRESENT':'UNVERIFIED',runtimeInvocationProved:false,nonliteralDynamicImportsExhaustive:false}};
  }
 };
 // Keep actual config/default env/public-copy/SSR external predicate. Only add read-only evidence hooks/logger.
 const result=await build({configFile:'/source/vite.server.config.ts',customLogger:{hasWarned:false,info:m=>diag('info',m),warn:m=>diag('warn',m),warnOnce:m=>diag('warn',m),error:m=>diag('error',m),clearScreen:()=>{},hasErrorLogged:()=>false},plugins:[audit]});
 assert(artifact,'AUDIT_ABSENT');assert(B.snapshot().violations===controlFloor,'UNEXPECTED_BOUNDARY_EVENT');
 await B.closeService();assert(B.snapshot().violations===controlFloor,'LATE_BOUNDARY_EVENT');
 assert(Object.keys(process.env).sort().join(',')==='HOME,LANG,NODE_DISABLE_COMPILE_CACHE,NODE_ENV,PATH,TMPDIR'&&process.env.NODE_ENV==='production','FINAL_ENVIRONMENT');
 assert(B.snapshot().nativeLoads===1&&B.snapshot().spawnCount===1&&B.snapshot().configLoads===1,'ACTUAL_TOOLING_RECEIPTS');
 report={...report,status:'SSR_BUILD_RETURNED',artifact};
}catch(e){
 report.failure={name:/^[A-Za-z_]+$/.test(e.name||'')?e.name:'Error',code:/^[A-Z0-9_]{1,96}$/.test(e.code||'')?e.code:'UNCLASSIFIED',message:String(e.message).slice(0,8192),messageSha256:H(Buffer.from(String(e.message))),location:e.loc&&{file:String(e.loc.file||'').replace('/source/','').slice(0,240),line:Number(e.loc.line)||0,column:Number(e.loc.column)||0}};process.exitCode=125;
 // A failed build can still own a realtool service. Attempt its normal EOF close, never kill it for a pass.
 try{const s=B.snapshot();if(s.spawnCount===1&&!s.closing)await B.closeService();}catch{report.serviceCloseFailed=true;}
}finally{finish();}
