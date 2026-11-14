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
}
