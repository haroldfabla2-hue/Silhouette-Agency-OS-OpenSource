'use strict';
// Source only. Do not run without separate reviewed execution gate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.realpathSync(process.argv[2]),scenario=process.argv[3],evidence=path.resolve(process.argv[4]),data=path.resolve(process.argv[5]);
const manifest=JSON.parse(fs.readFileSync(process.argv[6],'utf8'));
const events=[],cleanupFailures=[];
const record=(name,facts={})=>{assert(!Object.hasOwn(facts,'name')&&!Object.hasOwn(facts,'atNs'));events.push({name,atNs:process.hrtime.bigint().toString(),...facts});};
const names=new Set(['Error','AssertionError','OAuthCallbackError','ConnectionError','AggregateError','TypeError','TokenKeyMissing']);
const codes=new Set(['runtime-unavailable','EADDRNOTAVAIL','EADDRINUSE','EACCES','ERR_SERVER_NOT_RUNNING','ECONNREFUSED']);
const disposition=e=>({name:names.has(e?.name)?e.name:'UNCLASSIFIED_ERROR',code:codes.has(e?.code)?e.code:null});
const outcome=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error}));
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
 let failure=null,store,db,manager,seal,drain,agent,agentSymbols,imports=()=>[],startResult,publication,physicalResult,codeResult,bodySucceeded=false;
 const dispatcherKey=Symbol.for('undici.globalDispatcher.1'),initialDispatcher=globalThis[dispatcherKey];
 try {
  assert.equal(scenario,'manager-start-seal');assert.equal(process.version,'v22.18.0');assert.equal(process.versions.modules,'127');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
  assert.equal(initialDispatcher,undefined);assert.equal(process.env.SILHOUETTE_TOKEN_KEY,undefined);assert.equal(process.env.SILHOUETTE_ACCOUNTS_DB_PATH,undefined);
  require('./exact-ts-loader.cjs')(root,path.join(root,'node_modules/typescript/lib/typescript.js'),manifest.typescriptEvaluationClosure);
  imports=require('./factory-module-guard.cjs')(root,manifest);
  const {AccountStore}=require(path.join(root,'services/auth/accountStore.ts'));
  const {TokenFileStore}=require(path.join(root,'services/auth/tokenFileStore.ts'));
  const {ConnectionManager,sealAndDrainOriginalConnections}=require(path.join(root,'services/auth/connectionManager.ts'));seal=sealAndDrainOriginalConnections;
  agent=globalThis[dispatcherKey];assert(agent && typeof agent.close==='function');const deps=fs.realpathSync(path.join(root,'node_modules'));
  agentSymbols=require(path.join(deps,'undici/lib/core/symbols.js'));assert(agent[agentSymbols.kClients] instanceof Map);assert.equal(agent[agentSymbols.kClients].size,0);
  record('manager-worker-start',{node:process.version,abi:process.versions.modules,tokenKeyAbsent:true,dispatcherAbsentBefore:true,externalAgentCleanup:'HARNESS_ONLY'});
  assert(!fs.existsSync(path.join(data,'account-wal.sqlite')));
  store=new AccountStore(path.join(data,'account-wal.sqlite'));db=store.db;
  assert(db && db.open);assert.equal(db.pragma('journal_mode',{simple:true}),'wal');
  // Inject ONLY an ephemeral random constructor env object into the REAL
  // custody owner. No process.env secret, user credential or token operation.
  assert.equal(TokenFileStore.isAvailable(),false);
  const tokens=new TokenFileStore(data,{SILHOUETTE_TOKEN_KEY:crypto.randomBytes(32).toString('hex')});
  assert.equal(fs.realpathSync(tokens.dir),fs.realpathSync(path.join(data,'auth-tokens')));assert.deepEqual(fs.readdirSync(tokens.dir),[]);assert.equal(TokenFileStore.isAvailable(),false);
  manager=new ConnectionManager(store,tokens);
  record('real-manager-store-and-empty-ephemeral-custody',{nativeOpen:db.open,constructorEnvOnly:true,processKeyStillAbsent:true,tokenDirectoryEmpty:true});
  const input={providerId:'NATIVE_TRIAL',accountId:'pending',label:'pending',method:'oauth-loopback',config:{clientId:'native-no-exchange',authorizeUrl:'https://127.0.0.1:1/never-opened',tokenUrl:'https://127.0.0.1:1/never-fetched'}};
  const started=manager.startOAuthConnect(input,'native-local-principal');
  // These are READ-ONLY observations of original production-owned promises.
  // No method, map, listener, timer or server is replaced or injected.
  startResult=outcome(started);assert(manager.activeOriginals.has(started));assert.equal(manager.pending.size,0);
  const physicals=[...manager.physicalOriginals];assert.equal(physicals.length,1);const originalPhysical=physicals[0];
  physicalResult=originalPhysical.then(()=>{record('same-original-native-close-callback-settled',{dbStillOpen:db.open});return {ok:true};},error=>({ok:false,error}));
  publication=started.then(info=>{
   const entry=manager.pending.get(info.pendingId);assert(entry && entry.waiter);assert.strictEqual(entry.waiter.closed,originalPhysical);assert.strictEqual(entry.codePromise,entry.waiter.waitForCode);
   assert.equal(db.open,true);assert.equal(manager.originalsSealed,true);assert(Number.isInteger(entry.waiter.port)&&entry.waiter.port>0&&entry.waiter.port<=65535);
   codeResult=entry.codePromise.then(()=>({ok:true}),error=>{record('same-original-code-task-rejected',{dbStillOpen:db.open,cancelled:error instanceof Error&&error.message==='login cancelled',errorName:disposition(error).name,errorCode:disposition(error).code});return {ok:false,error};});
   record('same-admitted-start-late-waiter-published-after-seal',{port:entry.waiter.port,samePhysicalPromise:true,sameCodePromise:true,dbStillOpen:true});return {ok:true};
  },error=>({ok:false,error}));
  // Attach rejection handling to the observer now, not after drain, so an
  // assertion in observation cannot become an orphan/unhandled rejection.
  const observedPublication=outcome(publication);
  record('actual-start-admitted-before-seal',{sameStartRetained:true,physicalRetainedBeforeStartReturn:true,pendingBeforeSeal:0,dbStillOpen:db.open});
  drain=seal(manager);assert.strictEqual(seal(manager),drain);assert.equal(manager.originalsSealed,true);
  record('original-manager-sealed-before-await-start',{sameDrainPromise:true,dbStillOpen:db.open});
  // outcome() observes the SAME original promises without replacing ownership.
  const originalDrain=outcome(drain);
  const publicStart=await startResult;
  if(!publicStart.ok){await observedPublication;throw publicStart.error;}
  const observed=await observedPublication;assert(observed.ok && observed.value.ok);
  const closed=await physicalResult;assert(closed.ok,'original physical callback failed');
  assert(codeResult,'missing SAME original code task');const code=await codeResult;assert.equal(code.ok,false);assert.equal(code.error.message,'login cancelled');
  const {OAuthCallbackError}=require(path.join(root,'services/auth/oauthLoopback.ts'));assert(code.error instanceof OAuthCallbackError);
  const joined=await originalDrain;if(!joined.ok)throw joined.error;assert.equal(db.open,true);assert.equal(manager.physicalOriginals.size,0);assert.equal(manager.activeOriginals.size,0);
  assert.equal(store.list().length,0);assert.deepEqual(fs.readdirSync(tokens.dir),[]);assert.equal(process.env.SILHOUETTE_TOKEN_KEY,undefined);
  record('same-manager-drain-joined-before-database-close',{nativeOpen:db.open,accounts:0,tokenFiles:0,activeOriginals:0,physicalOriginals:0});
  const post=await outcome(manager.startOAuthConnect(input,'native-local-principal'));assert.equal(post.ok,false);assert.equal(post.error.code,'runtime-unavailable');assert.equal(manager.physicalOriginals.size,0);assert.deepEqual(fs.readdirSync(tokens.dir),[]);
  const before=beforeCloseProof();store.close();assert.equal(db.open,false);assert.throws(()=>store.list(),/not open/);const files=fileEvidence(),after=scopedHandleCounts();assert.equal(after.fdMatches,0);assert.equal(after.mapMatches,0);
  record('same-original-database-closed-only-after-drain',{beforeFdMatches:before.fdMatches,nativeOpen:db.open,operationsRejected:true,afterFdMatches:after.fdMatches,afterMapMatches:after.mapMatches,postSealStartRejectedBeforeAllocation:true,files});
  bodySucceeded=true;
 }catch(error){failure=disposition(error);process.exitCode=1;}
 finally {
  // Join genuine admitted work first. A bind failure stays FAIL/NOT_COVERED,
  // never successful ERR_SERVER_NOT_RUNNING or permission to enable loopback.
  if(manager){try{if(!drain)drain=seal(manager);await drain;record('finally-original-manager-drain-joined');}catch(error){cleanupFailures.push({resource:'same-manager-drain',...disposition(error)});process.exitCode=1;}}
  if(publication){try{await publication;}catch(error){cleanupFailures.push({resource:'same-start-observer',...disposition(error)});process.exitCode=1;}}
  if(physicalResult){try{const row=await physicalResult;if(!row.ok)throw row.error;}catch(error){cleanupFailures.push({resource:'same-original-physical',...disposition(error)});process.exitCode=1;}}
  if(codeResult){try{const row=await codeResult;if(row.ok)throw Error('unexpected code success');}catch(error){cleanupFailures.push({resource:'same-original-code-observer',...disposition(error)});process.exitCode=1;}}
  // A rejected drain prohibits closing SQLite while original borrowers may
  // survive. Do not manufacture safety with replacement handles or kills.
  if(store && db?.open){
   if(manager && cleanupFailures.some(row=>row.resource==='same-manager-drain')){cleanupFailures.push({resource:'same-store-close-not-safe',name:'UNVERIFIED_MANAGER_DRAIN',code:null});process.exitCode=1;}
   else {try{store.close();record('same-store-emergency-close-returned');}catch(error){cleanupFailures.push({resource:'same-original-store',...disposition(error)});process.exitCode=1;}}
  }
  if(initialDispatcher===undefined){const observed=globalThis[dispatcherKey];if(!agent)agent=observed;if(agent){try{assert.strictEqual(observed,agent);await agent.close();assert.equal(agent.closed,true);if(agentSymbols)assert.equal(agent[agentSymbols.kClients].size,0);record('harness-only-same-undici-import-agent-closed',{sameGlobalIdentity:globalThis[dispatcherKey]===agent,closed:true,clientsAfter:agentSymbols?agent[agentSymbols.kClients].size:null,productionDrained:false});}catch(error){cleanupFailures.push({resource:'HARNESS_ONLY_UNDICI_IMPORT_AGENT',...disposition(error)});process.exitCode=1;}}}
  let finalFiles=[];try{if(fs.existsSync(path.join(data,'account-wal.sqlite')))finalFiles=fileEvidence();const after=scopedHandleCounts();assert.equal(after.fdMatches,0);assert.equal(after.mapMatches,0);record('final-scoped-file-proof',{files:finalFiles,afterFdMatches:after.fdMatches,afterMapMatches:after.mapMatches});}catch(error){cleanupFailures.push({resource:'final-scoped-proof',...disposition(error)});process.exitCode=1;}
  let tsImports=[];try{tsImports=Object.keys(require.cache).filter(file=>file.startsWith(root+path.sep)&&file.endsWith('.ts')).map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));}catch(error){cleanupFailures.push({resource:'actual-ts-imports',...disposition(error)});process.exitCode=1;}
  const report={schemaVersion:1,scenario,scope:'REAL_ADMITTED_MANAGER_OAUTH_START_SEAL_NO_REQUEST_VENDOR_TOKEN_OR_GLOBAL_CLOSURE',events,failure,cleanupFailures,assertionsCompleted:bodySucceeded&&failure===null,imports:imports(),tsImports,globalLifecycle:'INCOMPLETE_UNCHANGED',externalImportOwner:'UNDICI_IMPORT_AGENT_NOT_PRODUCTION_DRAINED',outerNaturalExitStillRequired:true};
  fs.writeFileSync(evidence,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
})();
