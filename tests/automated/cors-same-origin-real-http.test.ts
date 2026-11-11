/** Actual HTTP requests through the production CORS policy and Express cors.
 * No stubs, browser-header rewrites or fake success responses from services.
 */
import {describe,it,expect} from 'vitest';
import express from 'express';
import cors from 'cors';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {isAllowedRequestOrigin} from '../../server/security/corsPolicy';

describe('same-origin app assets retain authentication and cross-origin boundary',()=>{
 it('allows its exact origin and explicit configured origin, denies unrelated origins over real HTTP',async()=>{
  const app=express();
  app.use(cors<express.Request>((req,cb)=>cb(null,{origin:(origin,done)=>isAllowedRequestOrigin(origin,req.protocol,req.get('host'),['https://configured.example.invalid'])?done(null,true):done(new Error('origin denied')),credentials:true})));
  app.get('/asset', (req,res)=>req.headers.authorization==='Bearer local-test-token'?res.json({ok:true}):res.sendStatus(401));
  app.use((_err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.sendStatus(403);});
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
   for(const origin of [url,'https://configured.example.invalid']){
    const r=await fetch(url+'/asset',{headers:{origin,authorization:'Bearer local-test-token'}});expect(r.status).toBe(200);expect(r.headers.get('access-control-allow-origin')).toBe(origin);
   }
   for(const origin of ['https://foreign.example.invalid',url+'.evil.invalid','http://localhost:5174','null',url.replace('http:','https:')]){
    const r=await fetch(url+'/asset',{headers:{origin,authorization:'Bearer local-test-token'}});expect(r.status).toBe(403);
   }
   expect((await fetch(url+'/asset',{headers:{origin:url}})).status).toBe(401);
   expect(isAllowedRequestOrigin('https://same.example.invalid','https','same.example.invalid',[])).toBe(true);
   expect(isAllowedRequestOrigin('https://same.example.invalid:444','https','same.example.invalid',[])).toBe(false);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 });
});
