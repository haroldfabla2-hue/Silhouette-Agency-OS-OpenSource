// Actual synchronous filesystem and service. Run only in a disposable private
// network/filesystem. No agent result or provider is emulated.
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ContinuousMemoryService} from '../../services/memory/continuousMemory';
const mode=process.argv[2];const file='data/wal/memory_wal.json';
const service=new ContinuousMemoryService();
if(mode==='durable-before-return'){
 service.initialize();
 const id=service.logBeforeProcessing('wal-fixture','TASK_STARTED',{taskDescription:'original unfinished fixture task',input:'original\ninput | separators'});
 assert.ok(fs.existsSync(file),'write-ahead log must exist before returning its ID');
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).find((e:any)=>e.id===id)?.status,'PENDING');
 console.log(JSON.stringify({mode, durable_before_work:true,id}));
 // Deliberate immediate exit: no microtask or graceful-shutdown opportunity.
 process.exit(0);
}else if(mode==='shutdown-pending'){
 service.initialize();
 const id=service.logBeforeProcessing('wal-fixture','TASK_STARTED',{taskDescription:'shutdown unfinished fixture'});
 service.shutdown();
 await Promise.resolve();
 const entry=JSON.parse(fs.readFileSync(file,'utf8')).find((e:any)=>e.id===id);
 assert.equal(entry?.status,'PENDING','shutdown cannot complete unfinished work');
 console.log(JSON.stringify({mode,pending_not_committed:true}));
}else if(mode==='recovery'){
 service.initialize();
 const records=JSON.parse(fs.readFileSync(file,'utf8'));
 const entry=records.find((e:any)=>e.data.taskDescription==='original unfinished fixture task');
 assert.equal(entry?.status,'INTERRUPTED','recording recovery is not task completion');
 assert.equal(entry.data.input,'original\ninput | separators');
 assert.equal(service.getStats().memoriesSaved,0,'recovery notice is not a completed-task memory');
 service.shutdown();
 console.log(JSON.stringify({mode,original_payload_preserved:true,no_reexecution_or_completion_claim:true}));
}else if(mode==='corrupt'){
 fs.mkdirSync('data/wal',{recursive:true});fs.writeFileSync(file,'{broken original WAL');
 const before=fs.readFileSync(file);
 assert.throws(()=>service.initialize());
 assert.throws(()=>service.logBeforeProcessing('wal-fixture','TASK_STARTED',{input:'must not overwrite'}));
 assert.deepEqual(fs.readFileSync(file),before);
 console.log(JSON.stringify({mode,corrupt_original_preserved:true,new_writes_refused:true}));
}else if(mode==='commit'){
 service.initialize();
 const input={input:'complete original input',metadata:{original:'before'}};
 const id=service.logBeforeProcessing('wal-fixture','MESSAGE_RECEIVED',input);
 input.input='later caller mutation';input.metadata.original='later';
 assert.throws(()=>service.logBeforeProcessing('../escape','TASK_STARTED',{input:'must not create outside memory'}),/Invalid WAL entry/);
 service.initialize();
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).find((e:any)=>e.id===id)?.status,'PENDING','repeated initialization is not crash recovery');
 service.commitEntry(id,'actual authored result supplied by caller');
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).find((e:any)=>e.id===id)?.status,'COMMITTED');
 const memory=fs.readFileSync('data/agents/wal-fixture/MEMORY.md','utf8');
 assert.ok(memory.includes(`WAL_COMMIT:${id}`));
 assert.ok(memory.includes('complete original input'));
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).find((e:any)=>e.id===id).data.metadata.original,'before');
 service.commitEntry(id,'actual authored result supplied by caller');
 assert.equal(fs.readFileSync('data/agents/wal-fixture/MEMORY.md','utf8'),memory,'same commit must not append twice');
 service.shutdown();
 console.log(JSON.stringify({mode,commit_receipt_read_back:true,retry_idempotent:true,task_correctness_not_certified:true}));
}else if(mode==='failed-append'){
 service.initialize();
 const id=service.logBeforeProcessing('wal-fixture','MESSAGE_RECEIVED',{input:'original awaiting memory receipt'});
 fs.mkdirSync('data/agents/wal-fixture/MEMORY.md',{recursive:true});
 assert.throws(()=>service.commitEntry(id,'authored input, not provider output'), (error: any) => error?.code === 'EISDIR', 'preserve original real append filesystem error');
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).find((e:any)=>e.id===id)?.status,'PENDING');
 assert.equal(service.getStats().memoriesSaved,0);
 service.shutdown();
 console.log(JSON.stringify({mode,actual_filesystem_append_failure_not_committed:true}));
}else if(mode==='failed-wal-write'){
 service.initialize();
 service.logBeforeProcessing('wal-fixture','TASK_STARTED',{input:'retained original'});
 const before=fs.readFileSync(file);
 // A real target collision, on Linux and Windows, rather than relying on
 // chmod denying a privileged or Windows process.
 const retained=file+'.retained';fs.renameSync(file,retained);fs.mkdirSync(file);
 try{
  assert.throws(()=>service.logBeforeProcessing('wal-fixture','TASK_STARTED',{input:'must not return success'}));
  assert.deepEqual(fs.readFileSync(retained),before);
  assert.equal(service.getWALSize(),1);
 }finally{fs.rmdirSync(file);fs.renameSync(retained,file);}
 assert.deepEqual(fs.readFileSync(file),before);
 assert.throws(()=>service.shutdown(),'storage failure remains explicit until recovery in another process');
 console.log(JSON.stringify({mode,actual_write_failure_visible:true,previous_file_preserved:true,no_phantom_entry:true}));
}else if(mode==='retention'){
 fs.mkdirSync('data/wal',{recursive:true});
 const base={timestamp:Date.now()-3600000,agentId:'wal-fixture',type:'TASK_STARTED',data:{taskDescription:'old original'}};
 fs.writeFileSync(file,JSON.stringify([{...base,id:'old-pending',status:'PENDING'},{...base,id:'old-committed',status:'COMMITTED'}]));
 service.initialize();(service as any).periodicConsolidation();
 const records=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(records.find((e:any)=>e.id==='old-pending')?.status,'INTERRUPTED');
 assert.equal(records.some((e:any)=>e.id==='old-committed'),false,'existing committed-WAL retention policy remains');
 service.shutdown();
 console.log(JSON.stringify({mode,old_interrupted_payload_not_pruned:true,eternal_memory_whole_product_not_certified:true}));
}else{throw new Error('explicit WAL probe mode required');}
process.exit(0);
