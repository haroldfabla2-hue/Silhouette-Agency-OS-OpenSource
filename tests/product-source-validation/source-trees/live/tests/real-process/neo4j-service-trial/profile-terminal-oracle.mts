/** Executes the exact declared source function body with real node:http Response.
 * Module import/app graph is deliberately NOT claimed by this source-body probe.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import ts from '/tmp/work/node_modules/typescript/lib/typescript.js';
const source=readFileSync('/tmp/work/server/controllers/chatController.ts','utf8');
const ast=ts.createSourceFile('chatController.ts',source,ts.ScriptTarget.Latest,true);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='finishChatFailure');assert.equal(functions.length,1);
const exact=functions[0].getText(ast);assert(exact.startsWith('export function finishChatFailure'));
const compiled=ts.transpileModule(exact,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports:any={};new Function('exports',compiled)(exports);const finish=exports.finishChatFailure;assert.equal(typeof finish,'function');
for(const original of [undefined,null,'original string',new Error('authored error input')]) {
 let serverFailure:unknown;
 const server=createServer((_req,res)=>{try{finish(res,original,'PROFILE',{chatMessage:'SQLITE_APPEND_RETURNED',profile:{state:'FAILED_NO_CONFIRMED_COMMITS',completed:[],failedStep:1,failedStepCommit:'NOT_CONFIRMED'},generation:'NOT_STARTED'},true);}catch(e){serverFailure=e;res.destroy();}});
 await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));const address=server.address();assert(address&&typeof address!=='string');
 try {
  const data=await new Promise<string>((yes,no)=>{const req=request({host:'127.0.0.1',port:address.port,path:'/'},res=>{let body='';res.setEncoding('utf8');res.on('data',s=>{body+=s;if(body.length>8192){req.destroy();no(new Error('response cap'));}});res.once('end',()=>yes(body));res.once('error',no);});req.once('error',no);req.end();});
  assert.equal(serverFailure,undefined);const packet=JSON.parse(data.trim().slice(6));assert.equal(packet.type,'error');assert.equal(packet.code,'PROFILE_UPDATE_FAILED');assert.equal(packet.receipt.generation,'NOT_STARTED');assert(!data.includes('authored error input'));
 } finally {await new Promise<void>((yes,no)=>server.close(e=>e?no(e):yes()));}
}
console.log('PROFILE_TERMINAL_BODY_ORACLE_PASS',JSON.stringify({cases:4,sourceBodySHA256:createHash('sha256').update(exact).digest('hex'),scope:'EXACT_SOURCE_FUNCTION_BODY_REAL_HTTP_NOT_CONTROLLER_MODULE_BOOT_OR_UI'}));
