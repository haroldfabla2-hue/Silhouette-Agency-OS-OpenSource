/** Actual subprocesses, local stores, HTTP app and OS SIGTERM. No providers. */
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
const loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
const script=resolve('tests/real-process/curiosity-drain-child.ts');
const environment=(directory:string)=>({PATH:process.env.PATH,HOME:directory,NODE_ENV:'test',SILHOUETTE_PROVIDERS:'off',SILHOUETTE_BOOT_MODE:'acceptance'});
async function availablePort():Promise<number>{
 const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;
}
describe('real curiosity shutdown receipt',()=>{
 for(const mode of ['service-drain','service-blocked'])it(mode,()=>{
  const directory=mkdtempSync(join(tmpdir(),'curiosity-drain-real-'));
  try{const output=execFileSync(process.execPath,['--import',loader,script,mode],{cwd:directory,encoding:'utf8',timeout:25000,env:environment(directory)});expect(output).toContain(`"mode":"${mode}"`);}
  finally{rmSync(directory,{recursive:true,force:true});}
 });
 for(const mode of ['app-drain','app-blocked'])it(mode,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'curiosity-app-drain-real-'));let output='';let errors='';
  const child=spawn(process.execPath,['--import',loader,script,mode],{cwd:directory,env:{...environment(directory),PORT:String(await availablePort())},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const timeout=setTimeout(()=>child.kill('SIGKILL'),25000);
  try{
   const result=await new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
   if(result.code !== (mode==='app-blocked'?1:0) || !output.includes('HTTP server closed')) console.error(JSON.stringify({mode,result,output,errors}));
   expect(result,{output,errors}).toEqual({code:mode==='app-blocked'?1:0,signal:null});
   expect(output).toContain('HTTP server closed');
   const original=readFileSync(join(directory,'data/curiosity_gaps.json'),'utf8');
   if(mode==='app-drain'){expect(JSON.parse(original).topics?.drainfixturetopic?.count ?? 0).toBe(250);expect(output).toContain('Curiosity accepted work drained');}
   else{expect(original).toBe('{original corrupt fixture');expect(errors).toContain('Curiosity drainage failed');}
  }finally{clearTimeout(timeout);if(child.exitCode===null)child.kill('SIGKILL');rmSync(directory,{recursive:true,force:true});}
 },30000);
});
