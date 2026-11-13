/** Actual sockets/handler/permission errors/restarts. No model test double. */
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,chmodSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
const script=resolve('tests/real-process/web-handler-receipt-child.ts');
function run(directory:string,mode:string){
 const text=execFileSync(process.execPath,['--import',loader,script,mode],{cwd:directory,encoding:'utf8',timeout:25000,env:{PATH:process.env.PATH,HOME:directory,NODE_ENV:'test',SILHOUETTE_PROVIDERS:'off',SILHOUETTE_INFERENCE_MODE:'cloud-only'}});
 return text.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
}
describe('actual gateway -> handler -> receipt -> WAL boundary',()=>{
 for(const mode of ['normal','post-delivery-wal-failed'])it(mode+' and actual restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'web-handler-real-'));
  try{
   const result=run(directory,mode);expect(result.actual_web_reply_count).toBe(1);expect(result.real_off_output_not_cognition).toBe(true);
   const before=JSON.parse(readFileSync(join(directory,'data/wal/memory_wal.json'),'utf8')).find((e:any)=>e.data.input==='authored-web-handler-request');
   // Re-enable the authored fixture's memory path before testing interruption
   // recording. Never a claim that restart bypasses an unwritable live store.
   chmodSync(join(directory,'data/agents/core-01/MEMORY.md'),0o600);
   const restarted=run(directory,mode==='normal'?'restart-committed':'restart-interrupted');
   expect(restarted.wal_id).toBe(before.id);expect(restarted.wal_timestamp).toBe(before.timestamp);
   expect(restarted.no_request_reexecution).toBe(true);
  }finally{if(existsSync(join(directory,'data/agents/core-01/MEMORY.md')))chmodSync(join(directory,'data/agents/core-01/MEMORY.md'),0o600);rmSync(directory,{recursive:true,force:true});}
 },30000);
 for(const mode of ['confirmation-early-return','route-once','invalid-session'])it(mode,()=>{
  const directory=mkdtempSync(join(tmpdir(),'web-handler-route-real-'));
  try{expect(run(directory,mode).mode).toBe(mode);}finally{rmSync(directory,{recursive:true,force:true});}
 },30000);
});
