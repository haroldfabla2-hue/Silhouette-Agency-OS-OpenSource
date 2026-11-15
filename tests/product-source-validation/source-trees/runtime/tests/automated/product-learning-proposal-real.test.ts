import { standaloneFixturePreparationInputs } from '../real-process/standalone-fixture-bootstrap';
/** Two actual processes and real durable stores. Authored fixture proves linkage,
 * not a discovered useful improvement, autonomous planner or applied learning. */
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
it('proposal memory -> mapped pending cycle survives restart without planner, patch, PR or success credit',()=>{
 const root=mkdtempSync(join(tmpdir(),'learning-real-'));mkdirSync(join(root,'db/migrations'),{recursive:true});cpSync(resolve('db/migrations/sqlite'),join(root,'db/migrations/sqlite'),{recursive:true});
 const script=resolve('tests/real-process/learning-proposal-child.ts'),loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
 try{
  for(const phase of ['write','read']){
   const output=execFileSync(process.execPath,['--import',loader,script,phase],{cwd:root,timeout:25000,encoding:'utf8',env:{...standaloneFixturePreparationInputs(),PATH:process.env.PATH,HOME:root,NODE_ENV:'test',VITEST:'true',SILHOUETTE_PROVIDERS:'off'}});
   const result=output.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).at(-1);expect(result).toMatchObject({phase,applied:false,planner_calls:0,patches_applied:0,learning_successes:0,fixture_only:true});
  }
  const cycles=JSON.parse(readFileSync(join(root,'data/selfdev/cycles.json'),'utf8')).cycles;expect(cycles).toHaveLength(1);expect(cycles[0].patch).toBeUndefined();expect(cycles[0].learningProposal.stage).toBe('HUMAN_APPROVAL_PENDING');
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);
