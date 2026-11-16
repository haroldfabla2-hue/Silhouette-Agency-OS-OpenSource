'use strict';
// Scoped reviewed-tool boundary, NOT a sandbox for arbitrary hostile JS/Go/native code.
const fs=require('node:fs'),path=require('node:path'),url=require('node:url'),crypto=require('node:crypto'),mod=require('node:module'),cp=require('node:child_process'),wt=require('node:worker_threads');
const raw={read:fs.readFileSync,real:fs.realpathSync,lstat:fs.lstatSync,write:fs.writeFileSync,spawn:cp.spawn};
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const plan=JSON.parse(raw.read('/control/boundary-plan.json','utf8'));
let parse,configTemp,configDigest,configLoads=0,nativeLoads=0,service,closing=false,closed=false,spawnCount=0,totalIn=0,totalOut=0;
let order=0,eofRequestedAt,stdinFinishedAt,serviceExitAt,serviceClosedAt,serviceExit;
const loads=[],events=[],writes=[],packets={input:0,output:0},pendingBytes={input:0,output:0};let violations=0;
function bad(rule,subject=''){violations++;if(events.length<64)events.push({rule,subject:String(subject).slice(0,240)});throw Object.assign(Error('SSR_BOUNDARY_'+rule),{code:'SSR_BOUNDARY_'+rule});}
function pathname(v){if(v instanceof URL){if(v.protocol!=='file:')return bad('URL',v.protocol);v=url.fileURLToPath(v);}if(typeof v!=='string')return bad('NON_PATH',typeof v);if(v.startsWith('file:'))v=url.fileURLToPath(v);return path.resolve(v);}
function pinned(p,digest){if(raw.real(p)!==p||!raw.lstat(p).isFile()||H(raw.read(p))!==digest)bad('IDENTITY',p);}
function checkConfig(code){
 if(!parse)bad('CONFIG_PARSER_NOT_READY');
 const ast=parse(code);const types=new Set(['Program','ArrayExpression','VariableDeclaration','VariableDeclarator','Identifier','Literal','CallExpression','MemberExpression','ObjectExpression','Property','ArrowFunctionExpression','BinaryExpression','UnaryExpression','LogicalExpression','ImportDeclaration','ImportDefaultSpecifier','ImportSpecifier','ExportNamedDeclaration','ExportSpecifier','BlockStatement','ReturnStatement']);
 const ids=new Set(['defineConfig','path','__vite_injected_original_dirname','__vite_injected_original_filename','__vite_injected_original_import_meta_url','vite_server_config_default','default','resolve','build','ssr','lib','entry','formats','fileName','outDir','emptyOutDir','rollupOptions','external','id','startsWith','isAbsolute','alias','Array']);
 // Permit exactly the audited declarations/operations of this actual config. No call-by-computed-name.
 const visit=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(visit);return;}if(!types.has(n.type))bad('CONFIG_AST_KIND',n.type);
  if(n.type==='Identifier'&&!ids.has(n.name))bad('CONFIG_IDENTIFIER',n.name);
  if(n.type==='ImportDeclaration'&&!['path','node:path','/source/node_modules/vite/dist/node/index.js','file:///source/node_modules/vite/dist/node/index.js','vite'].includes(n.source.value))bad('CONFIG_IMPORT',n.source.value);
  if(n.type==='CallExpression'){
   const c=n.callee;const ok=c.type==='Identifier'&&c.name==='defineConfig'||c.type==='MemberExpression'&&!c.computed&&c.object.type==='Identifier'&&((c.object.name==='path'&&['resolve','isAbsolute'].includes(c.property.name))||(c.object.name==='id'&&c.property.name==='startsWith'));
   if(!ok)bad('CONFIG_CALL');
  }
  if(n.type==='MemberExpression'&&n.computed)bad('CONFIG_COMPUTED_MEMBER');
  for(const [k,v]of Object.entries(n))if(!['type','start','end','loc','raw'].includes(k)&&v&&typeof v==='object')visit(v);
 };visit(ast);return H(Buffer.from(code));
}
function load(v,native=false){
 const p=pathname(v);if(native&&p!==plan.rollupNative)bad('NATIVE',p);let digest=plan.loads[p];
 if(p===configTemp){if(native||!configDigest||configLoads++!==0)bad('CONFIG_LOAD_ONCE',p);digest=configDigest;}
 if(!digest)bad('LOAD',p);
 if(native){if(p!==plan.rollupNative||nativeLoads++!==0)bad('NATIVE',p);}
 pinned(p,digest);if(loads.length>=4096)bad('LOAD_CAP');loads.push({path:p,sha256:digest,native});return p;
}
function readable(v){const p=pathname(v);if(!(p.startsWith('/source/')||p.startsWith('/control/')||p.startsWith('/denied/')||p.startsWith('/tmp/')))bad('READ_ROOT',p);return p;}
function writable(v){const p=pathname(v);if(!((p.startsWith('/source/dist/')&&!p.includes('/../'))||p.startsWith('/source/node_modules/.vite-temp/')||p.startsWith('/tmp/')))bad('WRITE_ROOT',p);return p;}
function configWrite(v,data){const p=writable(v);if(p.startsWith('/source/node_modules/.vite-temp/')){
  if(configTemp||!/^\/source\/node_modules\/\.vite-temp\/vite\.server\.config\.ts\.timestamp-[0-9]+-[a-f0-9]+\.mjs$/.test(p)||typeof data!=='string'||Buffer.byteLength(data)>1048576)bad('CONFIG_WRITE',p);
  configDigest=checkConfig(data);configTemp=p;writes.push({kind:'CONFIG_BUNDLE',path:p,sha256:configDigest,bytes:Buffer.byteLength(data)});
 }return p;}
