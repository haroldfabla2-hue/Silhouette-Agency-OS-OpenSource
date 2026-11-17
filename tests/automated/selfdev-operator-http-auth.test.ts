// Real authenticated loopback HTTP + SQLite identity/session + isolated git worktree.
// No mocked identity, middleware, route, cycle, runner, provider or authority field.
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import express from 'express';import type {Server} from 'node:http';import Database from 'better-sqlite3';
let root:string,repo:string,work:string,base:string,server:Server;
let identity:typeof import('../../services/identityService').identityService;
let service:typeof import('../../services/selfdev/cycleService').selfDevCycleService;
let resetToken:()=>void;
const names=['SELF_REPO_PATH','SELF_WORKTREE_PATH','SELFDEV_DIR','SELF_REPO_UPSTREAM_URL','SILHOUETTE_DB_PATH','SILHOUETTE_API_KEY'];
const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const token='authored-disposable-selfdev-token';const sessions=new Map<string,string>();
beforeAll(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'selfdev-http-auth-'));repo=path.join(root,'repo');work=path.join(root,'work');fs.mkdirSync(repo);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Authored Fixture');
 fs.mkdirSync(path.join(repo,'src'));fs.writeFileSync(path.join(repo,'src/target.ts'),'export const target = 1;\n');git('add','.');git('commit','-qm','authored operator baseline');
 Object.assign(process.env,{SELF_REPO_PATH:repo,SELF_WORKTREE_PATH:work,SELFDEV_DIR:path.join(root,'cycles'),SILHOUETTE_DB_PATH:path.join(root,'identity.sqlite'),SILHOUETTE_API_KEY:token});delete process.env.SELF_REPO_UPSTREAM_URL;
 ({identityService:identity}=await import('../../services/identityService'));await identity.init();
 const db=new Database(process.env.SILHOUETTE_DB_PATH!);
 try{
  for(const role of ['CREATOR','ADMIN','USER','GUEST']){
   const id='fixture-'+role,now=Date.now();db.prepare('INSERT INTO users(id,name,role,created_at,last_login) VALUES(?,?,?,?,?)').run(id,id,role,now,now);
   const device=identity.registerDevice(id,id,'authored device');sessions.set(role,identity.createSession(id,device.id).id);
  }
 }finally{db.close();}
 const auth=await import('../../server/middleware/authMiddleware');resetToken=auth.resetTokenCache;resetToken();
 ({selfDevCycleService:service}=await import('../../services/selfdev/cycleService'));
 const router=(await import('../../server/routes/v1/selfdev.routes')).default;
 const app=express();app.use(express.json());app.use(auth.authMiddleware);app.use('/v1/self/dev',router);
 await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve());});const address=server.address();if(!address||typeof address==='string')throw new Error('missing listener');base=`http://127.0.0.1:${address.port}/v1/self/dev`;
});
afterAll(async()=>{
 const errors:unknown[]=[];
 try{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){errors.push(error);}
 // Drain HTTP before closing the actual fixture-owned SQLite handle. Each
 // independent cleanup still runs when an earlier cleanup reports failure.
 try{(identity as unknown as {db?:Database.Database})?.db?.close();}catch(error){errors.push(error);}
 for(const name of names){try{if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}catch(error){errors.push(error);}}
 try{resetToken?.();}catch(error){errors.push(error);}
 for(const directory of [root,work+'.preserved-candidates']){try{if(directory)fs.rmSync(directory,{recursive:true,force:true});}catch(error){errors.push(error);}}
 if(errors.length)throw new AggregateError(errors,'operator HTTP fixture cleanup failed');
});

async function post(route:string,body:unknown,headers:Record<string,string>={}){
 const res=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:res.status,data:await res.json() as any};
}
for(const role of ['ADMIN','USER','GUEST'])it(`actual ${role} session cannot turn identity or body claims into operator preparation`,async()=>{
 const headers={'x-session-id':sessions.get(role)!};
 const created=await post('/cycles',{issue:'role refusal',scope:['src'],acceptance:{kind:'vitest',target:'tests/absent.test.ts'}},headers);expect(created.status).toBe(200);const id=created.data.cycle.id;
 const attempted=await post(`/cycles/${id}/attempt`,{ops:[{op:'write',path:'src/unapproved.ts',content:'export const claimed=true;',rationale:'fixture'}],source:'operator'},headers);expect(attempted.status).toBe(200);
 const ex=await post(`/cycles/${id}/execute`,{authenticatedOperator:true,user:{id:'claimed',role:'CREATOR'},patch:{source:'operator'}},headers);
 expect(ex.status).toBe(200);expect(ex.data.cycle.state).toBe('ATTEMPTED');expect(ex.data.cycle.lastError).toMatch(/no candidate written/);expect(fs.existsSync(path.join(work,'src/unapproved.ts'))).toBe(false);
 service.abandon(id,'finished denied-role fixture');
});
it('anonymous request cannot invoke execution or grant itself CREATOR',async()=>{
 const result=await post('/cycles/nonexistent/execute',{authenticatedOperator:true,user:{id:'claimed',role:'CREATOR'}});expect(result.status).toBe(401);
});
for(const kind of ['creator-session','master-token'])it(`actual ${kind} prepares isolated old src patch, visible review-only and never PR approved`,async()=>{
 // Only the disposable fixture is reset between positive cases, by its test owner.
 if(fs.existsSync(path.join(work,'.git')))execFileSync('git',['reset','--hard','HEAD'],{cwd:work,stdio:'pipe'});
 const headers=kind==='master-token'?{Authorization:`Bearer ${token}`}:{'x-session-id':sessions.get('CREATOR')!};
 const created=await post('/cycles',{issue:'creator preparation',scope:['src'],acceptance:{kind:'vitest',target:'tests/absent.test.ts'}},headers);expect(created.status).toBe(200);const id=created.data.cycle.id;
 await post(`/cycles/${id}/attempt`,{ops:[{op:'edit',path:'src/target.ts',edits:[{find:'target = 1',replace:'target = 2'}],rationale:'fixture'}]},headers);
 const ex=await post(`/cycles/${id}/execute`,{},headers);expect(ex.status).toBe(200);expect(ex.data.cycle.state).toBe('EXECUTED');expect(ex.data.cycle.lastError).toMatch(/OPERATOR_REVIEW_REQUIRED/);expect(ex.data.cycle.evaluation).toBeUndefined();expect(fs.readFileSync(path.join(work,'src/target.ts'),'utf8')).toContain('target = 2');expect(fs.readFileSync(path.join(repo,'src/target.ts'),'utf8')).toContain('target = 1');
 const list=await fetch(base+'/cycles',{headers}).then(r=>r.json()) as any;expect(list.cycles.find((c:any)=>c.id===id).lastError).toMatch(/OPERATOR_REVIEW_REQUIRED/);
 const pr=await post(`/cycles/${id}/pr`,{approvedBy:'fixture'},headers);expect(pr.data.success).toBe(false);expect(pr.data.error).toMatch(/baseline-bound/);
 service.abandon(id,'finished creator fixture');
});
