/** Actual original daemon module and real startup/filesystem paths. No task-list,
 * method, clock, Redis, storage, actor or import replacements. No process.exit0.
 * Covers immediate stop during original startup only, not an active actor/tick.
 */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {installPreparationHost} from '/tmp/work/services/lifecycle/bootstrapAuthority.ts';
const keys=['scopes','active','failures','resources']as const;
const values=keys.map(key=>{const n=Number(process.env['SILHOUETTE_OWNER_'+key.toUpperCase()]);assert.ok(Number.isSafeInteger(n)&&n>0);return n;});
const host=installPreparationHost({scopes:values[0],active:values[1],failures:values[2],resources:values[3]});
const mode=process.argv[2];assert.ok(mode==='startup-stop'||mode==='startup-persistence-denied');
const cwd=process.cwd();const dir=await mkdtemp(join(tmpdir(),'authored-daemon-regression-'));process.chdir(dir);
let server:ReturnType<typeof spawn>|undefined;
let serverExit:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
let redisObserver:any;
let SocketClosedUnexpectedlyError:any;
let originalFailure:unknown;let originalFailed=false;
const cleanup:unknown[]=[];
let expectedShutdownSocketClose=false;
try {
 await copyFile('/tmp/work/silhouette.config.example.json',join(dir,'silhouette.config.json'));
 await mkdir(join(dir,'data'),{recursive:true});
 const migrations=join(dir,'db','migrations','sqlite');await mkdir(migrations,{recursive:true});
 const originals=await readdir('/tmp/work/db/migrations/sqlite');
 for(const name of originals.sort()) {
  if(!name.endsWith('.up.sql'))continue;
  const source=await readFile(join('/tmp/work/db/migrations/sqlite',name));
  await writeFile(join(migrations,name),source);
  assert.deepEqual(await readFile(join(migrations,name)),source);
 }
 // These are exact original migrationfiles; SqliteService itself applies them.

 // Real original9task snapshot, all futurelastRun so no external/model task can
 // become due if a startup implementation accidentally reaches its tick.
 const taskNames=['Heartbeat','Narrator','Evolution_Goals','Curiosity','Tool_Evolution','Janitor','SelfDev','Dreamer','Self-Healing Kernel'];
 const original={tasks:Object.fromEntries(taskNames.map(name=>[name,{lastRun:Date.now()+86400000,runCount:7,errCount:2}])),updatedAt:Date.now()};
 await writeFile(join(dir,'data/daemon_state.json'),JSON.stringify(original));
 // Real pinned native dependency, already read-only in checks; no fetched
 // code or local-service fallback inside this process.
 const assetRoot='/tmp/work/node_modules/.silhouette-native-redis';
 const asset=JSON.parse(await readFile(join(assetRoot,'asset.json'),'utf8'));
 assert.equal(asset.archive_sha256,'c97e57b0df330a9e091cacff012bebe763c275398cf36ff44cdba876814b595b');
 const binary=join(assetRoot,'redis-server');const bytes=await readFile(binary);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.binary_sha256);
 process.env.REDIS_URL='redis://127.0.0.1:6499';
 server=spawn(binary,['--bind','127.0.0.1','--port','6499','--save','','--appendonly','no','--dir',dir],{stdio:['ignore','inherit','inherit']});
 serverExit=new Promise((resolve,reject)=>{server!.once('error',reject);server!.once('close',(code,signal)=>resolve({code,signal}));});
 void serverExit.catch(()=>undefined);
 // Real Redis client PONG, bounded readiness wait (not producttestretry).
 const redis=await import('/tmp/work/node_modules/redis/dist/index.js');
 const {createClient}=redis;SocketClosedUnexpectedlyError=redis.SocketClosedUnexpectedlyError;
 redisObserver=createClient({url:process.env.REDIS_URL,socket:{connectTimeout:500,reconnectStrategy:false}});
 redisObserver.on('error',()=>undefined);
 let ready=false;const until=Date.now()+1500;
 while(Date.now()<until&&!ready){
  try{await redisObserver.connect();assert.equal(await redisObserver.ping(),'PONG');ready=true;}
  catch(error){if(server.exitCode!==null)throw error;await new Promise(resolve=>setTimeout(resolve,25));}
 }
 assert.ok(ready,'Actual Redis PONG required before product import');
 // Configure provider-off policy before the actual service graph is imported.
 // This is the real documented isolated mode, not a dependency substitute.
 await import('/tmp/work/tests/setup/require-cloud-only.ts');
 await import('/tmp/work/server/config/runtimeCredentials.ts');
 const {UnifiedDaemon}=await import('/tmp/work/services/daemon/unifiedDaemon.ts');
 const daemon=new UnifiedDaemon();
 const {redisClient}=await import('/tmp/work/services/redisClient.ts');
 await redisClient.connect();assert.equal(redisClient.isMockMode(),false);
 const {sqliteService}=await import('/tmp/work/services/sqliteService.ts');
 assert.ok(sqliteService.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='incidents'").get());
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
 // Originaldaemonpersist rejection above is preserved before restoring
 // fixturepermissions, so unrelated storage shutdown can run legitimately.
 if(mode==='startup-persistence-denied')await chmod(join(dir,'data'),0o755);
 const runtime=await import('/tmp/work/services/lifecycle/runtimeStopBindings.ts');
 const shutdownErrors:unknown[]=[];
 try{await runtime.drainEvaluatedRuntimeProducers();}catch(error){shutdownErrors.push(error);}
 try{await runtime.closeEvaluatedRuntimeStorage();}catch(error){shutdownErrors.push(error);}
 const report=await host.stop();
 if(shutdownErrors.length)throw new AggregateError(shutdownErrors,'Original runtime shutdown failed');
 if(mode==='startup-persistence-denied'){assert.ok(report.ownerFailures>0);assert.equal(report.state,'INCOMPLETE');}
 else assert.equal(report.ownerFailures,0);
 assert.equal(report.pending,0);
 console.log('ACTUAL_DAEMON_START_STOP',JSON.stringify({mode,status:daemon.getRuntimeStatus(),report,coverage:'ACTUAL_STARTUP_STOP_ONLY_NOT_ACTIVE_TICK_OR_TRANSITIVE_CLOSURE'}));
}catch(error){originalFailed=true;originalFailure=error;}finally{
 // Realvendor SHUTDOWN NOSAVE requests orderlytermination, not processkill.
 // Alwaysjoinserver/clientcleanup even when productassertionfails. No fake0.
 if(redisObserver){
  try{await redisObserver.sendCommand(['SHUTDOWN','NOSAVE']);}
  catch(error){
   // Actual serverclosedconnection is only expected when joinedexitbelow0.
   if(SocketClosedUnexpectedlyError && error instanceof SocketClosedUnexpectedlyError)expectedShutdownSocketClose=true;
   else cleanup.push(error);
  }
  try{if(redisObserver.isOpen)await redisObserver.close();}catch(error){cleanup.push(error);}
 }
 if(serverExit){try{const exited=await serverExit;assert.equal(exited.signal,null);assert.equal(exited.code,0);}catch(error){cleanup.push(error);}}
 else if(server)cleanup.push(new Error('Original Redis server exit receipt unavailable'));
 // Shutdown socket closure isexpected for realRedisSHUTDOWN, never validates
 // product. Preserve diagnostic count, reject otherclose failures via status.
 console.log('REAL_REDIS_FIXTURE_CLOSE',JSON.stringify({serverCode:server?.exitCode,serverSignal:server?.signalCode,expectedShutdownSocketClose,cleanupFailures:cleanup.length}));
 // This fixture never claims that API settlement proves physical closure. Its
 // external runner additionally requires natural process/group exit and EOF.
 try{await chmod(join(dir,'data'),0o755);}catch(error){cleanup.push(error);}
 process.chdir(cwd);
 // Keep authored native store files until the enclosing process/namespace has
 // actually exited. Do not unlink a graph that host coverage labels incomplete.
}

if(originalFailed||cleanup.length)throw new AggregateError([...(originalFailed?[originalFailure]:[]),...cleanup],'Original fixture or cleanup failed',{cause:originalFailure});