function frameCounter(direction){let pending=Buffer.alloc(0);return chunk=>{
 if(!Buffer.isBuffer(chunk)&&typeof chunk!=='string'&&!ArrayBuffer.isView(chunk))bad('IPC_TYPE',direction);
 const b=Buffer.from(chunk);if(direction==='input')totalIn+=b.length;else totalOut+=b.length;
 if(totalIn>67108864||totalOut>67108864)bad('IPC_TOTAL_CAP',direction);
 pending=Buffer.concat([pending,b]);if(pending.length>16777220)bad('IPC_BUFFER_CAP',direction);
 while(pending.length>=4){const len=pending.readUInt32LE(0);if(len>16777216)bad('IPC_FRAME_CAP',direction);if(pending.length<4+len)break;packets[direction]++;pending=pending.subarray(4+len);}
 pendingBytes[direction]=pending.length;
 };}
let installed=false;
function install(){if(installed)bad('DOUBLE_INSTALL');installed=true;
 mod.registerHooks({load(v,c,next){if(v.startsWith('node:'))return next(v,c);load(v);return next(v,c);}});
 const compile=mod.Module.prototype._compile;mod.Module.prototype._compile=function(code,file,...rest){const p=load(file);if(H(Buffer.from(code))!==plan.loads[p])bad('COMPILE_BYTES',p);return compile.call(this,code,file,...rest);};
 const dl=process.dlopen;process.dlopen=function(m,file,...rest){load(file,true);return dl.call(this,m,file,...rest);};
 for(const name of ['readFileSync','readFile','createReadStream']){const fn=fs[name];fs[name]=function(p,...a){readable(p);return fn.call(this,p,...a);};}
 for(const name of ['readFile']){const fn=fs.promises[name];fs.promises[name]=function(p,...a){readable(p);return fn.call(this,p,...a);};}
 for(const name of ['openSync','open']){const fn=fs[name];fs[name]=function(p,flags,...a){if(typeof flags==='string'&&/[wa+]/.test(flags)||typeof flags==='number'&&(flags& (fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC)))writable(p);else readable(p);return fn.call(this,p,flags,...a);};}
 {const fn=fs.promises.open;fs.promises.open=function(p,flags,...a){if(typeof flags==='string'&&/[wa+]/.test(flags)||typeof flags==='number'&&(flags&3))writable(p);else readable(p);return fn.call(this,p,flags,...a);};}
 for(const name of ['writeFileSync','writeFile','appendFileSync','appendFile']){const fn=fs[name];fs[name]=function(p,data,...a){configWrite(p,data);return fn.call(this,p,data,...a);};}
 for(const name of ['writeFile','appendFile']){const fn=fs.promises[name];fs.promises[name]=function(p,data,...a){configWrite(p,data);return fn.call(this,p,data,...a);};}
 for(const name of ['mkdirSync','mkdir','unlinkSync','unlink','rmSync','rm','rmdirSync','rmdir','truncateSync','truncate']){const fn=fs[name];fs[name]=function(p,...a){if(!['/source/dist','/source/dist/server','/source/node_modules/.vite-temp','/tmp'].includes(pathname(p)))writable(p);return fn.call(this,p,...a);};}
 for(const name of ['mkdir','unlink','rm','rmdir','truncate']){const fn=fs.promises[name];fs.promises[name]=function(p,...a){if(!['/source/dist','/source/dist/server','/source/node_modules/.vite-temp','/tmp'].includes(pathname(p)))writable(p);return fn.call(this,p,...a);};}
 for(const name of ['copyFileSync','copyFile','renameSync','rename','linkSync','link']){const fn=fs[name];fs[name]=function(a,b,...rest){readable(a);writable(b);return fn.call(this,a,b,...rest);};}
 for(const name of ['copyFile','rename','link']){const fn=fs.promises[name];fs.promises[name]=function(a,b,...rest){readable(a);writable(b);return fn.call(this,a,b,...rest);};}
 for(const name of ['symlink','symlinkSync','createWriteStream'])fs[name]=()=>bad('UNREVIEWED_WRITE',name);
 fs.promises.symlink=()=>bad('UNREVIEWED_WRITE','symlink');
 for(const name of ['exec','execSync','spawnSync','execFile','execFileSync','fork'])cp[name]=()=>bad('PROCESS',name);
 cp.spawn=function(exe,args,o){
  if(spawnCount++!==0||exe!==plan.esbuildBinary||JSON.stringify(args)!==JSON.stringify(['--service=0.25.12','--ping'])||!o||o.cwd!=='/source'||o.windowsHide!==true||JSON.stringify(o.stdio)!==JSON.stringify(['pipe','pipe','inherit'])||o.env||o.shell||o.detached||o.uid||o.gid)bad('SPAWN_SCOPE',exe);
  pinned(exe,plan.esbuildSha256);service=raw.spawn.call(cp,exe,args,o);const input=frameCounter('input'),output=frameCounter('output');let first=true;
  const write=service.stdin.write;service.stdin.write=function(b,...a){input(b);return write.call(this,b,...a);};
  // The first native output frame is an unframed-version payload with the SAME length prefix.
  service.stdout.on('data',b=>{output(b);first=false;});
  service.stdin.on('finish',()=>{stdinFinishedAt=++order;});
  service.on('exit',(code,signal)=>{serviceExitAt=++order;serviceExit={code,signal};});
  service.on('close',(code,signal)=>{serviceClosedAt=++order;closed={code,signal};});
  const kill=service.kill;service.kill=function(...a){bad('SERVICE_KILL',a[0]||'SIGTERM');};
  return service;
 };
 wt.Worker=class{constructor(){bad('WORKER');}};
 for(const [module,names] of [['node:net',['connect','createConnection','createServer']],['node:tls',['connect','createServer']],['node:http',['request','get','createServer']],['node:https',['request','get','createServer']],['node:dgram',['createSocket']],['node:dns',['lookup','resolve','resolve4','resolve6']]]){const value=require(module);for(const name of names)value[name]=()=>bad('NETWORK',module+':'+name);}
 globalThis.fetch=()=>bad('NETWORK','fetch');
 mod.syncBuiltinESMExports();
}
async function closeService(){
 if(!service||closing||closed||serviceExitAt!==undefined||service.exitCode!==null||service.signalCode!==null||service.stdin.destroyed||service.stdin.writableEnded)bad('SERVICE_NOT_LIVE_BEFORE_EOF');
 closing=true;eofRequestedAt=++order;
 // Subscribe BEFORE requesting EOF; no already-closed shortcut can qualify.
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('SERVICE_CLOSE_TIMEOUT'));},5000);
  function cleanup(){clearTimeout(timer);service.off('close',done);}
  function done(code,signal){
   cleanup();
   const ordered=eofRequestedAt!==undefined&&stdinFinishedAt>eofRequestedAt&&serviceExitAt>stdinFinishedAt&&serviceClosedAt>serviceExitAt;
   if(code===0&&!signal&&serviceExit?.code===0&&!serviceExit?.signal&&pendingBytes.input===0&&pendingBytes.output===0&&ordered)resolve();
   else reject(Error('SERVICE_EOF_EXIT_ORDER_OR_TRUNCATED_IPC'));
  }
  service.once('close',done);
  try{service.stdin.end();}catch(error){cleanup();service.off('close',done);reject(error);}
 });
}
function snapshot(){return {violations,events,loads,writes,configLoads,nativeLoads,spawnCount,service:closed,serviceOrder:{eofRequestedAt,stdinFinishedAt,serviceExitAt,serviceClosedAt,exit:serviceExit},ipc:{inputBytes:totalIn,outputBytes:totalOut,packets,pendingBytes},closing};}
module.exports={install,setParser:p=>{if(parse)bad('PARSER_REPLACED');parse=p;},load,bad,snapshot,closeService,raw};
