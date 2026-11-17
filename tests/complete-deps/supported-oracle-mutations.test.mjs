// Proposed supported mechanics target only. Real same installed Vitest runner.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {selfCodeService} from '../../services/selfCodeService.ts';
test('reviewed existing gates oracle rejects scope/shrink/ratio mutations with unchanged oracle/config/setup/lock',async()=>{
 const checkout=process.cwd(),installed=fs.realpathSync('node_modules');assert(fs.existsSync(path.join(installed,'vitest/vitest.mjs')));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'authored-supported-oracle-')),repo=path.join(root,'repo'),wt=path.join(root,'work');fs.mkdirSync(repo);
 const names=['SELF_REPO_PATH','SELF_WORKTREE_PATH'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
 const pinned=['tests/automated/fase1-selfdev-gates.test.ts','services/selfdev/gates.ts','vitest.config.ts','package.json','package-lock.json','tests/setup/sqlite-per-worker.ts','tests/setup/fetch-teardown.ts','tests/selfdev-oracles.json'];
 try{
  git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Authored Fixture');
  for(const file of pinned){const dest=path.join(repo,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(checkout,file),dest);}
  git('add','.');git('commit','-m','unchanged existing mechanics oracle');fs.symlinkSync(installed,path.join(repo,'node_modules'),'dir');process.env.SELF_REPO_PATH=repo;process.env.SELF_WORKTREE_PATH=wt;
  await selfCodeService.ensureWorktree();const target='tests/automated/fase1-selfdev-gates.test.ts',code='services/selfdev/gates.ts';const original=fs.readFileSync(path.join(wt,code),'utf8');
  const closure=await selfCodeService.evaluationClosure([code],target);assert.equal((await selfCodeService.runTest(target)).meaningful,true);assert.equal((await selfCodeService.runTest(target)).code,0);
  const mutations=[
   original.replace('export function checkScope(ops: GateOp[], scope: string[]): GateFailure | null {','export function checkScope(ops: GateOp[], scope: string[]): GateFailure | null { return null;'),
   original.replace('export function checkShrink(ops: GateOp[], readOriginal: (path: string) => string | null, maxRatio: number = MAX_DELETE_RATIO): GateFailure | null {','export function checkShrink(ops: GateOp[], readOriginal: (path: string) => string | null, maxRatio: number = MAX_DELETE_RATIO): GateFailure | null { return null;'),
   original.replace('export const MAX_DELETE_RATIO = 0.5;','export const MAX_DELETE_RATIO = 0.99;')
  ];
  for(const candidate of mutations){assert.notEqual(candidate,original);fs.writeFileSync(path.join(wt,code),candidate);assert.equal(await selfCodeService.evaluationClosure([code],target),closure);const result=await selfCodeService.runTest(target);assert.equal(result.code,1);assert.equal(result.meaningful,true);}
  fs.writeFileSync(path.join(wt,code),original);assert.equal((await selfCodeService.runTest(target)).code,0);
  for(const file of pinned.filter(x=>x!==code))assert(fs.readFileSync(path.join(wt,file)).equals(fs.readFileSync(path.join(checkout,file))));
 }finally{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}fs.rmSync(root,{recursive:true,force:true});}
});
