'use strict';
// FUTURE SOURCE ONLY. No approved launch/manifest/containment entry yet.
// Actual native HTTP over private UDS, NOT Twilio callsite/defaultglobal proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=fs.realpathSync(process.argv[2]),data=fs.realpathSync(process.argv[3]),output=path.resolve(process.argv[4]),manifest=JSON.parse(fs.readFileSync(process.argv[5],'utf8'));
const events=[],cleanupCodes=[];let failureCode=null;
const dispatcherKey=Symbol.for('undici.globalDispatcher.1');const initialDispatcher=globalThis[dispatcherKey];
const fixed=(code,facts={})=>{assert(!Object.hasOwn(facts,'code'));events.push({code,...facts});};
let server,agent,aux,helper,serialize,ledger,ownedReader,imports=()=>[];let socketPath,closing,boundSocketIdentity,ownedPathDisposition;
const dataIdentity=fs.lstatSync(data,{bigint:true});assert(dataIdentity.isDirectory()&&!dataIdentity.isSymbolicLink());assert.equal(dataIdentity.mode&0o077n,0n);
function checkParentIdentity(){const st=fs.lstatSync(data,{bigint:true});assert(st.isDirectory()&&!st.isSymbolicLink()&&st.dev===dataIdentity.dev&&st.ino===dataIdentity.ino&&(st.mode&0o077n)===0n);}
function checkBoundSocketIdentity(){checkParentIdentity();const st=fs.lstatSync(socketPath,{bigint:true});assert(st.isSocket()&&!st.isSymbolicLink()&&boundSocketIdentity&&st.dev===boundSocketIdentity.dev&&st.ino===boundSocketIdentity.ino);}
function removeOwnedPathAfterPhysicalJoin(){
 checkParentIdentity();assert(sockets.size===socketClosed.size);assert(server&&!server.listening);
 let st;try{st=fs.lstatSync(socketPath,{bigint:true});}catch(error){if(error.code!=='ENOENT')throw error;ownedPathDisposition='ALREADY_ABSENT_AFTER_NATIVE_CLOSE';return;}
 assert(st.isSocket()&&!st.isSymbolicLink()&&boundSocketIdentity&&st.dev===boundSocketIdentity.dev&&st.ino===boundSocketIdentity.ino);
 fs.unlinkSync(socketPath);assert(!fs.existsSync(socketPath));ownedPathDisposition='EXPLICIT_SAME_CREATED_SOCKET_UNLINKED';
}
const sockets=new Set(),socketClosed=new Set(),socketClosePromises=[],serverResponses=new Map(),trackedSocketInodes=new Set();
function socketInodes(){const inodes=new Set();const rows=fs.readdirSync('/proc/self/fd');assert(rows.length<=256);for(const fd of rows){let link;try{link=fs.readlinkSync('/proc/self/fd/'+fd);}catch(error){if(error.code==='ENOENT')continue;throw error;}const m=/^socket:\[([0-9]+)\]$/.exec(link);if(m)inodes.add(m[1]);}return inodes;}
const initialSocketInodes=socketInodes();
function trackNewSocketInodes(){const actual=socketInodes();for(const ino of actual)if(!initialSocketInodes.has(ino))trackedSocketInodes.add(ino);return actual;}
function finishServer(){if(!closing)closing=new Promise((resolve,reject)=>{try{if(boundSocketIdentity&&server.listening)checkBoundSocketIdentity();server.close(error=>error?reject(error):resolve());}catch(error){reject(error);}});return closing;}
(async()=>{
 try{
  assert.equal(process.version,'v22.18.0');assert.equal(process.versions.modules,'127');assert.equal(initialDispatcher,undefined);
  assert.equal(manifest.scope,'A_HELPER_REAL_HTTP_UDS_ONLY');
  require(path.join(manifest.harness,'exact-ts-loader.cjs'))(root,path.join(root,'node_modules/typescript/lib/typescript.js'),manifest.typescriptEvaluationClosure);
  serialize=require(path.join(manifest.harness,'body-custody-receipt.cjs'));
  // Mandatory exact dependency/body allowlist guard before Undici evaluation.
  imports=require(path.join(manifest.harness,'factory-module-guard.cjs'))(root,manifest);
  helper=require(path.join(root,'services/lifecycle/httpResponseCustody.ts'));
  const undici=require(path.join(root,'node_modules/undici'));aux=globalThis[dispatcherKey];assert(aux);
  ledger=new helper.HttpBodyCustodyFailures();
  socketPath=path.join(data,'body.sock');assert(Buffer.byteLength(socketPath)<100);assert(!fs.existsSync(socketPath));
  server=http.createServer((req,res)=>{
   serverResponses.set(req.url,res);
   res.writeHead(200,{'content-type':'application/json'});
   if(req.url==='/json')res.end('{"ok":true}');
   else if(req.url==='/invalid')res.end('{');
   else {res.write('body');res.flushHeaders();} // genuine nonempty continuing body
  });
  server.on('connection',socket=>{assert(sockets.size<16);sockets.add(socket);socketClosePromises.push(new Promise(resolve=>socket.once('close',()=>{socketClosed.add(socket);resolve();})));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  const bound=fs.lstatSync(socketPath,{bigint:true});assert(bound.isSocket()&&!bound.isSymbolicLink());boundSocketIdentity={dev:bound.dev,ino:bound.ino};checkBoundSocketIdentity();trackNewSocketInodes();assert(trackedSocketInodes.size>=1);
  agent=new undici.Agent({connect:{socketPath}});
  fixed('REAL_UDS_SERVER_AND_PRIVATE_AGENT_CREATED',{privateAgent:true,defaultGlobalTest:false});
  const request=route=>undici.fetch('http://localhost'+route,{dispatcher:agent,redirect:'error'});
  const original=await request('/status');assert(original.body);assert(sockets.size>0);assert(serverResponses.get('/status')&&!serverResponses.get('/status').writableEnded);trackNewSocketInodes();assert(trackedSocketInodes.size>=3);
  const marker={};const status=await helper.withHttpResponseCustody(original,ledger,'telephony-dtmf',()=>marker);assert.strictEqual(status,marker);
  assert(original.bodyUsed);assert.equal(serialize(ledger).count,0);fixed('STATUS_BODY_ACTUAL_CANCEL_JOINED',{positiveServerSockets:sockets.size,bodyWasContinuing:true,resultIdentity:true});
  const json=await request('/json');const result=await helper.withHttpResponseCustody(json,ledger,'telephony-dial',read=>read());assert.deepEqual(result,{ok:true});assert.equal(serialize(ledger).count,0);fixed('JSON_EOF_CONSUMED',{bodyUsed:json.bodyUsed});
  const invalid=await request('/invalid');let semantic;try{await helper.withHttpResponseCustody(invalid,ledger,'telephony-dial',read=>read());}catch(error){semantic=error;}
  assert(semantic instanceof SyntaxError);assert(invalid.bodyUsed);assert.equal(serialize(ledger).count,0);fixed('INVALID_JSON_AFTER_EOF_NOT_BODY_FAILURE',{semanticSyntaxError:true,cleanupCount:0});
  // Real caller misuse, not a production callsite and not injected failure.
  const locked=await request('/locked');const reader=locked.body.getReader();ownedReader=reader;trackNewSocketInodes();let primary;
  try{await helper.withHttpResponseCustody(locked,ledger,'telephony-hangup',()=>{throw semantic;});}catch(error){primary=error;}
  assert.strictEqual(primary,semantic);const failed=serialize(ledger);assert.equal(failed.count,1);assert.equal(failed.sampleCount,1);assert.equal(failed.overflow,false);
  assert(ledger.drainFailure().samples[0].original instanceof TypeError);
  fixed('LOCKED_NATIVE_READER_CALLER_MISUSE',{samePrimaryIdentity:true,bodyFailure:failed,productionCallsite:false});
  // Caller owns this actual lock. Joining its actual cancellation/release is
  // independent of helper ledger (which remains sticky incomplete).
  await reader.cancel();reader.releaseLock();ownedReader=undefined;assert.equal(serialize(ledger).count,1);
  assert(sockets.size>0);const originalClose=agent.close();await originalClose;assert(agent.closed);assert.strictEqual(globalThis[dispatcherKey],aux);
  fixed('SAME_PRIVATE_AGENT_ORIGINAL_CLOSE_JOINED',{closed:true,positiveSocketCount:sockets.size});
  await finishServer();await Promise.allSettled(socketClosePromises);assert.equal(socketClosed.size,sockets.size);const after=socketInodes();assert([...trackedSocketInodes].every(ino=>!after.has(ino)));assert([...after].every(ino=>initialSocketInodes.has(ino)));fixed('REAL_SERVER_AND_ALL_SEEN_NATIVE_SOCKETS_CLOSED',{sameSeenSocketCount:sockets.size,closedSocketCount:socketClosed.size,trackedNativeSocketInodes:trackedSocketInodes.size,remainingTrackedNativeSocketFds:0,newNativeSocketFds:0});
  removeOwnedPathAfterPhysicalJoin();fixed('OWNED_UDS_PATH_CLEANUP_AFTER_PHYSICAL_JOIN',{disposition:ownedPathDisposition,socketPathAbsent:true,sameParentIdentity:true});
 }catch(error){failureCode='HELPER_ASSERTION_OR_NATIVE_FAILURE';process.exitCode=1;}
 finally{
  if(ownedReader){try{await ownedReader.cancel();ownedReader.releaseLock();}catch{cleanupCodes.push('CALLER_READER_CLOSE_FAILED');process.exitCode=1;}}
  if(agent){try{await agent.close();}catch{cleanupCodes.push('PRIVATE_AGENT_CLOSE_FAILED');process.exitCode=1;}}
  if(server){try{await finishServer();await Promise.allSettled(socketClosePromises);const actual=socketInodes();assert([...trackedSocketInodes].every(ino=>!actual.has(ino)));if(boundSocketIdentity&&!ownedPathDisposition)removeOwnedPathAfterPhysicalJoin();}catch{cleanupCodes.push('UDS_SERVER_OR_OWNED_PATH_CLOSE_FAILED');process.exitCode=1;}}
  if(aux&&initialDispatcher===undefined){try{assert.strictEqual(globalThis[dispatcherKey],aux);await aux.close();fixed('HARNESS_ONLY_IMPORT_AGENT_CLOSED',{productionDrained:false});}catch{cleanupCodes.push('HARNESS_IMPORT_AGENT_CLOSE_FAILED');process.exitCode=1;}}
  if(socketPath&&fs.existsSync(socketPath)){cleanupCodes.push('UDS_PATH_REMAINS');process.exitCode=1;}
  try{const actual=socketInodes();assert([...trackedSocketInodes].every(ino=>!actual.has(ino)));assert([...actual].every(ino=>initialSocketInodes.has(ino)));fixed('FINAL_SCOPED_UDS_PROOF',{socketPathAbsent:!socketPath||!fs.existsSync(socketPath),remainingTrackedNativeSocketFds:0,newNativeSocketFds:0});}catch{cleanupCodes.push('FINAL_UDS_SOCKET_SCOPE_UNVERIFIED');process.exitCode=1;}
  const tsImports=Object.keys(require.cache).filter(file=>file.startsWith(root+path.sep)&&file.endsWith('.ts')).map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
  const report={schemaVersion:1,imports:imports(),tsImports,scope:'A_HELPER_REAL_HTTP_UDS_ONLY_NOT_TELEPHONY_CALLSITE_NOT_DEFAULTGLOBAL',events,failureCode,cleanupCodes,bodyFailure:ledger&&serialize?serialize(ledger):null,productCallsiteAccepted:false,globalLifecycleAccepted:false,naturalScopeExitRequired:true};
  // Fixed receipt schema never includes ledger.samples/original Error objects.
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
})();
