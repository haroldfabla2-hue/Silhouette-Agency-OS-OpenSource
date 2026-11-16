'use strict';
// Run before resolver tooling in BOTH main thread and async loader thread.
const fs=require('node:fs'),path=require('node:path'),url=require('node:url'),crypto=require('node:crypto'),mod=require('node:module');
const raw={readFileSync:fs.readFileSync,realpathSync:fs.realpathSync};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(raw.readFileSync('/control/allowed-loads.json','utf8'));
const loaded=[];
const blocked={loads:0,native:0,compile:0,codeReads:0,processes:0};
const violations=[];let violationCount=0;
function deny(rule,category,code,value){
 violationCount++;blocked[category]++;
 if(violations.length<64)violations.push({rule,category,code,subject:typeof value==='string'?value:'NON_STRING_PATH'});
 throw fixed(code);
}
function snapshot(){return {violationCount,events:violations.slice(),blocked:{...blocked}};}
const fixed=code=>Object.assign(Error('fixed resolver boundary rejection'),{code});
function disk(value){
 if(value instanceof URL){try{value=url.fileURLToPath(value);}catch{deny('INVALID_FILE_URL','loads','R_NON_PATH',value.href);}}
 if(typeof value!=='string')deny('NON_STRING_PATH','loads','R_NON_PATH',value);
 if(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)&&!value.startsWith('file:'))deny('NON_FILE_PROTOCOL','loads','R_LOAD_DENIED',value);
 if(value.startsWith('file:')){try{value=url.fileURLToPath(value);}catch{deny('INVALID_FILE_URL','loads','R_NON_PATH',value);}}
 try{return path.resolve(value);}catch{deny('INVALID_PATH_VALUE','loads','R_NON_PATH',value);}
}
function allowLoad(value,native=false){
 const p=disk(value);const row=manifest.files[p];
 if(!row || (native && !manifest.nativeFiles.includes(p)))deny(native?'NATIVE_NOT_ALLOWLISTED':'MODULE_NOT_ALLOWLISTED',native?'native':'loads','R_LOAD_DENIED',p);
 let real,actual;try{real=raw.realpathSync(p);actual=hash(raw.readFileSync(p));}catch{deny('LOAD_IDENTITY_UNREADABLE','loads','R_LOAD_IDENTITY',p);}
 if(real!==p || actual!==row)deny('LOAD_REALPATH_OR_HASH','loads','R_LOAD_IDENTITY',p);
 if(loaded.length>=512)deny('LOAD_COUNT_CAP','loads','R_LOAD_COUNT_CAP',p);
 loaded.push({path:p,native,sha256:row});return p;
}
function allowRead(value){
 if(typeof value==='number')deny('RAW_FD_READ','codeReads','R_RAW_FD_READ_DENIED','FD');
 const p=disk(value);
 // Exact regular source JSON only; target code remains stat/resolution data, never read by tooling.
 if(p.startsWith('/source/')){
  const allowed=p==='/source/tsconfig.json'||p==='/source/tsconfig.node.json'||p.endsWith('/package.json');
  if(!allowed)deny('SOURCE_CODE_READ','codeReads','R_SOURCE_CODE_READ_DENIED',p);
  let real;try{real=raw.realpathSync(p);}catch{deny('READ_REALPATH_UNREADABLE','codeReads','R_SOURCE_CODE_READ_DENIED',p);}
  if(real!==p)deny('READ_REALPATH_MISMATCH','codeReads','R_SOURCE_CODE_READ_DENIED',p);
 }else if(p.startsWith('/denied/') || p.startsWith('/tmp/'))deny('UNAPPROVED_READ','codeReads','R_UNAPPROVED_CODE_READ',p);
}
let installed=false;
function install(options={}){
 if(installed)return;installed=true;
 if(!options.asyncThread)mod.registerHooks({load(value,context,next){if(value.startsWith('node:'))return next(value,context);allowLoad(value);return next(value,context);}});
 const oldCompile=mod.Module.prototype._compile;
 mod.Module.prototype._compile=function(content,filename,...args){const p=allowLoad(filename);let actual;try{actual=hash(Buffer.from(content));}catch{deny('COMPILE_CONTENT_INVALID','compile','R_COMPILE_CONTENT_IDENTITY',p);}
 if(actual!==manifest.files[p])deny('COMPILE_CONTENT_MISMATCH','compile','R_COMPILE_CONTENT_IDENTITY',p);return oldCompile.call(this,content,filename,...args);};
 const oldDlopen=process.dlopen;
 process.dlopen=function(target,filename,...args){allowLoad(filename,true);return oldDlopen.call(this,target,filename,...args);};
 // Cover public fs code-read entry routes. Node internal module loaders are covered separately above.
 for(const name of ['readFileSync','readFile','createReadStream','openSync','open']){
  const fn=fs[name];fs[name]=function(file,...args){allowRead(file);return fn.call(this,file,...args);};
 }
 for(const name of ['readFile','open']){
  const fn=fs.promises[name];fs.promises[name]=async function(file,...args){allowRead(file);return fn.call(this,file,...args);};
 }
 const cp=require('node:child_process');
 for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=()=>{deny('TOOL_PROCESS','processes','R_TOOL_PROCESS_DENIED',name);};
 mod.syncBuiltinESMExports();
}
module.exports={install,allowLoad,blocked,loaded,snapshot,deny};
