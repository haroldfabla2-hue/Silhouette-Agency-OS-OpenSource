import { describe, it, expect } from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import crypto from 'node:crypto';
import {selfCodeService} from '../../services/selfCodeService';
import {SelfDevCycleService} from '../../services/selfdev/cycleService';
import {memoryRepairMapping} from '../../services/selfdev/incidentMappings';

// Real git and filesystem only. Operator-authored fixture proves mechanics,
// never a useful autonomous repair, independent oracle or applied learning.
describe('isolated selfdev evidence and pending-learning boundaries (real git)',()=>{
 it('preserves exact modified/untracked candidate and refuses reset; restart proposal is idempotent and cannot execute or publish',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'selfdev-preservation-'));const repo=path.join(root,'repo'),wt=path.join(root,'work');fs.mkdirSync(repo);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
  const names=['SELF_REPO_PATH','SELF_WORKTREE_PATH','SELF_REPO_UPSTREAM_URL','SELFDEV_DIR'];const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  try{
   git('init','-q','-b','main');git('config','user.name','fixture');git('config','user.email','fixture@localhost');fs.writeFileSync(path.join(repo,'source.ts'),'export const original = true;\n');git('add','.');git('commit','-qm','authored baseline');const sha=git('rev-parse','HEAD');
   process.env.SELF_REPO_PATH=repo;process.env.SELF_WORKTREE_PATH=wt;process.env.SELF_REPO_UPSTREAM_URL=repo;
   await selfCodeService.ensureWorktree();
   fs.writeFileSync(path.join(wt,'source.ts'),'export const candidate = true;\n');fs.writeFileSync(path.join(wt,' candidate\nfile.ts'),'untracked authored bytes\n');
   await expect(selfCodeService.syncWithUpstream()).rejects.toThrow(/dirty candidate preserved/);
   expect(git('rev-parse','HEAD')).toBe(sha);expect(fs.readFileSync(path.join(wt,'source.ts'),'utf8')).toBe('export const candidate = true;\n');
   const directory=wt+'.preserved-candidates';const entries=fs.readdirSync(directory);expect(entries).toHaveLength(1);const evidence=fs.readFileSync(path.join(directory,entries[0]));expect(crypto.createHash('sha256').update(evidence).digest('hex')+'.json').toBe(entries[0]);
   const snapshot=JSON.parse(evidence.toString());expect(snapshot.baseSha).toBe(sha);expect(snapshot.files.find((f:any)=>f.path===' candidate\nfile.ts').contentBase64).toBe(Buffer.from('untracked authored bytes\n').toString('base64'));
   await expect(selfCodeService.syncWithUpstream()).rejects.toThrow(/dirty candidate preserved/);expect(fs.readdirSync(directory)).toEqual(entries);
   const escape=path.join(root,'outside');fs.mkdirSync(escape);fs.symlinkSync(escape,path.join(wt,'link'),'dir');await expect(selfCodeService.writeFile('link/no.ts','bad','authored escape probe')).rejects.toThrow(/symlink/);expect(fs.existsSync(path.join(escape,'no.ts'))).toBe(false);
   const dir=path.join(root,'cycles');const s=new SelfDevCycleService({dir});const input={memoryId:'authored-proposal-memory-id',source:'continuum-promote',incidentId:'authored-incident-id',issue:'Authored mechanics fixture only'};
   const c=s.createLearningProposal(input);expect(c.scope).toEqual(memoryRepairMapping(input.source)!.scope);expect(c.learningProposal?.applied).toBe(false);expect(c.learningProposal?.verification).toBe('BASELINE_ORACLE_REQUIRED');
   const restarted=new SelfDevCycleService({dir});const replay=restarted.createLearningProposal(input);expect(replay.id).toBe(c.id);expect(restarted.list()).toHaveLength(1);
   const before=fs.readFileSync(path.join(wt,'source.ts'));expect((await restarted.attempt(c.id,[{op:'write',path:'services/continuumMemory.ts',content:'anything',rationale:'fixture'}])).state).toBe('PLANNED');expect(fs.readFileSync(path.join(wt,'source.ts'))).toEqual(before);
   expect(()=>restarted.requestPR(c.id,'fixture-operator')).toThrow(/independent baseline/);expect(fs.readdirSync(path.join(dir,'pr-requests'))).toHaveLength(0);
   expect(()=>restarted.createLearningProposal({...input,source:'unknown'})).toThrow(/declared repair mapping/);expect(()=>restarted.createLearningProposal({...input,incidentId:'conflicting'})).toThrow(/conflicts/);
   const mapping=memoryRepairMapping(input.source)!;mapping.scope.push('security');expect(memoryRepairMapping(input.source)!.scope).not.toContain('security');expect(memoryRepairMapping('__proto__')).toBeUndefined();
  }finally{for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}fs.rmSync(root,{recursive:true,force:true});}
 });
});
