'use strict';
// Proposed direct-Node actual daemon; no fake service/task/clock/methods.
const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const taskNames=['Heartbeat','Narrator','Evolution_Goals','Curiosity','Tool_Evolution','Janitor','SelfDev','Dreamer','Self-Healing Kernel'].sort();
const key='lock:daemon:self-healing kernel';let inspector,writer;
const baseline=fs.readFileSync('/work/data/daemon_state.json','utf8');
(async()=>{
 const {createProducerScope,bindProducerScope}=await import('./server/desktop/producerScope.js');
 const scope=createProducerScope();bindProducerScope(scope);
 const {sqliteService}=await import('./services/sqliteService.js');
 const {incidentRegistry}=await import('./services/incidentRegistry.js');
 const {configLoader}=await import('./server/config/configLoader.js');
 const {redisClient}=await import('./services/redisClient.js');
 const {createClient}=await import('redis');
 const {UnifiedDaemon}=await import('./services/daemon/unifiedDaemon.js');
 assert.equal(process.getuid(),65534);assert.equal(process.getgid(),65534);
 const status=fs.readFileSync('/proc/self/status','utf8');
 for(const cap of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])assert.match(status,new RegExp('^'+cap+':\\s+0+$','m'));assert.match(status,/^NoNewPrivs:\s+1$/m);
 assert.equal(process.env.SILHOUETTE_PROVIDERS,'off');assert.equal(process.env.SILHOUETTE_BOOT_MODE,'normal');assert(!process.env.REDIS_URL);assert.equal(process.env.REDIS_PORT,'16379');
 assert.equal(configLoader.getConfig().autonomy.enabled,false);assert.equal(incidentRegistry.getOpenIncidents().length,0);
 await redisClient.connect();assert.equal(redisClient.isMockMode(),false);
 inspector=createClient({url:'redis://127.0.0.1:16379',socket:{reconnectStrategy:false}});await inspector.connect();assert.equal(await inspector.ping(),'PONG');
 assert.equal((await inspector.sendCommand(['CONFIG','GET','appendonly']))[1],'no');
 assert.equal((await inspector.sendCommand(['CONFIG','GET','save']))[1],'');
 if(process.argv[2]==='first')assert.equal(await inspector.dbSize(),0);
 if(process.argv[2]==='held-lock'){
  const held=new UnifiedDaemon();await held.start();await sleep(150);held.stopAdmission();scope.stopAdmission();await scope.drain(4000);await held.flushStoppedState();
  const after=JSON.parse(fs.readFileSync('/work/data/daemon_state.json','utf8'));assert.deepEqual(after.tasks,JSON.parse(baseline).tasks);assert.equal(redisClient.isMockMode(),false);assert.equal(await inspector.get(key),'locked');
  await redisClient.disconnect();await inspector.quit();inspector=undefined;sqliteService.close();assert.equal(sqliteService.db.open,false);console.log(JSON.stringify({scope:'actual-daemon-held-real-lock-phase',metadataUnchanged:true,nonMock:true,allKnownHandlesClosed:true}));return;
 }
 // All healthy actual imports are complete before FIFO is exposed. External supervisor creates it now.
 console.log('DAEMON_FIXTURE_READY');
 while(!fs.existsSync('/work/logs/system_errors.log'))await sleep(10);
 assert(fs.statSync('/work/logs/system_errors.log').isFIFO());
 const daemon=new UnifiedDaemon();await daemon.start();assert.equal(daemon.getRuntimeStatus().registeredTaskCount,9);
 // Nonblocking opening writer succeeds only once actual task's real FIFO reader is waiting.
 const deadline=Date.now()+3000;
 while(writer===undefined){try{writer=fs.openSync('/work/logs/system_errors.log',fs.constants.O_WRONLY|fs.constants.O_NONBLOCK);}catch(e){if(e.code!=='ENXIO'||Date.now()>deadline)throw e;await sleep(10);}}
 assert(scope.snapshot().active>=1);assert.equal(await inspector.get(key),'locked');const ttl=await inspector.pTTL(key);assert(ttl>0&&ttl<=899000);assert.equal(redisClient.isMockMode(),false);
 assert.equal(await redisClient.acquireLock(key,899000),false);assert.equal(redisClient.isMockMode(),false);
 assert.equal(fs.readFileSync('/work/data/daemon_state.json','utf8'),baseline);assert(!fs.existsSync('/work/data/daemon_state.json.tmp'));
 daemon.stopAdmission();scope.stopAdmission();let drained=false;const drain=scope.drain(4000).then(()=>{drained=true;});
 await sleep(100);assert(!drained);assert.equal(fs.readFileSync('/work/data/daemon_state.json','utf8'),baseline);
 fs.closeSync(writer);writer=undefined;await drain;await daemon.flushStoppedState();
 const first=JSON.parse(fs.readFileSync('/work/data/daemon_state.json','utf8'));assert.deepEqual(Object.keys(first.tasks).sort(),taskNames);const actual=first.tasks['Self-Healing Kernel'];assert.equal(actual.runCount,1);assert.equal(actual.errCount,0);assert(actual.lastRun>0);assert(!fs.existsSync('/work/data/daemon_state.json.tmp'));
 assert.equal(incidentRegistry.getOpenIncidents().length,0);assert.equal(redisClient.isMockMode(),false);
 console.log('DAEMON_PHASE1_PASS');
 // Node process handles must disconnect; private state APIs are never overridden.
 await redisClient.disconnect();await inspector.quit();inspector=undefined;sqliteService.close();assert.equal(sqliteService.db.open,false);
 console.log(JSON.stringify({scope:'actual-daemon-real-redis-self-healing-task-only',tasks:taskNames,runCount:actual.runCount,errCount:actual.errCount,lockTTL:ttl,drainWaitedForRealFIFO:true,nonMock:true,allKnownHandlesClosed:true,fullBackend:false}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(writer!==undefined)fs.closeSync(writer);if(inspector?.isOpen)await inspector.quit();});
