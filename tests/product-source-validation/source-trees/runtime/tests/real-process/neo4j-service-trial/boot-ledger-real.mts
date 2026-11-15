/** Additional actual lifecycle API regression fixture, not an application/native
 * service double. Real event-loop handles and real authored filesystem writes.
 * Does not prove daemon, Express, startup graph or native borrower closure.
 */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installPreparationHost} from '/tmp/work/services/lifecycle/bootstrapAuthority.ts';
import {createHost,CapacityExceeded,AdmissionClosed} from '/tmp/work/services/lifecycle/host.ts';
function required(name:string):number {const value=Number(process.env[name]);assert.ok(Number.isSafeInteger(value)&&value>0);return value;}
const capacity={scopes:required('SILHOUETTE_OWNER_SCOPES'),active:required('SILHOUETTE_OWNER_ACTIVE'),failures:required('SILHOUETTE_OWNER_FAILURES'),resources:required('SILHOUETTE_OWNER_RESOURCES')};
const mode=process.argv[2];
assert.ok(['boot-active-stop','boot-original-failure','ledger-capacity'].includes(mode));
const dir=await mkdtemp(join(tmpdir(),'authored-lifecycle-regression-'));
try {
 if(mode==='ledger-capacity') {
  // Exact actual core limit. Body has a real filesystem side effect, and MUST
  // never start when admission has exhausted its fixed operation budget.
  const host=createHost({scopes:1,active:1,failures:2,resources:1});
  const scope=host.scope('authored-core-fixture');let release!:()=>void;
  const gate=new Promise<void>(yes=>{release=yes;});
  const first=scope.invoke('original-authored-write',async()=>{await gate;await writeFile(join(dir,'admitted'),'original');});
  assert.throws(()=>scope.invoke('must-not-write',()=>writeFile(join(dir,'forbidden'),'wrong')),error=>error instanceof CapacityExceeded);
  const stopping=host.stop();
  assert.throws(()=>scope.invoke('post-seal-write',()=>writeFile(join(dir,'forbidden'),'wrong')),error=>error instanceof AdmissionClosed);
  release();await first;const report=await stopping;
  assert.equal(await readFile(join(dir,'admitted'),'utf8'),'original');
  await assert.rejects(readFile(join(dir,'forbidden')),{code:'ENOENT'});
  assert.deepEqual(report.highWater,{scopes:1,active:1,failures:0,resources:0});
  assert.deepEqual(report.capacity,{scopes:1,active:1,failures:2,resources:1});
  assert.equal(report.pending,0);assert.equal(report.lifetimeFailures,0);
  console.log('ACTUAL_LEDGER_REGRESSION',JSON.stringify(report));
 }else {
  const host=installPreparationHost(capacity);
  const boot=await import('/tmp/work/server/lifecycle/bootTimers.ts');
  let release!:()=>void;let entered!:()=>void;
  const gate=new Promise<void>(yes=>{release=yes;});const entry=new Promise<void>(yes=>{entered=yes;});
  const originalError=new Error('Authored original task result');
  let fires=0;
  const body=async()=>{fires++;entered();await gate;await writeFile(join(dir,'original'),'persisted-before-drain');if(mode==='boot-original-failure')throw originalError;};
  assert.equal(boot.scheduleInitialJanitor(body,1),true);
  assert.equal(boot.scheduleInitialJanitor(body,1),false);
  const deadline=setTimeout(()=>{throw new Error('Actual callback did not start');},2000);
  await entry;clearTimeout(deadline);
  // Retain a real graph-startup losing task while stop seals other callbacks.
  const graph=boot.holdOriginalGraphStartup(async()=>{await gate;await writeFile(join(dir,'graph-original'),'joined');});
  const stopped=boot.sealAndDrainBootTimers();assert.equal(stopped,boot.sealAndDrainBootTimers());
  let drained=false;void stopped.then(()=>{drained=true;});await Promise.resolve();
  assert.equal(drained,false);assert.equal(boot.scheduleInitialLearning(()=>writeFile(join(dir,'forbidden'),'wrong'),1),false);
  release();await stopped;await graph;const report=await host.stop();
  assert.equal(await readFile(join(dir,'original'),'utf8'),'persisted-before-drain');assert.equal(await readFile(join(dir,'graph-original'),'utf8'),'joined');
  await assert.rejects(readFile(join(dir,'forbidden')),{code:'ENOENT'});assert.equal(fires,1);assert.equal(report.pending,0);
  const frontier=boot.bootTimerFrontier();assert.equal(frontier.find(x=>x.label==='janitor-initial-maintenance')?.fires,1);
  if(mode==='boot-original-failure') {assert.equal(report.taskOutcomeFailures,1);assert.equal(report.ownerFailures,0);assert.equal(report.lifetimeFailures,1);assert.equal(report.failures[0].original,originalError);assert.equal(report.state,'INCOMPLETE');}
  else {assert.equal(report.lifetimeFailures,0);assert.equal(report.ownerFailures,0);}
  assert.deepEqual(report.capacity,capacity);assert.ok(report.highWater.active>=2);
  console.log('ACTUAL_BOOT_REGRESSION',JSON.stringify({report,frontier}));
 }
}finally {await rm(dir,{recursive:true,force:true});}
