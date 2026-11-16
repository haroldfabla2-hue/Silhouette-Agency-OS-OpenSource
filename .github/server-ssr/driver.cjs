'use strict';
// Trusted builtins only. No application imports, package hooks or generated declarations.
const fs=require('fs'),os=require('os'),net=require('net'),cp=require('child_process'),crypto=require('node:crypto');
const GUARDS={"runtime version": "G001", "nonroot uid/gid": "G002", "environment allowlist": "G003", "capabilities ": "G004", "no new privileges": "G005", "seccomp filter": "G006", "AppArmor default": "G007", "kernel hard limits": "G008", "kernel CPU quota": "G009", "loopback only": "G010", "readonly denial": "G011", "host/credential path absent": "G012", "private PID namespace": "G013", "readonly mount ": "G014", "network timeout not proof": "G015", "outbound connected": "G016", "controller acknowledgment missing": "G017", "control input oversized": "G018", "control input invalid": "G019", "controller disconnected": "G020"};
let guestGuard='G000_UNCLASSIFIED';
function assert(x,m){guestGuard=GUARDS[m]||GUARDS[Object.keys(GUARDS).find(k=>m.startsWith(k))]||'G000_UNCLASSIFIED';if(!x)throw Error('fixed guest assertion');}
function fail(m){guestGuard=GUARDS[m]||'G000_UNCLASSIFIED';return Error('fixed guest failure');}
function read(path,code){guestGuard=code;return fs.readFileSync(path,'utf8');}
function frame(x){process.stdout.write(JSON.stringify(x)+'\n');}
async function canaries(){
 assert(process.version==='v22.23.4','runtime version');
 assert(process.getuid()===65534&&process.getgid()===65534,'nonroot uid/gid');
 const expected={PATH:'/usr/local/bin',HOME:'/nonexistent',TMPDIR:'/tmp',LANG:'C.UTF-8',NODE_DISABLE_COMPILE_CACHE:'1'};
 assert(JSON.stringify(Object.fromEntries(Object.entries(process.env).sort()))===JSON.stringify(Object.fromEntries(Object.entries(expected).sort())),'environment allowlist');
 const status=read('/proc/self/status','G030');
 for(const name of ['CapEff','CapPrm','CapBnd'])assert(new RegExp('^'+name+':\\s+0+$','m').test(status),'capabilities '+name);
 assert(/^NoNewPrivs:\s+1$/m.test(status),'no new privileges');assert(/^Seccomp:\s+2$/m.test(status),'seccomp filter');
 assert(read('/proc/self/attr/current','G031').startsWith('docker-default'),'AppArmor default');
 const cg={};for(const name of ['memory.max','memory.swap.max','pids.max','cpu.max','memory.events'])cg[name]=read('/sys/fs/cgroup/'+name,{'memory.max':'G032','memory.swap.max':'G033','pids.max':'G034','cpu.max':'G035','memory.events':'G036'}[name]).trim();
 assert(cg['memory.max']==='6442450944'&&cg['memory.swap.max']==='0'&&cg['pids.max']==='32','kernel hard limits');
 const cpu=cg['cpu.max'].split(/\s+/).map(Number);assert(cpu[0]>0&&cpu[0]===cpu[1],'kernel CPU quota');
 assert(Object.keys(os.networkInterfaces()).every(n=>n==='lo'),'loopback only');
 guestGuard='G037';await new Promise((resolve,reject)=>{const s=net.connect({host:'198.51.100.1',port:9});s.on('connect',()=>{s.destroy();reject(fail('outbound connected'));});s.on('error',e=>['ENETUNREACH','EACCES','EPERM'].includes(e.code)?resolve():reject(e));s.setTimeout(1000,()=>{s.destroy();reject(fail('network timeout not proof'));});});
 for(const path of ['/source/package.json','/root-write-probe']){let denied=false;try{fs.writeFileSync(path,'readonly-denial-probe');}catch(e){denied=['EROFS','EACCES','EPERM'].includes(e.code);}assert(denied,'readonly denial');}
 guestGuard='G038';for(const root of ['/source/dist','/source/node_modules/.vite-temp']){const p=root+'/write-canary';fs.writeFileSync(p,'private');fs.unlinkSync(p);}
 fs.writeFileSync('/tmp/private-probe','private');fs.unlinkSync('/tmp/private-probe');
 for(const path of ['/var/run/docker.sock','/run/docker.sock','/source/.git','/home/runner','/github','/host','/source/.env','/source/.env.local'])assert(!fs.existsSync(path),'host/credential path absent');
 guestGuard='G039';const pids=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x));assert(pids.length===1&&pids[0]==='1'&&process.pid===1,'private PID namespace');
 const mounts=read('/proc/mounts','G040').trim().split('\n').map(l=>l.split(' '));
 for(const target of ['/','/source','/source/node_modules','/source/node_modules/@qdrant/js-client-rest','/control','/denied'])assert(mounts.some(m=>m[1]===target&&m[3].split(',').includes('ro')),'readonly mount '+target);
 for(const target of ['/source/dist','/source/node_modules/.vite-temp','/tmp'])assert(mounts.some(m=>m[1]===target&&m[2]==='tmpfs'&&['rw','noexec','nosuid','nodev'].every(x=>m[3].split(',').includes(x))),'control input invalid');
 assert(mounts.some(m=>m[1]==='/dev/shm'&&m[2]==='tmpfs'&&['rw','nosuid','nodev','noexec','size=16384k'].every(x=>m[3].split(',').includes(x))),'kernel hard limits');
 const namespaces={};for(const name of ['pid','mnt','net','ipc','uts','cgroup']){guestGuard={pid:'G041',mnt:'G042',net:'G043',ipc:'G044',uts:'G045',cgroup:'G046'}[name];namespaces[name]=fs.readlinkSync('/proc/self/ns/'+name)};
 return {namespaces,cgroup:cg,uid:process.getuid(),runtime:process.version,checks:'ALL_CANARIES_PASSED'};
}
let terminal=false;
function failOnce(guard){if(terminal)return;terminal=true;process.stdin.destroy();process.stdout.write(JSON.stringify({kind:'failure',guestGuard:guard,errorClass:'G_ASSERT_OR_OS'})+'\n',()=>process.exit(125));}
async function main(){
 const stage=process.argv[2],identityHash=process.argv[3];
 assert(['SSR'].includes(stage)&&/^[a-f0-9]{64}$/.test(identityHash||''),'control input invalid');
 assert(crypto.createHash('sha256').update(fs.readFileSync('/control/identities.json')).digest('hex')===identityHash,'control input invalid');
 const canary=await canaries();frame({kind:'ready',canary});
 guestGuard='G047';await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(fail('controller acknowledgment missing')),10000);process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{data+=chunk;if(data.length>64){clearTimeout(timer);reject(fail('control input oversized'));}if(data.includes('\n')){clearTimeout(timer);data==='GO\n'?resolve():reject(fail('control input invalid'));}});process.stdin.on('end',()=>reject(fail('controller disconnected')));});
 guestGuard='G048';const child=cp.spawn('/usr/local/bin/node',['--max-old-space-size=2560','/control/stage-runner.cjs',stage,identityHash],{env:process.env,stdio:['ignore','pipe','pipe'],cwd:'/source'});
 let size=0,errorSize=0,overflow=false,chunks=[];
 child.stdout.on('data',b=>{size+=b.length;if(size>131072){overflow=true;child.kill('SIGKILL');}else chunks.push(b);});
 child.stderr.on('data',b=>{errorSize+=b.length;if(errorSize>16384){overflow=true;child.kill('SIGKILL');}});
 child.on('error',()=>failOnce('G048'));
 child.on('close',(code,signal)=>{
  if(terminal)return;
  const bytes=Buffer.concat(chunks);let receipt;
  try{const text=bytes.toString('utf8');if(!text.endsWith('\n')||text.slice(0,-1).includes('\n'))throw Error();receipt=JSON.parse(text);}catch{failOnce('G048');return;}
  // One and only one terminal result; host separately schema-projects every eligible field.
  if(!receipt||receipt.mode!==stage&&receipt.stage!==stage){failOnce('G048');return;}
  frame({kind:'receipt',data:bytes.toString('base64')});
  terminal=true;process.stdin.destroy();
  const memoryEvents=fs.readFileSync('/sys/fs/cgroup/memory.events','utf8').trim();
  process.stdout.write(JSON.stringify({kind:'exit',code,signal,overflow,memoryEvents})+'\n',()=>{process.exitCode=overflow||signal||code!==0?125:0;});
 });
}
main().catch(()=>failOnce(guestGuard));
