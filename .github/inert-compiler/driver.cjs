'use strict';
// Trusted builtins only. No application imports, package hooks or generated declarations.
const fs=require('fs'),os=require('os'),net=require('net'),cp=require('child_process');
function assert(x,m){if(!x)throw Error(m);}
function frame(x){process.stdout.write(JSON.stringify(x)+'\n');}
async function canaries(){
 assert(process.version==='v22.23.4','runtime version');
 assert(process.getuid()===65534&&process.getgid()===65534,'nonroot uid/gid');
 const expected={PATH:'/usr/local/bin',HOME:'/nonexistent',TMPDIR:'/tmp',LANG:'C.UTF-8',NODE_DISABLE_COMPILE_CACHE:'1'};
 assert(JSON.stringify(Object.fromEntries(Object.entries(process.env).sort()))===JSON.stringify(Object.fromEntries(Object.entries(expected).sort())),'environment allowlist');
 const status=fs.readFileSync('/proc/self/status','utf8');
 for(const name of ['CapEff','CapPrm','CapBnd'])assert(new RegExp('^'+name+':\\s+0+$','m').test(status),'capabilities '+name);
 assert(/^NoNewPrivs:\s+1$/m.test(status),'no new privileges');assert(/^Seccomp:\s+2$/m.test(status),'seccomp filter');
 assert(fs.readFileSync('/proc/self/attr/current','utf8').startsWith('docker-default'),'AppArmor default');
 const cg={};for(const name of ['memory.max','memory.swap.max','pids.max','cpu.max','memory.events'])cg[name]=fs.readFileSync('/sys/fs/cgroup/'+name,'utf8').trim();
 assert(cg['memory.max']==='6442450944'&&cg['memory.swap.max']==='0'&&cg['pids.max']==='32','kernel hard limits');
 const cpu=cg['cpu.max'].split(/\s+/).map(Number);assert(cpu[0]>0&&cpu[0]===cpu[1],'kernel CPU quota');
 assert(Object.keys(os.networkInterfaces()).every(n=>n==='lo'),'loopback only');
 await new Promise((resolve,reject)=>{const s=net.connect({host:'198.51.100.1',port:9});s.on('connect',()=>{s.destroy();reject(Error('outbound connected'));});s.on('error',e=>['ENETUNREACH','EACCES','EPERM'].includes(e.code)?resolve():reject(e));s.setTimeout(1000,()=>{s.destroy();reject(Error('network timeout not proof'));});});
 for(const path of ['/source/package.json','/root-write-probe']){let denied=false;try{fs.writeFileSync(path,'readonly-denial-probe');}catch(e){denied=['EROFS','EACCES','EPERM'].includes(e.code);}assert(denied,'readonly denial');}
 fs.writeFileSync('/tmp/private-probe','private');fs.unlinkSync('/tmp/private-probe');
 for(const path of ['/var/run/docker.sock','/run/docker.sock','/source/.git','/home/runner','/github','/host','/source/.env','/source/.env.local'])assert(!fs.existsSync(path),'host/credential path absent');
 const pids=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x));assert(pids.length===1&&pids[0]==='1'&&process.pid===1,'private PID namespace');
 const mounts=fs.readFileSync('/proc/mounts','utf8').trim().split('\n').map(l=>l.split(' '));
 for(const target of ['/','/source','/source/node_modules','/compiler','/control/driver.cjs'])assert(mounts.some(m=>m[1]===target&&m[3].split(',').includes('ro')),'readonly mount '+target);
 const namespaces={};for(const name of ['pid','mnt','net','ipc','uts','cgroup'])namespaces[name]=fs.readlinkSync('/proc/self/ns/'+name);
 return {namespaces,cgroup:cg,uid:process.getuid(),runtime:process.version,checks:'ALL_CANARIES_PASSED'};
}
async function main(){
 const result=await canaries();frame({kind:'ready',canary:result});
 await new Promise((resolve,reject)=>{let data='';const t=setTimeout(()=>reject(Error('controller acknowledgment missing')),10000);process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{data+=chunk;if(data.length>64){clearTimeout(t);reject(Error('control input oversized'));}if(data.includes('\n')){clearTimeout(t);data==='GO\n'?resolve():reject(Error('control input invalid'));}});process.stdin.on('end',()=>reject(Error('controller disconnected')));});
 const args=['--max-old-space-size=2560','/compiler/lib/_tsc.js','--project','/source/tsconfig.node.json','--noEmit','--incremental','false','--pretty','false'];
 const child=cp.spawn('/usr/local/bin/node',args,{env:process.env,stdio:['ignore','pipe','pipe'],cwd:'/source'});const sizes={stdout:0,stderr:0};let overflow=false;
 for(const key of ['stdout','stderr'])child[key].on('data',chunk=>{sizes[key]+=chunk.length;if(sizes[key]>16777216){overflow=true;child.kill('SIGKILL');return;}frame({kind:key,data:chunk.toString('base64')});});
 child.on('error',e=>{frame({kind:'failure',message:'compiler spawn failure'});process.exitCode=125;});
 child.on('close',(code,signal)=>{const events=fs.readFileSync('/sys/fs/cgroup/memory.events','utf8').trim();process.stdin.destroy();const status=overflow||signal||![0,2].includes(code)?125:code;process.stdout.write(JSON.stringify({kind:'exit',code,signal,overflow,sizes,memoryEvents:events})+'\n',()=>process.exit(status));});
}
main().catch(()=>{frame({kind:'failure',message:'runtime/control canary failure'});process.exitCode=125;});
