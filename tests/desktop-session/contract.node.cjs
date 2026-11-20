const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {fork}=require('node:child_process');const crypto=require('node:crypto');
const entry=path.join(__dirname,'backend.fixture.cjs');const secret=()=>crypto.randomBytes(32).toString('hex');
async function withChild(mode,fn){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-session-fixture-'));
 const c=fork(entry,[mode],{cwd,silent:true,detached:process.platform!=='win32'});let bytes=0,log='',closed=false,forced=false;
 const messages=[],waiters=[];
 c.on('message',m=>{messages.push(m);for(const w of [...waiters])w();});
 c.stdout.on('data',collect);c.stderr.on('data',collect);c.on('error',()=>{});
 function collect(b){bytes+=b.length;if(bytes>65536){c.kill('SIGKILL');return;}log+=b;}
 const exit=new Promise(r=>c.once('exit',(code,signal)=>{closed=true;r({code,signal});}));
 const timer=setTimeout(()=>{forced=true;c.kill('SIGKILL');},4000);
 async function message(type){
  return Promise.race([new Promise(resolve=>{const check=()=>{const i=messages.findIndex(m=>m.type===type);if(i>=0){const at=waiters.indexOf(check);if(at>=0)waiters.splice(at,1);resolve(messages.splice(i,1)[0]);}};waiters.push(check);check();}),exit.then(()=>{throw Error('closed before '+type);})]);
 }
 const creds={sessionId:secret(),controlToken:secret(),apiToken:secret()};
 try{await message('fixture-listening');await fn({c,cwd,creds,message,exit,get log(){return log;},messages});assert.ok(!log.includes(creds.apiToken));assert.ok(!log.includes(creds.controlToken));}
 finally{
  clearTimeout(timer);if(!closed){forced=true;c.kill('SIGKILL');}await exit;
  if(process.platform!=='win32'){try{process.kill(-c.pid,0);forced=true;process.kill(-c.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
  if(process.platform!=='win32'){
   let gone=false;const until=Date.now()+1000;
   do{try{process.kill(-c.pid,0);}catch(e){if(e.code==='ESRCH'){gone=true;break;}throw e;}await new Promise(r=>setTimeout(r,20));}while(Date.now()<until);
   assert.ok(gone,'UNRESOLVED fixture process group');
  }
  assert.throws(()=>process.kill(c.pid,0),{code:'ESRCH'});fs.rmSync(cwd,{recursive:true,force:true});assert.ok(!fs.existsSync(cwd));assert.equal(forced,false,'fixture required forced parent cleanup');
 }
}
function request(port,token){return new Promise((resolve,reject)=>{const r=http.get({hostname:'127.0.0.1',port,headers:token?{authorization:'Bearer '+token}:{}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.once('error',reject);r.setTimeout(1000,()=>r.destroy(Error('timeout')));});}
const init=({c,creds})=>c.send({type:'desktop-init',...creds});
const stop=({c,creds})=>c.send({type:'desktop-shutdown',sessionId:creds.sessionId,controlToken:creds.controlToken});
test('no handshake means no initializer or filesystem store creation',()=>withChild('normal',async x=>{assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!fs.existsSync(path.join(x.cwd,'opened')));}));
test('real loopback ephemeral HTTP binding, token separation, owner shutdown and drain',()=>withChild('normal',async x=>{
 init(x);const ready=await x.message('desktop-ready');assert.equal(ready.host,'127.0.0.1');assert.equal(ready.pid,x.c.pid);assert.equal(ready.sessionId,x.creds.sessionId);
 assert.equal(await request(ready.port),401);assert.equal(await request(ready.port,x.creds.controlToken),401);assert.equal(await request(ready.port,x.creds.apiToken),200);
 x.c.send({type:'desktop-shutdown',sessionId:x.creds.sessionId,controlToken:secret()});assert.equal(await request(ready.port,x.creds.apiToken),200);
 stop(x);const ended=await x.message('desktop-stopped');assert.equal(ended.clean,true);assert.deepEqual(await x.exit,{code:0,signal:null});assert.ok(fs.existsSync(path.join(x.cwd,'drained')));
}));
test('disconnect during boot cannot announce ready, drains returned backend',()=>withChild('slow-boot',async x=>{init(x);await x.message('fixture-booting');x.c.disconnect();assert.deepEqual(await x.exit,{code:0,signal:null});assert.ok(fs.existsSync(path.join(x.cwd,'drained')));assert.ok(!x.messages.some(m=>m.type==='desktop-ready'));}));
test('boot exception has fixed failure and no private diagnostic',()=>withChild('boot-fail',async x=>{init(x);const failed=await x.message('desktop-failed');assert.equal(failed.code,'BOOT_FAILED');assert.ok(!x.messages.some(m=>m.type==='desktop-ready'));assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!fs.existsSync(path.join(x.cwd,'opened')));}));
test('auth adapter not-ready cannot announce desktop-ready',()=>withChild('bad-auth',async x=>{init(x);assert.equal((await x.message('desktop-failed')).code,'BOOT_FAILED');assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!x.messages.some(m=>m.type==='desktop-ready'));}));
test('drain rejection reports unclean and exits nonzero',()=>withChild('bad-drain',async x=>{init(x);await x.message('desktop-ready');stop(x);assert.equal((await x.message('desktop-stopped')).clean,false);assert.deepEqual(await x.exit,{code:1,signal:null});}));
test('drain timeout cannot claim clean or exit success',()=>withChild('hang-drain',async x=>{init(x);await x.message('desktop-ready');stop(x);assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!fs.existsSync(path.join(x.cwd,'drained')));assert.ok(x.log.includes('UNRESOLVED_PARTIAL_BOOT_OR_DRAIN'));}));

test('owner shutdown while booting drains without early ready',()=>withChild('slow-boot',async x=>{init(x);await x.message('fixture-booting');stop(x);const ended=await x.message('desktop-stopped');assert.equal(ended.clean,true);assert.deepEqual(await x.exit,{code:0,signal:null});assert.ok(fs.existsSync(path.join(x.cwd,'drained')));assert.ok(!x.messages.some(m=>m.type==='desktop-ready'));}));
test('owner disconnect after ready drains and exits naturally',()=>withChild('normal',async x=>{init(x);await x.message('desktop-ready');x.c.disconnect();assert.deepEqual(await x.exit,{code:0,signal:null});assert.ok(fs.existsSync(path.join(x.cwd,'drained')));}));
test('invalid handshake and unrelated IPC never initialize backend',()=>withChild('normal',async x=>{x.c.send({type:'desktop-init',sessionId:'bad',controlToken:x.creds.controlToken,apiToken:x.creds.apiToken});x.c.send({type:'desktop-shutdown',...x.creds});assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!fs.existsSync(path.join(x.cwd,'opened')));}));

