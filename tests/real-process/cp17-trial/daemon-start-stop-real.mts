/** Actual original daemon module and real startup/filesystem paths. No task-list,
 * method, clock, Redis, storage, actor or import replacements. No process.exit0.
 * Covers immediate stop during original startup only, not an active actor/tick.
 */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installPreparationHost} from '/tmp/work/services/lifecycle/bootstrapAuthority.ts';
const keys=['scopes','active','failures','resources']as const;
const values=keys.map(key=>{const n=Number(process.env['SILHOUETTE_OWNER_'+key.toUpperCase()]);assert.ok(Number.isSafeInteger(n)&&n>0);return n;});
const host=installPreparationHost({scopes:values[0],active:values[1],failures:values[2],resources:values[3]});
const mode=process.argv[2];assert.ok(mode==='startup-stop'||mode==='startup-persistence-denied');
const cwd=process.cwd();const dir=await mkdtemp(join(tmpdir(),'authored-daemon-regression-'));process.chdir(dir);
try {
 await copyFile('/tmp/work/silhouette.config.example.json',join(dir,'silhouette.config.json'));
 await mkdir(join(dir,'data'),{recursive:true});
 // Real original9task snapshot, all futurelastRun so no external/model task can
 // become due if a startup implementation accidentally reaches its tick.
 const taskNames=['Heartbeat','Narrator','Evolution_Goals','Curiosity','Tool_Evolution','Janitor','SelfDev','Dreamer','Self-Healing Kernel'];
 const original={tasks:Object.fromEntries(taskNames.map(name=>[name,{lastRun:Date.now()+86400000,runCount:7,errCount:2}])),updatedAt:Date.now()};
 await writeFile(join(dir,'data/daemon_state.json'),JSON.stringify(original));
 // Configure provider-off policy before the actual service graph is imported.
 // This is the real documented isolated mode, not a dependency substitute.
 await import('/tmp/work/tests/setup/require-cloud-only.ts');
 await import('/tmp/work/server/config/runtimeCredentials.ts');
 const {UnifiedDaemon}=await import('/tmp/work/services/daemon/unifiedDaemon.ts');
 const daemon=new UnifiedDaemon();
 if(mode==='startup-persistence-denied')await chmod(join(dir,'data'),0o555);
 const startup=daemon.start();assert.equal(startup,daemon.start());
 const stopped=daemon.stop();assert.equal(stopped,daemon.stop());
 await startup;
 if(mode==='startup-persistence-denied')await assert.rejects(stopped,error=>error instanceof AggregateError);
 else await stopped;
 assert.equal(daemon.getRuntimeStatus().running,false);
 assert.equal(daemon.getRuntimeStatus().registeredTaskCount,9);
 await assert.rejects(daemon.start());
 const saved=JSON.parse(await readFile(join(dir,'data/daemon_state.json'),'utf8'));
 for(const name of taskNames){assert.equal(saved.tasks[name].runCount,7);assert.equal(saved.tasks[name].errCount,2);assert.equal(saved.tasks[name].lastRun,original.tasks[name].lastRun);}
 const report=await host.stop();
 if(mode==='startup-persistence-denied'){assert.ok(report.ownerFailures>0);assert.equal(report.state,'INCOMPLETE');}
 else assert.equal(report.ownerFailures,0);
 assert.equal(report.pending,0);
 console.log('ACTUAL_DAEMON_START_STOP',JSON.stringify({mode,status:daemon.getRuntimeStatus(),report,coverage:'ACTUAL_STARTUP_STOP_ONLY_NOT_ACTIVE_TICK_OR_TRANSITIVE_CLOSURE'}));
}finally{
 // This fixture never claims that API settlement proves physical closure. Its
 // external runner additionally requires natural process/group exit and EOF.
 await chmod(join(dir,'data'),0o755);process.chdir(cwd);
 // Keep authored native store files until the enclosing process/namespace has
 // actually exited. Do not unlink a graph that host coverage labels incomplete.
}
