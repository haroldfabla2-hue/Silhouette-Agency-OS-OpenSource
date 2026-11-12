/** Actual child processes and filesystem. No provider responses or doubles.
 * Each test owns its directory and a credential-free child environment. */
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const child=resolve('tests/real-process/continuous-wal-child.ts');
const loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
function run(mode:string,cwd:string){
 const stdout=execFileSync(process.execPath,['--import',loader,child,mode],{cwd,encoding:'utf8',timeout:15000,
  env:{PATH:process.env.PATH,HOME:cwd,NODE_ENV:'test',SILHOUETTE_PROVIDERS:'off'}});
 return stdout.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
}
function inDirectory(work:(directory:string)=>void){
 const directory=mkdtempSync(join(tmpdir(),'wal-real-'));
 try{work(directory);}finally{rmSync(directory,{recursive:true,force:true});}
}
describe('actual continuous WAL durability and honest recovery',()=>{
 it('persists before an immediate process exit and restores original work without completing it',()=>inDirectory(directory=>{
  expect(run('durable-before-return',directory).durable_before_work).toBe(true);
  expect(run('recovery',directory).original_payload_preserved).toBe(true);
 }));
 for(const mode of ['shutdown-pending','commit','corrupt','failed-append','failed-wal-write','retention']){
  it(`real ${mode} boundary`,()=>inDirectory(directory=>{expect(run(mode,directory).mode).toBe(mode);}));
 }
});
