/** Real HTTP, identity SQLite sessions, auth middleware, pending executor and
 * decisions. No provider/model call and no mocked identity/executor. Temporary
 * test identities are fixtures, not real people. Not OS-user separation proof. */
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {withAuthenticatedPrincipal} from '../../services/security/principalContext';
import {systemBus} from '../../services/systemBus';
import {SystemProtocol} from '../../types';
import {identityService} from '../../services/identityService';
import {actionExecutor} from '../../services/actionExecutor';
import {authMiddleware,resetTokenCache} from '../../server/middleware/authMiddleware';
import autonomyRouter from '../../server/routes/v1/autonomy.routes';
process.env.SILHOUETTE_API_KEY='temporary-test-api-token';
let server:Server,base:string,a:string,b:string,userA:string;
const decisions:Promise<boolean>[]=[];
beforeAll(async()=>{
 (actionExecutor as any).confirmationTimeoutMs=3000;
 await identityService.init();
 const A=await identityService.upsertUser({email:'a@fixture.invalid',name:'Fixture A'});
 const B=await identityService.upsertUser({email:'b@fixture.invalid',name:'Fixture B'});userA=A.id;
 a=identityService.createSession(A.id,identityService.registerDevice(A.id,'a','A').id).id;
 b=identityService.createSession(B.id,identityService.registerDevice(B.id,'b','B').id).id;
 resetTokenCache();const app=express();app.use(express.json());app.use(authMiddleware);
 // Test-only route enters real middleware context and real pending executor.
 app.post('/test/request',(req,res)=>{
  const action={id:crypto.randomUUID(),type:'SEND_EMAIL',agentId:'fixture-agent',payload:{to:'recipient@fixture.invalid',body:'fixture'},timestamp:Date.now(),requiresApproval:true,status:'PENDING'} as any;
  const work=actionExecutor.requestConfirmation(action,'two-user isolation fixture');
  void work.catch(()=>{});decisions.push(work);
  res.json({pending:true});
 });
 app.use('/v1/autonomy',autonomyRouter);
 await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
 base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
const request=(path:string,session:string,method='GET')=>fetch(base+path,{method,headers:{'x-session-id':session}});
describe('real two-user confirmation separation',()=>{
 it('only requesting principal can list, approve or reject; denied attempts preserve pending',async()=>{
  await request('/test/request',a,'POST');
  const own=await (await request('/v1/autonomy/confirmations',a)).json();
  expect(own.confirmations).toHaveLength(1);const id=own.confirmations[0].id;
  const other=await (await request('/v1/autonomy/confirmations',b)).json();
  expect(other.confirmations).toEqual([]);
  for(const decision of ['approve','reject']){
   const result=await (await request(`/v1/autonomy/confirmations/${id}/${decision}`,b,'POST')).json();
   expect(result.success).toBe(false);
  }
  expect((await (await request('/v1/autonomy/confirmations',a)).json()).confirmations).toHaveLength(1);
  expect((await (await request(`/v1/autonomy/confirmations/${id}/approve`,a,'POST')).json()).success).toBe(true);
  expect(await decisions[0]).toBe(true);
  expect(actionExecutor.approveAction(id,userA)).toBe(false);
 });
 it('expired and unowned proposals are not user rejections and emit no global confirmation payload',async()=>{
  const emitted:any[]=[];const handler=(event:any)=>emitted.push(event);
  const unsubscribe=systemBus.subscribe(SystemProtocol.CONFIRMATION_REQUIRED,handler);
  const before=(actionExecutor as any).confirmationTimeoutMs;(actionExecutor as any).confirmationTimeoutMs=10;
  try{
   const work=withAuthenticatedPrincipal(userA,()=>actionExecutor.requestConfirmation({id:'expiry',type:'SEND_EMAIL',payload:{body:'private'},agentId:'fixture'} as any));
   await expect(work).rejects.toMatchObject({code:'CONFIRMATION_UNAVAILABLE',reason:'EXPIRED'});
   expect(emitted).toEqual([]);
  }finally{(actionExecutor as any).confirmationTimeoutMs=before;unsubscribe();}
 });
 it('shared system token cannot mint pending ownership or approve',async()=>{
  const start=await fetch(base+'/test/request',{method:'POST',headers:{Authorization:'Bearer temporary-test-api-token'}});
  expect(start.status).toBe(200);
  expect((await fetch(base+'/v1/autonomy/architect/blueprint/absent/approve',{method:'POST',headers:{Authorization:'Bearer temporary-test-api-token'}})).status).toBe(403);await expect(decisions[1]).rejects.toMatchObject({code:'CONFIRMATION_UNAVAILABLE',reason:'NO_AUTHENTICATED_PRINCIPAL'});
  const own=await (await request('/v1/autonomy/confirmations',a)).json();expect(own.confirmations).toEqual([]);
 });
});
