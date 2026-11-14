/** Review-only additional supported Vitest4 reporter. Never imported in prep.
 * No framework function replacement, environment mutation or test filtering.
 */
import {availableParallelism} from 'node:os';
import {appendFileSync} from 'node:fs';
const target='/tmp/evidence/vitest-runtime-observation.jsonl';
let records=0;
function emit(value){
 if(records>=16)return;
 records++;
 try {appendFileSync(target,JSON.stringify(value)+'\n');}
 catch(error){console.error('DIAGNOSTIC_REPORTER_WRITE_FAILED',error?.code??error?.name);}
}
function numericSetting(name){
 const raw=process.env[name];
 if(raw===undefined)return {present:false};
 return /^\d{1,6}$/.test(raw)?{present:true,value:Number(raw)}:{present:true,invalidNumeric:true};
}
// Early failures must survive loss of the terminal default reporter summary.
// Never emit messages, titles, argv/env, diff/actual/expected, URLs or raw stacks.
const MAX_EARLY_ROWS=64,MAX_EARLY_BYTES=64*1024;
let earlyRows=0,earlyBytes=0,earlyTruncationReported=false;
function ownString(value,key){
 try {const d=Object.getOwnPropertyDescriptor(value??{},key);return d&&'value'in d&&typeof d.value==='string'?d.value:'';}
 catch{return '';}
}
function sourcePath(raw){
 if(typeof raw!=='string')return null;
 const match=raw.match(/(?:^|\/)(tests\/(?:automated|setup)\/[a-zA-Z0-9_./-]+\.(?:test\.)?[cm]?[jt]sx?|(?:services|server)\/[a-zA-Z0-9_./-]+\.[cm]?[jt]sx?)(?=[:\s)]|$)/);
 return match&&!match[1].split('/').includes('..')?match[1]:null;
}
function lineNumber(value){return Number.isSafeInteger(value)&&value>0&&value<10000000?value:null;}
function errorMetadata(error){
 const name=ownString(error,'name'),code=ownString(error,'code');
 const message=ownString(error,'message'),stack=ownString(error,'stack');
 const classifications=[];
 for(const [label,pattern]of [
  ['PROVIDER_CREDENTIAL_NOT_CONFIGURED',/credential not configured/i],
  ['LOCAL_INFERENCE_POLICY_DENIED',/local.*(?:disabled|not allowed)|cloud-only/i],
  ['CIRCUIT_OPEN',/Circuit Open/i],
  ['BROWSER_EXECUTABLE_MISSING',/Executable doesn.t exist|browser.*not found|executable.*not found/i],
  ['BROWSER_LAUNCH_FAILED',/browserType.launch|Failed to launch/i],
  ['TEST_OR_HOOK_TIMEOUT',/timed out|Timeout of|Test timed out/i],
  ['ORIGINAL_GENERATION_TEARDOWN_FAILED',/Original test generation teardown failed/],
  ['CHILD_OWNERSHIP_TEARDOWN_FAILED',/Original child\/poll ownership teardown failed/],
  ['ASSERTION_FAILED',/expected|AssertionError/]
 ])if(pattern.test(message+'\n'+stack))classifications.push(label);
 const frames=[];
 for(const line of stack.split('\n').slice(0,32)){
  const path=sourcePath(line),at=line.match(/:(\d+):(\d+)\)?$/);
  if(path&&at){frames.push({path,line:lineNumber(Number(at[1])),column:lineNumber(Number(at[2]))});if(frames.length>=3)break;}
 }
 return {name:['Error','AssertionError','AggregateError','TypeError','RangeError'].includes(name)?name:'OTHER_NAME_REDACTED',code:['EAGAIN','EMFILE','EPIPE','ENOENT','ECONNREFUSED','ERR_WORKER_INIT_FAILED'].includes(code)?code:null,classifications,sourceFrames:frames,rawValuesOmitted:true};
}
function early(value){
 const line=JSON.stringify(value)+'\n';
 if(earlyRows>=MAX_EARLY_ROWS||earlyBytes+Buffer.byteLength(line)>MAX_EARLY_BYTES-256){
  if(!earlyTruncationReported){earlyTruncationReported=true;try{appendFileSync(target,JSON.stringify({kind:'early-diagnostics-truncated',limitRows:MAX_EARLY_ROWS,limitBytes:MAX_EARLY_BYTES})+'\n');}catch(error){console.error('DIAGNOSTIC_REPORTER_WRITE_FAILED',error?.code??error?.name);}}
  return;
 }
 earlyRows++;earlyBytes+=Buffer.byteLength(line);
 try{appendFileSync(target,line);}catch(error){console.error('DIAGNOSTIC_REPORTER_WRITE_FAILED',error?.code??error?.name);}
}
export default class RuntimeObservationReporter {
 onInit(vitest){
  this.context=vitest;
  emit({kind:'resolved-global',pid:process.pid,availableParallelism:availableParallelism(),pool:vitest.config.pool,maxWorkers:vitest.config.maxWorkers??null,fileParallelism:vitest.config.fileParallelism??null,watch:vitest.config.watch,VITEST_MAX_WORKERS:numericSetting('VITEST_MAX_WORKERS')});
 }
 onTestRunStart(specifications){
  const ctx=this.context;const seen=new Set();const projects=[];
  for(const spec of specifications){
   if(seen.has(spec.project))continue;seen.add(spec.project);
   const c=spec.project.config;const parallel=availableParallelism();
   // This exactly states the pinned4.1.12 resolveMaxWorkers formula. It is
   // NOT a runtime active worker count or pids/thread budget.
   const resolvedWorkerPolicy=c.maxWorkers||ctx.config.maxWorkers||(ctx.config.watch?Math.max(Math.floor(parallel/2),1):Math.max(parallel-1,1));
   projects.push({pool:spec.pool,projectPool:c.pool,configuredMaxWorkers:c.maxWorkers??null,globalMaxWorkers:ctx.config.maxWorkers??null,resolvedWorkerPolicy,derivation:'PINNED_4_1_12_POLICY_NOT_ACTIVE_WORKER_COUNT',fileParallelism:c.fileParallelism??null});
   if(projects.length>=8)break;
  }
  emit({kind:'resolved-specification-pools',specificationCount:specifications.length,projects,projectRecordsBound:8});
 }
 onTestCaseResult(testCase){
  try{
   const result=testCase.result();
   if(result.state!=='failed'&&!result.errors?.length)return;
   early({kind:'early-testcase-result',module:sourcePath(testCase.module.relativeModuleId),location:{line:lineNumber(testCase.location?.line),column:lineNumber(testCase.location?.column)},state:result.state==='failed'?'failed':'passed-with-recorded-errors',errors:(result.errors??[]).slice(0,2).map(errorMetadata),omittedErrors:Math.max(0,(result.errors?.length??0)-2)});
  }catch(error){early({kind:'early-hook-diagnostic-incomplete',hook:'onTestCaseResult',error:errorMetadata(error)});}
 }
 onTestModuleEnd(testModule){
  try{
   const errors=testModule.errors();
   if(!errors.length)return;
   early({kind:'early-module-errors',module:sourcePath(testModule.relativeModuleId),errors:errors.slice(0,2).map(errorMetadata),omittedErrors:Math.max(0,errors.length-2)});
  }catch(error){early({kind:'early-hook-diagnostic-incomplete',hook:'onTestModuleEnd',error:errorMetadata(error)});}
 }

}
