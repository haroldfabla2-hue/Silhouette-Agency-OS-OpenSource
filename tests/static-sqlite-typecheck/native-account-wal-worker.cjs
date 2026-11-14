'use strict';
// SOURCE REVIEW ONLY. Never run without separately approved native gate.
// One scenario per original process. No mocks, monkeypatches, injected fetch,
// fake vendor, auth code, token exchange, credential or user account access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = fs.realpathSync(process.argv[2]);
const scenario = process.argv[3];
const evidence = path.resolve(process.argv[4]);
const data = path.resolve(process.argv[5]);
const manifest = JSON.parse(fs.readFileSync(process.argv[6], 'utf8'));
const events = []; const resources = []; const cleanupFailures = [];
const record = (name, facts = {}) => events.push({ name, atNs: process.hrtime.bigint().toString(), ...facts });
const disposition = error => ({ name: error?.name || typeof error, code: error?.code || null });
function outcome(original) { return original.then(value => ({ok: true, value}), error => ({ok: false, error})); }
function retainCleanup(name, close) { resources.push({name, close}); }
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
function afterCloseProof(database,before,rejectOperation) {
  assert.equal(database.open,false); assert.throws(rejectOperation,/not open/);
  const files=fileEvidence(),after=scopedHandleCounts();
  assert.equal(after.fdMatches,0,'same process must retain no database/sidecar descriptors');
  assert.equal(after.mapMatches,0,'same process must retain no database/sidecar mappings');
  return {beforeFdMatches:before.fdMatches,afterFdMatches:after.fdMatches,afterMapMatches:after.mapMatches,trackedIdentityCount:trackedFiles.size,operationsRejected:true,files};
}
function newStore(name) {
  const {AccountStore} = require(path.join(root,'services/auth/accountStore.ts'));
  const filename = path.join(data, name + '.sqlite'); const store = new AccountStore(filename); const db = store.db;
  retainCleanup('same-original-account-store', () => { if (db.open) { store.close(); record('same-store-emergency-close-returned'); } });
  assert(db && db.open); assert.equal(db.pragma('journal_mode', {simple:true}), 'wal');
  const nativePath=fs.realpathSync(path.join(root,'node_modules/better-sqlite3/build/Release/better_sqlite3.node'));
  assert(require.cache[nativePath], 'actual loaded native module must be exact pinned binary');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(nativePath)).digest('hex'), manifest.nativeAddonSha256);
  const sqliteVersion=db.prepare('SELECT sqlite_version() AS version').get().version;
  record('exact-addon-loaded-and-native-sql-executed',{abi:process.versions.modules,sqliteVersion});
  record('real-account-store-wal-open', {file: path.basename(filename)});
  return {store, db, filename};
}
async function storeTrial() {
  const {store,db,filename} = newStore('account-wal');
  const common = {providerId:'NATIVE_TRIAL', method:'env', secretRef:'env:UNSET_NATIVE_TRIAL_REFERENCE'};
  store.add({...common, accountId:'keep', label:'keep'}); store.add({...common, accountId:'remove', label:'remove'});
  assert.equal(store.list().length, 2); store.activate('NATIVE_TRIAL','keep'); assert.equal(store.active('NATIVE_TRIAL').accountId,'keep');
  assert.equal(store.remove('NATIVE_TRIAL','remove'), true); assert.equal(store.remove('NATIVE_TRIAL','remove'), false);
  const expected = store.list(); assert.equal(expected.length,1);
  record('actual-account-transactions-committed', {count:expected.length});
  const originalBefore=beforeCloseProof();
  store.close();
  const originalProof=afterCloseProof(db,originalBefore,()=>store.list());
  record('same-native-database-close-returned',{nativeOpen:db.open,proof:originalProof});
  const Database = require(path.join(root,'node_modules/better-sqlite3'));
  const reopened = new Database(filename,{readonly:true,fileMustExist:true});
  let verifierBefore, verifierFailure;
  try { verifierBefore=beforeCloseProof(); const rows = reopened.prepare('SELECT account_id,active,status FROM provider_accounts').all(); assert.deepEqual(rows,[{account_id:'keep',active:1,status:'active'}]); record('read-only-reopen-durable-metadata', {rows: rows.length}); }
  catch(error) { verifierFailure=error; throw error; }
  finally {
    try { reopened.close(); assert(verifierBefore,'missing real verifier positive-control proof'); const proof=afterCloseProof(reopened,verifierBefore,()=>reopened.prepare('SELECT 1')); record('independent-read-only-verifier-closed',{nativeOpen:reopened.open,proof}); }
    catch(error) { if(verifierFailure) cleanupFailures.push({resource:'same-independent-read-only-verifier',...disposition(error)}); else throw error; }
  }
  record('durable-file-evidence-after-all-original-and-verifier-close',{bytes:fs.statSync(filename).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')});
}
(async()=>{
  let failure = null;
  try {
    require('./exact-ts-loader.cjs')(root, path.join(root, 'node_modules/typescript/lib/typescript.js'), manifest.typescriptEvaluationClosure);
    assert.equal(process.version, 'v22.18.0');
    assert.equal(process.versions.modules, '127');
    assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
    record('worker-native-gate-start',{scenario,node:process.version,abi:process.versions.modules});
    if(scenario==='account-wal') await storeTrial();
    else throw new Error('Unreviewed scenario denied');
    record('assertions-completed-not-yet-outer-natural-exit');
  } catch(error) { failure=disposition(error); process.exitCode=1; }
  finally {
    // Attempt ALL independent original cleanup even if another rejects.
    // Reverse dependency order: manager before its SAME database.
    for(const resource of resources.reverse()) {
      try { await resource.close(); record('cleanup-settled',{resource:resource.name}); }
      catch(error){ cleanupFailures.push({resource:resource.name,...disposition(error)}); process.exitCode=1; }
    }
    const report={schemaVersion:2,scenario,scope:'REAL_ACCOUNTSTORE_SQLITE_WAL_ONLY_NO_SOCKET_OAUTH_VENDOR_OR_FULL_RUNTIME',events,failure,cleanupFailures,assertionsCompleted:!failure,globalLifecycle:'INCOMPLETE_UNCHANGED',outerNaturalExitStillRequired:true};
    fs.writeFileSync(evidence, JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    // NEVER process.exit()/unref/force-close to manufacture a clean exit.
  }
})();
