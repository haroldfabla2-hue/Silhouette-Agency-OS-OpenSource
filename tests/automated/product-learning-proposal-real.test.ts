import { standaloneFixturePreparationInputs } from '../real-process/standalone-fixture-bootstrap';
import { createHash } from 'node:crypto';
/** Separate actual processes and real durable stores. Authored fixture proves linkage,
 * not a discovered useful improvement, autonomous planner or applied learning. */
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
it('proposal memory -> mapped pending cycle survives restart without planner, patch, PR or success credit',()=>{
 const root=mkdtempSync(join(tmpdir(),'learning-real-'));mkdirSync(join(root,'db/migrations'),{recursive:true});cpSync(resolve('db/migrations/sqlite'),join(root,'db/migrations/sqlite'),{recursive:true});
 const script=resolve('tests/real-process/learning-proposal-child.ts'),loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
 try{
  for(const phase of ['empty','ingest','write','read','failed','unavailable']){
   let output: string;
   try {
    output=execFileSync(process.execPath,['--import',loader,script,phase],{cwd:root,timeout:25000,encoding:'utf8',env:{...standaloneFixturePreparationInputs(),PATH:process.env.PATH,HOME:root,TMPDIR:root,NODE_OPTIONS:'--max-old-space-size=2048',NODE_ENV:'test',VITEST:'true',SILHOUETTE_PROVIDERS:'off',SILHOUETTE_INFERENCE_MODE:'cloud-only'}});
   } catch (error: unknown) {
    // execFileSync already captured these child text streams. Never let its
    // embedded child stderr frames masquerade as parent stack locations.
    const stream = (key: 'stdout' | 'stderr', limit: number) => {
     const value = typeof error === 'object' && error !== null && key in error ? error[key] : undefined;
     const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : '');
     const kept = bytes.length <= limit ? bytes : Buffer.concat([bytes.subarray(0, Math.floor(limit / 2)), bytes.subarray(bytes.length - Math.ceil(limit / 2))]);
     return { utf8ReencodedBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), truncated: bytes.length > limit, base64: kept.toString('base64') };
    };
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && Number.isSafeInteger(error.status) ? error.status : null;
    const signal = typeof error === 'object' && error !== null && 'signal' in error && typeof error.signal === 'string' ? error.signal.slice(0, 16) : null;
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code.slice(0, 32) : null;
    const diagnostic = { schema: 1, phase, status, signal, code, origin: 'ACTUAL_EXECFILESYNCHILD_ERROR_UTF8_REENCODED_UNTRUSTED', stdout: stream('stdout', 64), stderr: stream('stderr', 448) };
    let body = JSON.stringify(diagnostic);
    if (Buffer.byteLength(body) > 1152) body = JSON.stringify({ ...diagnostic, stdout: stream('stdout', 0), stderr: stream('stderr', 256) });
    const failure = new Error('LEARNING_CHILD_FAILURE_BASE64 ' + Buffer.from(body).toString('base64'));
    // Retain the real parent callsite only; child stderr remains encoded evidence,
    // not a synthetic parent stack that Vitest may try to read as source files.
    const parentFrame = failure.stack?.split('\n')[1];
    failure.stack = failure.name + ': ' + failure.message + (parentFrame ? '\n' + parentFrame.slice(0, 300) : '');
    throw failure;
   }
   const result=output.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).at(-1);expect(result).toMatchObject({phase,applied:false,planner_calls:0,patches_applied:0,learning_successes:0,fixture_only:true});
  }
  const cycles=JSON.parse(readFileSync(join(root,'data/selfdev/cycles.json'),'utf8')).cycles;expect(cycles).toHaveLength(1);expect(cycles[0].patch).toBeUndefined();expect(cycles[0].learningProposal.stage).toBe('HUMAN_APPROVAL_PENDING');
 }finally{rmSync(root,{recursive:true,force:true});}
},120000);
