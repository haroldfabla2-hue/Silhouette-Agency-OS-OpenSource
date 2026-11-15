/** Real native source-helper oracle only. No application service substitutes. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import Database from '/tmp/work/node_modules/better-sqlite3/lib/index.js';
import { commitProfileMutation, readProfileCurrent, importProfileOnlyIfAbsent, prepareProfileMutation } from '/tmp/work/services/memory/profileAuthority.ts';
const dir=process.env.PROFILE_ORACLE_DIR || mkdtempSync(join(tmpdir(),'profile-native-'));
const file=join(dir,'authored.sqlite');
const db=new Database(file,{timeout:5000});
db.pragma('journal_mode=WAL');db.pragma('synchronous=NORMAL');db.pragma('busy_timeout=5000');
if(process.argv[2]==='child') {
 const mode=process.argv[3];
 if(mode==='write') { const r=commitProfileMutation(db,'user-A',{kind:'preference',key:process.argv[4],value:process.argv[4]}); assert.equal(r.receipt.state,'SQLITE_COMMIT_RETURNED'); }
 else {assert.equal(readProfileCurrent(db,'user-A')?.name,'Authored Fixture');assert.equal(readProfileCurrent(db,'user-A')?.preferences.child,'child');}
 db.close();
} else {
 db.exec(readFileSync('/tmp/work/db/migrations/sqlite/003_user_profiles.up.sql','utf8'));
 assert.equal(db.pragma('journal_mode',{simple:true}),'wal');assert.equal(db.pragma('synchronous',{simple:true}),1);
 const one=commitProfileMutation(db,'user-A',{kind:'name',name:'Authored Fixture'});assert.equal(one.receipt.state,'SQLITE_COMMIT_RETURNED');assert(Object.isFrozen(one.snapshot));
 const second=new Database(file,{timeout:5000});
 commitProfileMutation(second,'user-A',{kind:'preference',key:'other',value:{original:true}});
 commitProfileMutation(db,'user-A',{kind:'fact',fact:'authored fixture fact'});
 assert.equal(readProfileCurrent(db,'user-A')?.preferences.other.original,true);
 assert.equal(commitProfileMutation(second,'user-A',{kind:'fact',fact:'authored fixture fact'}).receipt.state,'UNCHANGED_CONFIRMED');
 const candidate={...one.snapshot,name:'stale import'};
 assert.equal(importProfileOnlyIfAbsent(second,'user-A',candidate).snapshot.name,'Authored Fixture');
 const before=JSON.stringify(readProfileCurrent(db,'user-A'));
 db.pragma('query_only=ON');let nativeFailure:unknown;
 try{commitProfileMutation(db,'user-A',{kind:'name',name:'must not publish'});}catch(e){nativeFailure=e;}
 assert(nativeFailure);assert.equal((nativeFailure as any).code,'SQLITE_READONLY');assert.equal(db.inTransaction,false);db.pragma('query_only=OFF');assert.equal(JSON.stringify(readProfileCurrent(db,'user-A')),before);
 db.exec('BEGIN IMMEDIATE');assert.throws(()=>commitProfileMutation(db,'user-A',{kind:'name',name:'nested'}));assert.throws(()=>readProfileCurrent(db,'user-A'));db.exec('ROLLBACK');
 for(const value of [undefined,Infinity,()=>true])assert.throws(()=>prepareProfileMutation({kind:'preference',key:'invalid',value}));
 const cyclic:any={};cyclic.self=cyclic;assert.throws(()=>prepareProfileMutation({kind:'preference',key:'invalid',value:cyclic}));
 assert.throws(()=>prepareProfileMutation({kind:'preference',key:'missing'}as any));
 async function child(mode:string,key='') {
  const original=spawn(process.execPath,['--import','/tmp/work/node_modules/tsx/dist/loader.mjs','/tmp/harness/profile-native-oracle.mts','child',mode,key],{env:{...process.env,PROFILE_ORACLE_DIR:dir},stdio:['ignore','pipe','pipe']});
  let bytes=0;for(const stream of [original.stdout,original.stderr])stream.on('data',b=>{bytes+=b.length;/* Keep draining without retaining output; fail after natural close, outer deadline owns any stop. */});
  const exit=await new Promise<{code:number|null,signal:NodeJS.Signals|null}>((yes,no)=>{original.once('error',no);original.once('close',(code,signal)=>yes({code,signal}));});assert.equal(exit.signal,null);assert.equal(exit.code,0);assert(bytes<=32768);
 }
 const writes=await Promise.allSettled([child('write','child'),child('write','parallel')]);for(const result of writes)if(result.status==='rejected')throw result.reason;assert.equal(readProfileCurrent(db,'user-A')?.preferences.child,'child');assert.equal(readProfileCurrent(db,'user-A')?.preferences.parallel,'parallel');
 second.close();db.close();await child('read');
 const full=new Database(join(dir,'full.sqlite'));full.exec(readFileSync('/tmp/work/db/migrations/sqlite/003_user_profiles.up.sql','utf8'));
 const initial=commitProfileMutation(full,'full-user',{kind:'name',name:'first committed'});const pageCount=full.pragma('page_count',{simple:true});full.pragma('max_page_count='+pageCount);
 let fullError:unknown;try{commitProfileMutation(full,'full-user',{kind:'fact',fact:'x'.repeat(2*1024*1024)});}catch(e){fullError=e;}
 assert.equal((fullError as any)?.code,'SQLITE_FULL');assert.equal(readProfileCurrent(full,'full-user')?.name,initial.snapshot.name);assert.deepEqual(readProfileCurrent(full,'full-user')?.facts,[]);full.close();
 console.log('PROFILE_NATIVE_ORACLE_PASS',JSON.stringify({realNative:true,connections:2,childProcesses:3,readOnlyFailure:true,sqliteFull:true,scope:'HELPER_ONLY_NOT_SERVICE_HYDRATION_OR_FEATURE_ACCEPTANCE'}));
}
