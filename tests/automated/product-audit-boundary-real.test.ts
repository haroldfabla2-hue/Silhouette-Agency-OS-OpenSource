/** Real modules, local file reads/denials and actual corrupted storage. */
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
function run(script:string,mode:string){
 const directory=mkdtempSync(join(tmpdir(),'product-boundary-real-'));
 try{
  const stdout=execFileSync(process.execPath,['--import',loader,resolve('tests/real-process/'+script),mode],{cwd:directory,encoding:'utf8',timeout:25000,
   env:{PATH:process.env.PATH,HOME:directory,NODE_ENV:'test',SILHOUETTE_PROVIDERS:'off'}});
  return stdout.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
 }finally{rmSync(directory,{recursive:true,force:true});}
}
describe('actual outcome versus learning receipt boundary',()=>{
 for(const mode of ['denied','success-audit-failed','failure-audit-failed','denied-audit-failed']){
  it(`preserves ${mode}`,()=>{expect(run('chat-audit-boundary-child.ts',mode).mode).toBe(mode);});
 }
});
describe('actual curiosity legacy and corrupt snapshot boundaries',()=>{
 for(const mode of ['legacy','corrupt']){
  it(`restores or reports ${mode} without losing originals`,()=>{expect(run('curiosity-legacy-child.ts',mode).mode).toBe(mode);});
 }
});
