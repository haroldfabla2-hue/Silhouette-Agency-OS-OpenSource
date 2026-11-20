// Requires exact npm ci tree. Real installed Vitest, not a fake runner/report.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {selfCodeService} from '../../services/selfCodeService.ts';
test('installed real Vitest baseline pass/fail/skip/import-error classification and full installed closure compatibility',async()=>{
 const installed=fs.realpathSync('node_modules');assert(fs.existsSync(path.join(installed,'vitest/vitest.mjs')),'complete installed Vitest required');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'authored-real-vitest-')),repo=path.join(root,'repo'),wt=path.join(root,'work');fs.mkdirSync(repo);
 const names=['SELF_REPO_PATH','SELF_WORKTREE_PATH'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
 try{
  git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Authored Fixture');
  const files={
   'package.json':'{"type":"module","private":true}',
   'vitest.config.ts':"export default {test:{include:['tests/*.test.ts'],retry:0,pool:'forks',maxWorkers:1}};",
   'services/feature.ts':'export const actual=1;',
   'services/oracleHelper.ts':'export const expected=1;',
   'tests/pass.test.ts':"import {test,expect} from 'vitest';import {actual} from '../services/feature';import {expected} from '../services/oracleHelper';test('authored pass',()=>expect(actual).toBe(expected));",
   'tests/fail.test.ts':"import {test,expect} from 'vitest';test('authored real failing assertion',()=>expect(1).toBe(2));",
   'tests/skip.test.ts':"import {test} from 'vitest';test.skip('authored skip',()=>{});",
   'tests/infra.test.ts':"import './absent-authored-module';",
   'tests/selfdev-oracles.json':JSON.stringify({version:1,oracles:[{target:'tests/pass.test.ts',codeUnderTest:['services/feature.ts'],oracleFiles:['tests/pass.test.ts','services/oracleHelper.ts']}]})
  };
  for(const [file,body] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});fs.writeFileSync(path.join(repo,file),body);}
  git('add','.');git('commit','-m','authored baseline fixture');fs.symlinkSync(installed,path.join(repo,'node_modules'),'dir');process.env.SELF_REPO_PATH=repo;process.env.SELF_WORKTREE_PATH=wt;
  await selfCodeService.ensureWorktree();
  const pass=await selfCodeService.runTest('tests/pass.test.ts');assert.equal(pass.code,0);assert.equal(pass.meaningful,true);assert.equal(pass.tests,1);
  const fail=await selfCodeService.runTest('tests/fail.test.ts');assert.equal(fail.code,1);assert.equal(fail.meaningful,true);assert.equal(fail.tests,1);
  assert.equal((await selfCodeService.runTest('tests/skip.test.ts')).meaningful,false);
  assert.equal((await selfCodeService.runTest('tests/infra.test.ts')).meaningful,false);
  await assert.rejects(selfCodeService.evaluationClosure(['services/oracleHelper.ts'],'tests/pass.test.ts'),/ambiguous editable oracle/);
  // This MUST fail CI if the fixed closure budget/symlink policy is incompatible,
  // rather than turn unavailable closure into a product/test success.
  assert.match(await selfCodeService.evaluationClosure(['services/feature.ts'],'tests/pass.test.ts'),/^[a-f0-9]{64}$/);
 }finally{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}fs.rmSync(root,{recursive:true,force:true});}
});
