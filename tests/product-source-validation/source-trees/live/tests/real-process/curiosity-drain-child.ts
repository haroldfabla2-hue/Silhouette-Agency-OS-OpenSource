/** Real service/bus/filesystem and optional complete app OS-signal shutdown.
 * Run only in an isolated disposable cwd with providers OFF. No fake transports. */
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const mode=process.argv[2];
const appMode=mode.startsWith('app-');
const blocked=mode.endsWith('blocked');
fs.mkdirSync('data',{recursive:true});
if(blocked) fs.writeFileSync('data/curiosity_gaps.json','{original corrupt fixture');
if(appMode){
 // OFF first boot deliberately ignores env migration. Pin the disposable
 // listener in an authored config instead of assuming PORT changed it.
 fs.writeFileSync('silhouette.config.json',JSON.stringify({system:{name:'isolated-shutdown-fixture',port:Number(process.env.PORT),env:'test',version:'fixture'}}));
 await import('../../server/index');
}
const {curiosity}=await import('../../services/curiosityService');
const {systemBus}=await import('../../services/systemBus');
const {SystemProtocol}=await import('../../types');
if(blocked) await assert.rejects(curiosity.waitForPersistence());
else await curiosity.waitForPersistence();
if(appMode){
 const url=`http://127.0.0.1:${process.env.PORT}/health`;
 let listening=false;
 for(let i=0;i<40;i++){
  try{const response=await fetch(url);if(response.status===200||response.status===503){listening=true;break;}}catch{/* wait for actual listener */}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.ok(listening,'actual HTTP listener must be available');
}
if(!blocked){
 for(let i=0;i<250;i++)systemBus.emit(SystemProtocol.MEMORY_CREATED,{content:'DrainFixtureTopic authored local observation'},'shutdown-fixture');
}
if(appMode){
 console.log(JSON.stringify({mode,expected_received:blocked?0:250,production_data:false,providers:'off',signal:'OS SIGTERM'}));
 process.kill(process.pid,'SIGTERM');
}else if(blocked){
 await assert.rejects(curiosity.shutdown());
 assert.equal(fs.readFileSync('data/curiosity_gaps.json','utf8'),'{original corrupt fixture');
 await assert.rejects(curiosity.addGap('late','must not erase original'));
 console.log(JSON.stringify({mode,original_preserved:true,shutdown_rejected:true}));
 process.exit(0);
}else{
 const accepted=curiosity.addGap('accepted-before-close','original accepted question');
 const first=curiosity.shutdown();
 assert.equal(curiosity.shutdown(),first,'shutdown must be idempotent');
 await assert.rejects(curiosity.addGap('late','new input refused'),/shutting down/);
 systemBus.emit(SystemProtocol.MEMORY_CREATED,{content:'AfterFenceTopic must not be accepted'},'shutdown-fixture');
 await first;await accepted;
 const saved=JSON.parse(fs.readFileSync('data/curiosity_gaps.json','utf8'));
 assert.equal(saved.topics.drainfixturetopic.count,250);
 assert.equal(saved.topics.afterfencetopic,undefined);
 assert.equal(saved.gaps[0].question,'original accepted question');
 assert.equal(curiosity.getStatus().storage.mutationsAllowed,false);
 console.log(JSON.stringify({mode,accepted_events_drained:250,accepted_operation_retained:true,post_fence_input_refused:true}));
 process.exit(0);
}
