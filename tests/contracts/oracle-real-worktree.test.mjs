import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {selfCodeService} from '../../services/selfCodeService.ts';
test('actual isolated git worktree closure detects helper/dependency changes, ignores only declared code and refuses incomplete oracle',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'authored-oracle-'));const repo=path.join(root,'repo'),wt=path.join(root,'work');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
 git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Authored Fixture');
 for(const [name,body] of Object.entries({'tests/oracle.test.ts':"import {expect,test} from 'vitest';import {expected} from '../services/oracleHelper';import {actual} from '../services/feature';test('authored',()=>expect(actual).toBe(expected));",'tests/helper.ts':'authored helper','services/feature.ts':'export const actual=1;','services/oracleHelper.ts':'export const expected=1;','tests/selfdev-oracles.json':JSON.stringify({version:1,oracles:[{target:'tests/oracle.test.ts',oracleFiles:['tests/oracle.test.ts','services/oracleHelper.ts'],codeUnderTest:['services/feature.ts']}]})})){
  fs.mkdirSync(path.dirname(path.join(repo,name)),{recursive:true});fs.writeFileSync(path.join(repo,name),body);
 }git('add','.');git('commit','-m','authored fixture');
 fs.mkdirSync(path.join(repo,'node_modules/fixture'),{recursive:true});fs.writeFileSync(path.join(repo,'node_modules/fixture/data.txt'),'authored dependency');
 const oldRepo=process.env.SELF_REPO_PATH,oldWt=process.env.SELF_WORKTREE_PATH;process.env.SELF_REPO_PATH=repo;process.env.SELF_WORKTREE_PATH=wt;
 try{
  assert.equal((await selfCodeService.ensureWorktree()).created,true);
  await assert.rejects(selfCodeService.evaluationClosure(['services/oracleHelper.ts'],'tests/oracle.test.ts'),/ambiguous editable oracle/);
  const baseline=await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts');
  fs.writeFileSync(path.join(wt,'services/feature.ts'),'export const actual=2;');assert.equal(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),baseline);
  fs.writeFileSync(path.join(wt,'tests/helper.ts'),'changed helper');assert.notEqual(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),baseline);
  fs.writeFileSync(path.join(wt,'tests/helper.ts'),'authored helper');assert.equal(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),baseline);
  fs.writeFileSync(path.join(repo,'node_modules/fixture/data.txt'),'changed dependency');assert.notEqual(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),baseline);
  await assert.rejects(selfCodeService.runTest('tests/oracle.test.ts'),/pinned installed runner missing/);
  fs.writeFileSync(path.join(wt,'tests/oracle.test.ts'),'x'.repeat(524289));assert.equal((await selfCodeService.readFile('tests/oracle.test.ts')).truncated,true);
  const bin=path.join(repo,'node_modules/fixture/node_modules/.bin');fs.mkdirSync(bin,{recursive:true});
  fs.symlinkSync('../../data.txt',path.join(bin,'fixture'));
  const linked=await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts');assert.notEqual(linked,baseline);
  fs.writeFileSync(path.join(repo,'node_modules/fixture/data.txt'),'changed linked bytes');assert.notEqual(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),linked);
  fs.writeFileSync(path.join(repo,'node_modules/fixture/other.txt'),'changed linked bytes');
  const beforeRetarget=await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts');
  fs.unlinkSync(path.join(bin,'fixture'));fs.symlinkSync('../../other.txt',path.join(bin,'fixture'));
  assert.notEqual(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),beforeRetarget,'same bytes at a different target must change identity');
  fs.unlinkSync(path.join(bin,'fixture'));fs.symlinkSync('/etc/hosts',path.join(bin,'fixture'));
  await assert.rejects(selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),/bin symlink unsafe/);
  fs.unlinkSync(path.join(bin,'fixture'));fs.symlinkSync('..',path.join(bin,'fixture'));
  await assert.rejects(selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),/bin symlink unsafe/);
  fs.unlinkSync(path.join(bin,'fixture'));fs.symlinkSync('./missing',path.join(bin,'fixture'));
  await assert.rejects(selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),/ENOENT/);
  fs.unlinkSync(path.join(bin,'fixture'));fs.symlinkSync('./fixture',path.join(bin,'fixture'));
  await assert.rejects(selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),/ELOOP/);
  fs.unlinkSync(path.join(bin,'fixture'));
  fs.symlinkSync(path.join(repo,'node_modules/fixture/data.txt'),path.join(repo,'node_modules/fixture/linked'));
  await assert.rejects(selfCodeService.evaluationClosure(['services/feature.ts'],'tests/oracle.test.ts'),/symlink unsupported/);
 }finally{if(oldRepo===undefined)delete process.env.SELF_REPO_PATH;else process.env.SELF_REPO_PATH=oldRepo;if(oldWt===undefined)delete process.env.SELF_WORKTREE_PATH;else process.env.SELF_WORKTREE_PATH=oldWt;fs.rmSync(root,{recursive:true,force:true});}
});
