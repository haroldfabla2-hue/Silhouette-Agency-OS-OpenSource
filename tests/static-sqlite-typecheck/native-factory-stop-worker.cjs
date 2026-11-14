'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.realpathSync(process.argv[2]),scenario=process.argv[3],evidence=path.resolve(process.argv[4]),data=path.resolve(process.argv[5]);
const manifest=JSON.parse(fs.readFileSync(process.argv[6],'utf8'));
const events=[],cleanupFailures=[];
const record=(name,facts={})=>events.push({name,atNs:process.hrtime.bigint().toString(),...facts});
const disposition=e=>({name:e?.name||typeof e,code:typeof e?.code==='string'?e.code:null});
// Read procfs only. Never opens a database or changes a sidecar.
// Preserve identities across unlink/recreate. Map matching by inode alone is
// deliberately conservative across devices: a collision fails, never passes.
const trackedFiles = new Map();
const fileNames = ['account-wal.sqlite','account-wal.sqlite-wal','account-wal.sqlite-shm'];
function fileEvidence() {
  const files=[];
  for(const file of fileNames) {
    const target=path.join(data,file);
    let st;
    try { st=fs.lstatSync(target,{bigint:true}); }
    catch(error) { if(error.code==='ENOENT') continue; throw error; }
    assert(st.isFile() && !st.isSymbolicLink() && st.size<=8n*1024n*1024n);
    const bytes=fs.readFileSync(target); assert.equal(BigInt(bytes.length),st.size);
    trackedFiles.set(st.dev+':'+st.ino,{dev:st.dev.toString(),ino:st.ino.toString()});
    files.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  assert(files.some(row=>row.file==='account-wal.sqlite'));
  return files;
}
function scopedHandleCounts() {
  const entries=fs.readdirSync('/proc/self/fd'); assert(entries.length<=256);
  let fdMatches=0;
  for(const entry of entries) {
    assert(/^[0-9]+$/.test(entry));
    let st,target;
    try { target=fs.readlinkSync('/proc/self/fd/'+entry); st=fs.statSync('/proc/self/fd/'+entry,{bigint:true}); }
    catch(error) { if(error.code==='ENOENT') continue; throw error; }
    const named=fileNames.some(file=>target===path.join(data,file)||target===path.join(data,file)+' (deleted)');
    if(named||trackedFiles.has(st.dev+':'+st.ino)) fdMatches++;
  }
  const maps=fs.readFileSync('/proc/self/maps','utf8'); assert(Buffer.byteLength(maps)<=1024*1024);
  let mapMatches=0;
  for(const line of maps.trimEnd().split('\n')) {
    const match=/^([0-9a-f]+)-([0-9a-f]+)\s+[-rwxps]{4}\s+[0-9a-f]+\s+[0-9a-f]+:[0-9a-f]+\s+([0-9]+)(?:\s+(.*))?$/.exec(line);
    assert(match,'proc maps parse must fail closed');
    const ino=match[3],target=match[4]||'';
    const named=fileNames.some(file=>target===path.join(data,file)||target===path.join(data,file)+' (deleted)');
    if(named||[...trackedFiles.values()].some(row=>row.ino===ino)) mapMatches++;
  }
  return {fdMatches,mapMatches};
}
function beforeCloseProof() {
  fileEvidence(); const counts=scopedHandleCounts();
  assert(counts.fdMatches>=1,'positive control must see an actual live database descriptor');
  return counts;
}

(async()=>{
 let failure=null,bindings,connections,router,agent,agentSymbols,imports=()=>[],bodySucceeded=false;
 const dispatcherKey=Symbol.for('undici.globalDispatcher.1');
 const initialDispatcher=globalThis[dispatcherKey];
 try {
  assert.equal(scenario,'factory-stop');assert.equal(process.version,'v22.18.0');assert.equal(process.versions.modules,'127');
  assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
  assert.equal(initialDispatcher,undefined,'no adoption of a preexisting dispatcher');
  assert.equal(process.env.SILHOUETTE_TOKEN_KEY,undefined);assert(!Object.hasOwn(process.env,'SILHOUETTE_ACCOUNTS_DB_PATH'));
  require('./exact-ts-loader.cjs')(root,path.join(root,'node_modules/typescript/lib/typescript.js'),manifest.typescriptEvaluationClosure);
  imports=require('./factory-module-guard.cjs')(root,manifest);
  record('factory-worker-start',{node:process.version,abi:process.versions.modules,dispatcherAbsentBefore:true,tokenKeyAbsent:true,scope:'PRODUCTION_FACTORY_DB_ONLY_NO_HTTP_OR_OAUTH'});
  // Pure owner module first, retained before risky factory imports/allocation.
  bindings=require(path.join(root,'services/lifecycle/runtimeStopBindings.ts'));
  assert(bindings.evaluatedRuntimeFrontier().every(row=>row.phase==='UNSEEN'));
  const {TokenFileStore}=require(path.join(root,'services/auth/tokenFileStore.ts'));assert.equal(TokenFileStore.isAvailable(),false);
  record('all-original-frontiers-unseen-not-acquired-claim',{tokenStoreAvailable:false});
  connections=require(path.join(root,'server/routes/connections.ts'));
  agent=globalThis[dispatcherKey];assert(agent && typeof agent.close==='function');
  const deps=fs.realpathSync(path.join(root,'node_modules'));
  agentSymbols=require(path.join(deps,'undici/lib/core/symbols.js'));
  assert(agent[agentSymbols.kClients] instanceof Map);assert.equal(agent[agentSymbols.kClients].size,0);assert.equal(agent.closed,false);
  record('undici-import-owner-retained-not-production-drained',{sameGlobalIdentity:agent===globalThis[dispatcherKey],clients:0,cleanupOwner:'HARNESS_ONLY'});
  assert.equal(TokenFileStore.isAvailable(),false);
  const filename=path.join(data,'account-wal.sqlite');assert(!fs.existsSync(filename));
  process.env.SILHOUETTE_ACCOUNTS_DB_PATH=filename;
  router=connections.connectionRoutes();assert.equal(typeof router,'function');
  const frontier=bindings.evaluatedRuntimeFrontier();
  assert(frontier.some(row=>row.name==='provider-account-original-database'&&row.phase==='PUBLISHED'));
  assert(frontier.filter(row=>row.name!=='provider-account-original-database').every(row=>row.phase==='UNSEEN'));
  const before=beforeCloseProof();const firstIdentities=[...trackedFiles.keys()].sort();const firstFiles=fileEvidence();
  assert.strictEqual(connections.connectionRoutes(),router);const again=scopedHandleCounts();fileEvidence();
  assert.deepEqual([...trackedFiles.keys()].sort(),firstIdentities);assert.deepEqual(again,before);assert.deepEqual(fileEvidence(),firstFiles);
  record('production-factory-published-original-db-positive',{frontier,beforeFdMatches:before.fdMatches,sameCachedRouter:true,noExtraDatabaseIdentity:true,trackedIdentityCount:trackedFiles.size});
  bindings.sealEvaluatedRuntimeProducers();await bindings.drainEvaluatedRuntimeProducers();
  await bindings.closeEvaluatedRuntimeStorage();await bindings.closeEvaluatedRuntimeStorage();
  const files=fileEvidence(),after=scopedHandleCounts();assert.equal(after.fdMatches,0);assert.equal(after.mapMatches,0);
  assert.strictEqual(connections.connectionRoutes(),router);assert.deepEqual(scopedHandleCounts(),after);assert.deepEqual(fileEvidence(),files);
  assert.throws(()=>bindings.admitEvaluatedProviderAccounts(),bindings.RuntimeConstructionAdmissionClosed);
  record('production-original-storage-stop-joined',{afterFdMatches:after.fdMatches,afterMapMatches:after.mapMatches,sameCachedRouterAfterStop:true,newAdmissionRejected:true,files});
  bodySucceeded=true;
 } catch(error){failure=disposition(error);process.exitCode=1;}
 finally {
  // Independent real owner attempts, even after import/construction fails.
  if(bindings){
   try {bindings.sealEvaluatedRuntimeProducers();await bindings.drainEvaluatedRuntimeProducers();record('finally-original-producers-drained');}
   catch(error){cleanupFailures.push({resource:'original-producers',...disposition(error)});process.exitCode=1;}
   try {await bindings.closeEvaluatedRuntimeStorage();record('finally-original-storage-joined');}
   catch(error){cleanupFailures.push({resource:'original-storage',...disposition(error)});process.exitCode=1;}
  }
  // An import may throw after acquiring its Agent. Recover ONLY that original
  // slot if it was absent initially. Never import a fallback that creates one.
  if(initialDispatcher===undefined){
   const observed=globalThis[dispatcherKey];if(!agent)agent=observed;
   if(agent){
    try {assert.strictEqual(observed,agent);await agent.close();assert.equal(agent.closed,true);if(agentSymbols)assert.equal(agent[agentSymbols.kClients].size,0);record('harness-only-same-undici-import-agent-closed',{sameGlobalIdentity:globalThis[dispatcherKey]===agent,closed:agent.closed,clientsAfter:agentSymbols?agent[agentSymbols.kClients].size:null,productionDrained:false});}
    catch(error){cleanupFailures.push({resource:'HARNESS_ONLY_UNDICI_IMPORT_AGENT',...disposition(error)});process.exitCode=1;}
   }
  }
  let finalFiles=[];
  try {if(fs.existsSync(path.join(data,'account-wal.sqlite')))finalFiles=fileEvidence();const after=scopedHandleCounts();assert.equal(after.fdMatches,0);assert.equal(after.mapMatches,0);record('final-scoped-file-proof',{files:finalFiles,afterFdMatches:after.fdMatches,afterMapMatches:after.mapMatches});}
  catch(error){cleanupFailures.push({resource:'final-scoped-proof',...disposition(error)});process.exitCode=1;}
  let tsImports=[];
  try {tsImports=Object.keys(require.cache).filter(file=>file.startsWith(root+path.sep)&&file.endsWith('.ts')).map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));}
  catch(error){cleanupFailures.push({resource:'actual-ts-import-receipt',...disposition(error)});process.exitCode=1;}
  const report={schemaVersion:1,scenario,scope:'PRODUCTION_FACTORY_DB_STOP_ONLY_NO_HTTP_OAUTH_BORROWERS_OR_GLOBAL_CLOSURE',events,failure,cleanupFailures,assertionsCompleted:bodySucceeded&&failure===null,imports:imports(),tsImports,globalLifecycle:'INCOMPLETE_UNCHANGED',externalImportOwner:'UNDICI_IMPORT_AGENT_NOT_PRODUCTION_DRAINED',outerNaturalExitStillRequired:true};
  fs.writeFileSync(evidence,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
})();
