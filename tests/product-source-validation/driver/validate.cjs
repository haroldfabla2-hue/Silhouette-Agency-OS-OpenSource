/* SOURCE ONLY, never executed. Exact TS-helper extraction, real Node FS only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
let ts,operation='DRIVER_BOOTSTRAP';
const finiteFailures=[];
const authoredReasons=new Set(['VALIDATION_WORK_RESERVE','SOURCE_PARSE','EXACT_SPILL_DECLARATIONS_REQUIRED','HELPER_COMPILE_INCOMPLETE','HELPER_EMIT_SKIPPED','COMPILER_DIAGNOSTIC_BOUND','NAMED_SOURCE_TREE_REQUIRED','FULL_MODULE_DIAGNOSTICS']);
function recordFailure(error){finiteFailures.push({operation,reason:authoredReasons.has(error?.message)?error.message:'OTHER'});}

const start=process.hrtime.bigint(),out='/evidence/product-validation.json';
const result={scope:'COMPILER_AND_ACTUAL_HELPER_FILESYSTEM_ONLY',fullProductVerified:false,
 fullModuleTypechecks:[],helperCompiles:[],realCases:[],failures:[],baselineFinding:null,firstFailure:null,lateFailures:[],receiptWriteFailed:false};
function deadline(){if(Number(process.hrtime.bigint()-start)/1e9>125)throw Error('VALIDATION_WORK_RESERVE');}
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function check(name,fn){operation='REAL_FILESYSTEM_CASE';deadline();try{fn();result.realCases.push({name,pass:true});}catch(e){recordFailure(e);result.realCases.push({name,pass:false});result.failures.push(name);}}
function compile(name,file,helper){
 operation='COMPILER_OUTPUT_DIRECTORY';deadline();const output='/fixtures/generated/'+name;fs.mkdirSync(output,{recursive:true});
 let options,configDiagnostics=[],configSha256=null;
 if(helper){
  options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
   moduleResolution:ts.ModuleResolutionKind.Node10,strict:true,esModuleInterop:true,skipLibCheck:false,
   types:['node'],typeRoots:['/app/node_modules/@types'],outDir:output,noEmit:false,noEmitOnError:true};
 }else{
  const relative=path.relative('/app/trees',file),variant=relative.split(path.sep)[0];
  if(!['live','runtime'].includes(variant))throw Error('NAMED_SOURCE_TREE_REQUIRED');
  const configPath='/app/trees/'+variant+'/tsconfig.json';
  configSha256=sha(fs.readFileSync(configPath));
  const read=ts.readConfigFile(configPath,ts.sys.readFile);
  if(read.error)configDiagnostics.push(read.error);
  const parsed=ts.parseJsonConfigFileContent(read.config||{},ts.sys,path.dirname(configPath),undefined,configPath);
  configDiagnostics.push(...parsed.errors);
  options={...parsed.options,noEmit:true};
 }
 operation='COMPILER_PROGRAM_CREATE';const program=ts.createProgram([file],options);
 operation='COMPILER_COMPLETE_DIAGNOSTICS';const diagnostics=[...configDiagnostics,...ts.getPreEmitDiagnostics(program)];const finite=diagnostics.map(d=>({code:d.code,
  message:ts.flattenDiagnosticMessageText(d.messageText,' '),file:d.file?.fileName,
  start:d.start}));
 if(Buffer.byteLength(JSON.stringify(finite))>2*1024**2)throw Error('COMPILER_DIAGNOSTIC_BOUND');
 operation='COMPILER_DIAGNOSTIC_WRITE';fs.writeFileSync('/evidence/'+name+'-diagnostics.json',JSON.stringify(finite,null,2));
 if(!helper&&diagnostics.length){operation='COMPILER_COMPLETE_DIAGNOSTICS';recordFailure(Error('FULL_MODULE_DIAGNOSTICS'));}
 const row={name,diagnostics:diagnostics.length,complete:diagnostics.length===0,configSha256,scope:helper?'EXACT_EXTRACTED_HELPER':'TARGET_MODULE_IMPORT_CLOSURE_WITH_ACTUAL_TREE_TSCONFIG'};
 if(helper)result.helperCompiles.push(row);else result.fullModuleTypechecks.push(row);
 if(helper&&diagnostics.length)throw Error('HELPER_COMPILE_INCOMPLETE');
 if(helper){operation='HELPER_COMPILER_EMIT';const emitted=program.emit();if(emitted.emitSkipped)throw Error('HELPER_EMIT_SKIPPED');}
 return output;
}
function spillHelper(name,source){
 operation='HELPER_SOURCE_READ_PARSE';const text=fs.readFileSync(source,'utf8'),sf=ts.createSourceFile(source,text,ts.ScriptTarget.ES2022,true);
 if(sf.parseDiagnostics.length)throw Error('SOURCE_PARSE');
 const wanted=['OUTPUT_INLINE_LIMIT_CHARS','OUTPUT_PREVIEW_CHARS','taskOutputDir','persistOutputForLedger'];
 const chosen=[];
 for(const statement of sf.statements){
  if(ts.isFunctionDeclaration(statement)&&statement.name&&wanted.includes(statement.name.text))chosen.push(statement.getText(sf));
  else if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&wanted.includes(d.name.text)))chosen.push(statement.getText(sf));
 }
 if(chosen.length!==4)throw Error('EXACT_SPILL_DECLARATIONS_REQUIRED');
 const code="import fs from 'node:fs';\nimport path from 'node:path';\nimport crypto from 'node:crypto';\n"+chosen.join('\n')+'\nexport { persistOutputForLedger };\n';
 operation='HELPER_SOURCE_WRITE';const target='/fixtures/generated/'+name+'.ts';fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,code);
 const dir=compile(name,target,true),module=path.join(dir,name+'.js');
 result.helperCompiles[result.helperCompiles.length-1].sourceSha256=sha(Buffer.from(code));
 operation='EXACT_HELPER_MODULE_LOAD';return require(module).persistOutputForLedger;
}
function sameReference(ref,text){const b=fs.readFileSync(ref.path);if(b.length!==ref.bytes||sha(b)!==ref.sha256||b.toString('utf8')!==text)throw Error('ACTUAL_OUTPUT_REFERENCE_MISMATCH');}
try{
 operation='DRIVER_STARTED_RECEIPT';fs.writeFileSync('/evidence/driver-started.json',JSON.stringify({version:1,driverStarted:true,productPass:false})+'\n');
 operation='COMPILER_MODULE_LOAD';ts=require('/app/node_modules/typescript/lib/typescript.js');
 // No native/product import. Full typecheck only reads exact source trees.
 for(const variant of ['live','runtime'])for(const file of ['services/execution/taskLedger.ts','services/memoryTransitions.ts'])
  compile('full-'+variant+'-'+path.basename(file),'/app/trees/'+variant+'/'+file,false);
 const baseLive=spillHelper('baseline-live','/driver/inputs/baseline-live/services/execution/taskLedger.ts');
 const baseRuntime=spillHelper('baseline-runtime','/driver/inputs/baseline-runtime/services/execution/taskLedger.ts');
 const live=spillHelper('candidate-live','/driver/inputs/live/services/execution/taskLedger.ts');
 const runtime=spillHelper('candidate-runtime','/driver/inputs/runtime/services/execution/taskLedger.ts');
 const A='A'.repeat(300001)+'ñ🙂',B='B'.repeat(300001)+'日本語🙂';
 function root(name){const d='/fixtures/'+name;fs.mkdirSync(d,{mode:0o700});process.env.SILHOUETTE_TASK_OUTPUT_DIR=d;return d;}
 check('baseline-live-original-late-overwrite-real',()=>{
  root('base-live');const first=baseLive('task_fixture_1',A),late=baseLive('task_fixture_1',B);
  sameReference(late.extra.outputRef,B);
  const originalStillMatches=sha(fs.readFileSync(first.extra.outputRef.path))===first.extra.outputRef.sha256;
  result.baselineFinding={originalReferencePreserved:originalStillMatches,actualLateBytesMatched:true};
  if(originalStillMatches)throw Error('BASELINE_MECHANISM_NOT_REPRODUCED');
 });
 check('baseline-runtime-original-late-overwrite-real',()=>{
  root('base-runtime');const first=baseRuntime('task_fixture_1',A),late=baseRuntime('task_fixture_1',B);
  sameReference(late.extra.outputRef,B);if(sha(fs.readFileSync(first.extra.outputRef.path))===first.extra.outputRef.sha256)throw Error('BASELINE_NOT_REPRODUCED');
 });
 for(const [name,fn]of [['live',live],['runtime',runtime]]){
  check(name+'-inline-and-threshold',()=>{
   root(name+'-inline');for(const s of ['ñ🙂日本語','a'.repeat(256000)]){const r=fn('task_fixture_1',s);if(r.output!==s||r.extra.outputRef)throw Error('INLINE_CHANGED');}
   const text='a'.repeat(256001);sameReference(fn('task_fixture_1',text).extra.outputRef,text);
  });
  check(name+'-distinct-large-original-late-retained',()=>{
   root(name+'-distinct');const a=fn('task_fixture_1',A),b=fn('task_fixture_1',B);
   if(a.extra.outputRef.path===b.extra.outputRef.path)throw Error('ALIASED');sameReference(a.extra.outputRef,A);sameReference(b.extra.outputRef,B);
   const ino=fs.statSync(a.extra.outputRef.path).ino;const again=fn('task_fixture_1',A);sameReference(again.extra.outputRef,A);
   if(fs.statSync(a.extra.outputRef.path).ino!==ino)throw Error('REPLACED');
  });
  function finalPath(d){return path.join(d,'output-v2-'+sha(Buffer.from('task_fixture_1'))+'-'+sha(Buffer.from(A))+'.txt');}
  check(name+'-corrupt-existing-denied-inline',()=>{
   const d=root(name+'-corrupt'),file=finalPath(d);fs.writeFileSync(file,'CORRUPT');const r=fn('task_fixture_1',A);
   if(r.output!==A||r.extra.outputSpillFailed!==true||fs.readFileSync(file,'utf8')!=='CORRUPT')throw Error('CORRUPT_OVERWRITE_OR_LOSS');
  });
  check(name+'-symlink-existing-denied-inline',()=>{
   const d=root(name+'-symlink'),file=finalPath(d),target=path.join(d,'protected-fixture');fs.writeFileSync(target,'UNCHANGED');fs.symlinkSync(target,file);
   const r=fn('task_fixture_1',A);if(r.output!==A||r.extra.outputSpillFailed!==true||fs.readFileSync(target,'utf8')!=='UNCHANGED'||!fs.lstatSync(file).isSymbolicLink())throw Error('SYMLINK_FOLLOW_OR_OVERWRITE');
  });
  check(name+'-two-link-crash-leftover-EEXIST-denied',()=>{
   const d=root(name+'-two-link'),file=finalPath(d),alias=path.join(d,'crash-leftover');fs.writeFileSync(file,A);fs.linkSync(file,alias);
   if(fs.statSync(file).nlink!==2)throw Error('REAL_TWO_LINK_FIXTURE_REQUIRED');
   const r=fn('task_fixture_1',A);if(r.output!==A||r.extra.outputSpillFailed!==true||fs.statSync(file).nlink!==2||fs.readFileSync(alias,'utf8')!==A)throw Error('LEFTOVER_REPAIRED_OR_ACCEPTED');
  });
  check(name+'-legacy-reference-preserved',()=>{
   const d=root(name+'-legacy'),old=path.join(d,'task_fixture_1.txt');fs.writeFileSync(old,'LEGACY');sameReference(fn('task_fixture_1',A).extra.outputRef,A);if(fs.readFileSync(old,'utf8')!=='LEGACY')throw Error('LEGACY_CHANGED');
  });
  check(name+'-actual-parent-is-file-error-inline',()=>{
   const d=root(name+'-notdir'),file=path.join(d,'not-directory');fs.writeFileSync(file,'UNCHANGED');process.env.SILHOUETTE_TASK_OUTPUT_DIR=file;
   const r=fn('task_fixture_1',A);if(r.output!==A||r.extra.outputSpillFailed!==true||fs.readFileSync(file,'utf8')!=='UNCHANGED')throw Error('REAL_ERROR_NOT_PRESERVED');
  });
 }
}catch(error){recordFailure(error);result.failures.push('VALIDATION_INCOMPLETE');}
finally{
 result.seconds=Number(process.hrtime.bigint()-start)/1e9;
 result.helperFilesystemComplete=result.failures.length===0;
 result.fullModuleTypecheckComplete=result.fullModuleTypechecks.length===4&&result.fullModuleTypechecks.every(x=>x.complete);
 result.status='SCOPED_HELPER_EVIDENCE_NOT_PRODUCT_ACCEPTANCE';
 result.firstFailure=finiteFailures[0]||null;result.lateFailures=finiteFailures.slice(1,33);
 try{operation='VALIDATION_RECEIPT_WRITE';fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
 catch(error){recordFailure(error);result.receiptWriteFailed=true;
  try{fs.writeFileSync('/evidence/driver-receipt-failure.json',JSON.stringify({version:1,firstFailure:finiteFailures[0],lateFailures:finiteFailures.slice(1,33),receiptWriteFailed:true,productPass:false})+'\n');}catch{}
 }
 console.log(JSON.stringify({status:result.status,helperFilesystemComplete:result.helperFilesystemComplete,fullModuleTypecheckComplete:result.fullModuleTypecheckComplete,fullProductVerified:false}));
}
process.exitCode=result.helperFilesystemComplete&&result.fullModuleTypecheckComplete&&!result.receiptWriteFailed?0:1;
