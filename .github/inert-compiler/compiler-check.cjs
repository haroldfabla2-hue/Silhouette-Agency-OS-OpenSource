'use strict';
// Trusted compiler-only runner. Reads public source; NEVER imports application/dependency modules.
// No resolver replacement. Enumerates the pinned compiler's ACTUAL completed caches after checking.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const MANIFEST_CAP=8*1024*1024,MAX_FILES=20000,MAX_EDGES=100000,MAX_PACKAGES=5000;
let stage='C00_INIT';
const check=(ok,code)=>{if(!ok){const e=Error('fixed compiler evidence failure');e.fixed=code;throw e;}};
function norm(file){
 const resolved=path.resolve(file);
 if(resolved.startsWith('/source/'))return 'source/'+resolved.slice('/source/'.length);
 if(resolved.startsWith('/compiler/'))return 'compiler/'+resolved.slice('/compiler/'.length);
 check(false,'C_PATH_OUTSIDE_INPUTS');
}
function main(){
 stage='C01_PLAN';const plan=JSON.parse(fs.readFileSync('/control/check.json','utf8'));
 check(['BASELINE_HISTORICAL','CANDIDATE_LEGACY','CANDIDATE_ALIGNED'].includes(plan.contract),'C_CONTRACT');
 const compilerBytes=fs.readFileSync('/compiler/lib/typescript.js');
 check(hash(compilerBytes)==='dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0','C_COMPILER_HASH');
 const ts=require('/compiler/lib/typescript.js');check(ts.version==='5.8.3','C_COMPILER_VERSION');
 const configBytes=fs.readFileSync('/control/tsconfig.node.json');check(hash(configBytes)===plan.configSha256,'C_CONFIG_HASH');
 stage='C02_PARSE';const read=ts.readConfigFile('/control/tsconfig.node.json',ts.sys.readFile);
 check(!read.error,'C_CONFIG_PARSE');
 // Both config views describe the SAME source-root/project path, independent of control bind location.
 const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,'/source',{incremental:false,pretty:false},'/source/tsconfig.node.json');
 check(parsed.options.noEmit===true && parsed.options.strict===false && parsed.options.skipLibCheck===true,'C_OPTION_INVARIANTS');
 check(parsed.options.module===ts.ModuleKind.ESNext,'C_MODULE_INVARIANT');
 check(plan.contract==='CANDIDATE_ALIGNED' ? parsed.options.moduleResolution===ts.ModuleResolutionKind.Bundler && JSON.stringify(parsed.options.customConditions)==='["node"]' : parsed.options.moduleResolution===ts.ModuleResolutionKind.Node10 && parsed.options.customConditions===undefined,'C_RESOLVER_CONTRACT');
 stage='C03_PROGRAM';const host=ts.createCompilerHost(parsed.options,true);
 host.writeFile=()=>{check(false,'C_EMIT_FORBIDDEN');};
 const program=ts.createProgram({rootNames:parsed.fileNames,options:parsed.options,host,configFileParsingDiagnostics:parsed.errors,projectReferences:parsed.projectReferences});
 stage='C04_DIAGNOSTICS';const diagnostics=ts.getPreEmitDiagnostics(program);
 // Same pinned compiler diagnostics; no emit, filters, test substitutions or ignored code.
 const text=ts.formatDiagnostics(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>'/source',getNewLine:()=> '\n'});
 check(Buffer.byteLength(text)<=8*1024*1024,'C_DIAGNOSTIC_CAP');process.stdout.write(text);
 stage='C05_GRAPH';check(typeof program.forEachResolvedModule==='function' && typeof program.forEachResolvedTypeReferenceDirective==='function' && typeof program.getAutomaticTypeDirectiveResolutions==='function' && typeof ts.getConditions==='function','C_PINNED_CACHE_ENUMERATION');
 const sources=program.getSourceFiles();check(sources.length<=MAX_FILES,'C_FILE_CAP');
 const packages=new Map();
 function declaredTargets(data,dir){
  const result=[];
  function visit(value,route,depth){
   check(depth<=32 && result.length<1000,'C_EXPORT_TARGET_CAP');
   if(typeof value==='string'){
    const row={route,target:value,selection:'DECLARED_ONLY_NOT_RUNTIME_RESOLVED'};
    if(!value.includes('*') && (value.startsWith('./') || route==='main' || route==='module' || route==='types' || route==='typings')){
     const full=path.resolve(dir,value);
     if(full.startsWith(dir+'/')){
      row.path=norm(full);row.regularFile=fs.existsSync(full)&&fs.statSync(full).isFile();
      if(row.regularFile)row.sha256=hash(fs.readFileSync(full));
     }
    }
    result.push(row);
   }else if(Array.isArray(value))value.forEach((item,index)=>visit(item,route+'/'+index,depth+1));
   else if(value && typeof value==='object')for(const [key,item] of Object.entries(value))visit(item,route+'/'+key,depth+1);
  }
  for(const key of ['main','module','types','typings','exports','imports'])if(data[key]!==undefined)visit(data[key],key,0);
  return result;
 }

 function packageRecord(file){
  if(!file.startsWith('/source/node_modules/'))return;
  let dir=path.dirname(file);
  while(dir.startsWith('/source/node_modules/')){
   const metadata=path.join(dir,'package.json');
   if(fs.existsSync(metadata)){
    const key=norm(metadata);if(packages.has(key))return;
    check(packages.size<MAX_PACKAGES,'C_PACKAGE_CAP');const bytes=fs.readFileSync(metadata);check(bytes.length<=1024*1024,'C_PACKAGE_BYTES');
    const data=JSON.parse(bytes);const row={path:key,sha256:hash(bytes)};
    for(const field of ['name','version','type','main','module','types','typings','exports','imports','typesVersions'])if(Object.prototype.hasOwnProperty.call(data,field))row[field]=data[field];
    row.declaredTargets=declaredTargets(data,dir);
    check(Buffer.byteLength(JSON.stringify(row))<=262144,'C_PACKAGE_METADATA_CAP');packages.set(key,row);
    // Include outer package too when nested build-level package.json defines only module format.
   }
   dir=path.dirname(dir);
  }
 }
 const files=sources.map(source=>{const file=norm(source.fileName);packageRecord(source.fileName);return {path:file,sha256:hash(fs.readFileSync(source.fileName)),declaration:source.isDeclarationFile};}).sort((a,b)=>a.path.localeCompare(b.path));
 const edges=[];
 function add(kind,resolved,specifier,mode,from){
  check(edges.length<MAX_EDGES,'C_EDGE_CAP');check(typeof specifier==='string' && specifier.length<=4096,'C_SPECIFIER_CAP');
  const target=resolved && resolved.resolvedFileName;
  if(target)packageRecord(target);
  const row={kind,from:norm(from),specifier,conditions:ts.getConditions(parsed.options,mode),mode:mode===undefined?'DEFAULT':mode===ts.ModuleKind.ESNext?'IMPORT':mode===ts.ModuleKind.CommonJS?'REQUIRE':'OTHER',to:target?norm(target):null};
  if(resolved && resolved.packageId)row.packageId={name:resolved.packageId.name,subModuleName:resolved.packageId.subModuleName,version:resolved.packageId.version};
  edges.push(row);
 }
 // Exact TypeScript5.8.3 source signature: callback(resolution,name,mode,containingFilePath).
 program.forEachResolvedModule((value,name,mode,file)=>add('MODULE',value.resolvedModule,name,mode,file));
 program.forEachResolvedTypeReferenceDirective((value,name,mode,file)=>add('TYPE_REFERENCE',value.resolvedTypeReferenceDirective,name,mode,file));
 const automatic=program.getAutomaticTypeDirectiveResolutions();
 if(automatic)automatic.forEach((value,name,mode)=>add('AUTOMATIC_TYPE_REFERENCE',value.resolvedTypeReferenceDirective,name,mode,'/source/tsconfig.node.json'));
 edges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 stage='C06_SERIALIZE';
 const manifest={schema:1,contract:plan.contract,compiler:{version:ts.version,typescriptJsSha256:hash(compilerBytes)},configSha256:hash(configBytes),options:parsed.options,rootFiles:parsed.fileNames.map(norm).sort(),files,edges,packages:[...packages.values()].sort((a,b)=>a.path.localeCompare(b.path)),diagnosticCount:diagnostics.length,graphScope:'ACTUAL_PROGRAM_FILES_MODULE_TYPE_AND_AUTOMATIC_TYPE_CACHES',packageTargetScope:'STATIC_DECLARED_LEAVES_NOT_RUNTIME_RESOLUTION',noEmit:true,runtimeResolutionExecuted:false,runtimeCorrespondence:'REVIEW_REQUIRED_NOT_INFERRED_FROM_TYPES',graphComplete:true};
 // configFilePath is virtual fixed source path; no host-private paths/env or trace strings.
 const output=JSON.stringify(manifest)+'\n';check(Buffer.byteLength(output)<=MANIFEST_CAP,'C_MANIFEST_CAP');
 fs.writeFileSync('/tmp/compiler-manifest.json',output,{flag:'wx'});
 process.exitCode=diagnostics.length?2:0;
}
try{main();}catch(error){
 // Fixed status only, never raw exception text/path/env.
 const errorClass=error instanceof SyntaxError?'E_PARSE':error instanceof TypeError?'E_TYPE':error.code==='ENOENT'?'E_ABSENT':error.code?'E_OS':'E_EVIDENCE';
 fs.writeFileSync('/tmp/compiler-evidence-failure.json',JSON.stringify({stage,predicate:error.fixed||'C_UNEXPECTED',errorClass,classification:'INCOMPLETE',graphComplete:false})+'\n');
 process.exitCode=125;
}