test('owner stop during rejecting boot cannot erase failure',()=>withChild('slow-reject',async x=>{init(x);await x.message('fixture-booting');stop(x);assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!x.messages.some(m=>m.type==='desktop-ready'||m.type==='desktop-stopped'&&m.clean));}));
test('disconnect during rejecting boot cannot erase failure',()=>withChild('slow-reject',async x=>{init(x);await x.message('fixture-booting');x.c.disconnect();assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!x.messages.some(m=>m.type==='desktop-ready'||m.type==='desktop-stopped'&&m.clean));}));
test('unresolved boot has finite deadline then unclean exit without parent force',()=>withChild('hang-boot',async x=>{init(x);await x.message('fixture-booting');assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(x.log.includes('UNRESOLVED_PARTIAL_BOOT_OR_DRAIN'));assert.ok(!x.messages.some(m=>m.type==='desktop-ready'||m.type==='desktop-stopped'&&m.clean));}));
test('equal API/control credentials cannot initialize',()=>withChild('normal',async x=>{x.c.send({type:'desktop-init',...x.creds,apiToken:x.creds.controlToken});assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!fs.existsSync(path.join(x.cwd,'opened')));}));

test('second ownership call rejects before any initializer',()=>withChild('reentry',async x=>{assert.equal((await x.message('fixture-reentry')).rejected,true);init(x);await x.message('desktop-ready');stop(x);assert.deepEqual(await x.exit,{code:0,signal:null});}));
test('disconnect after failure receipt cannot race into success',()=>withChild('boot-fail',async x=>{init(x);assert.equal((await x.message('desktop-failed')).code,'BOOT_FAILED');if(x.c.connected)x.c.disconnect();assert.deepEqual(await x.exit,{code:1,signal:null});assert.ok(!x.messages.some(m=>m.type==='desktop-ready'||m.type==='desktop-stopped'&&m.clean));}));
