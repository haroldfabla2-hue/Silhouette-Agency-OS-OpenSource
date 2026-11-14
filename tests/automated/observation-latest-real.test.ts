import { createOwnedLanceDbService } from '../../services/lancedbService';
import { admitLanceInstance } from '../../services/lifecycle/preparationBindings';
/** Real LanceDB storage/reopen read, no model/provider or mocks. This verifies
 * this read primitive, not a whole dashboard startup or provider trace. */
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {connect} from '@lancedb/lancedb';
import {lancedbService as lancedbDefault,LanceDbService} from '../../services/lancedbService';
import {MemoryTier} from '../../types';
describe('observation-only latest stored tag',()=>{
 it('does not initialize absent storage and recovers latest without token-budget truncation',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'observation-real-'));
  const location=path.join(dir,'db.lancedb');
  try{
   const absent=createOwnedLanceDbService(location, admitLanceInstance());
   expect(await absent.getLatestObservation('epiphany')).toBeNull();expect(existsSync(location)).toBe(false);
   const writer=createOwnedLanceDbService(location, admitLanceInstance());
   await writer.store({id:'older',content:'EPIPHANY older',tags:['epiphany'],tier:MemoryTier.WORKING,timestamp:1} as any);
   await writer.store({id:'newest',content:'EPIPHANY '+('large thought '.repeat(2000)),tags:['epiphany'],tier:MemoryTier.WORKING,timestamp:3} as any);
   await writer.store({id:'unrelated',content:'other',tags:['other'],tier:MemoryTier.WORKING,timestamp:4} as any);
   const reader=createOwnedLanceDbService(location, admitLanceInstance());
   const newest=await reader.getLatestObservation('epiphany');
   expect(newest?.id).toBe('newest');expect(newest!.content.length).toBeGreaterThan(20000);
   expect((reader as any).initialized).toBe(false);expect((reader as any).ftsReady.size).toBe(0);
   expect(await reader.getLatestObservation('missing')).toBeNull();
   const cached=(reader as any).observationCache.values().next().value;
   expect(cached.node).toBeNull();
   expect(await reader.getLatestObservation('missing')).toBeNull();
   expect((reader as any).observationCache.values().next().value).toBe(cached);
   await writer.store({id:'new-tag',content:'new',tags:['missing'],tier:MemoryTier.WORKING,timestamp:5} as any);
   expect((await reader.getLatestObservation('missing'))?.id).toBe('new-tag');
   expect((await reader.getLatestObservation('epiphany',['newest']))?.id).toBe('older');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});

describe('bounded canonical observation history',()=>{
 it('merges legacy and v2 before ordering, with tag removal and exclusions respected',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'history-real-'));
  const location=path.join(dir,'db.lancedb');
  const node=(id:string,timestamp:number,tags:string[])=>({id,timestamp,tags,content:id,tier:MemoryTier.LONG});
  const row=(n:any)=>({id:n.id,json_data:JSON.stringify(n)});
  try{
   const db=await connect(location);
   await db.createTable('memory',[row(node('shadow',99,['EXPERIENCE','FAILURE'])),row(node('old',1,['EXPERIENCE','FAILURE']))]);
   await db.createTable('memory_records_v2',[row(node('shadow',100,['EXPERIENCE','SUCCESS'])),row(node('new',3,['EXPERIENCE','FAILURE'])),row(node('unrelated',4,['FAILURE']))]);
   const reader=createOwnedLanceDbService(location, admitLanceInstance());
   expect((await reader.getRecentObservations(['EXPERIENCE','FAILURE'],2)).map(n=>n.id)).toEqual(['new','old']);
   expect((await reader.getRecentObservations(['EXPERIENCE','FAILURE'],1,['new'])).map(n=>n.id)).toEqual(['old']);
   expect((reader as any).initialized).toBe(false);
   expect((reader as any).ftsReady.size).toBe(0);
   await expect(reader.getRecentObservations('EXPERIENCE',0)).rejects.toThrow(/bounded/);
   await expect(reader.getRecentObservations([],1)).rejects.toThrow(/tags/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('does not turn corrupt durable records into an empty successful window',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'history-corrupt-'));
  const location=path.join(dir,'db.lancedb');
  try{
   const db=await connect(location);
   await db.createTable('memory_records_v2',[{id:'corrupt',json_data:'{broken'}]);
   const reader=createOwnedLanceDbService(location, admitLanceInstance());
   await expect(reader.getRecentObservations('EXPERIENCE',100)).rejects.toThrow();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});

describe('actual cold narrator observation path',()=>{
 // Importing narrator starts unrelated consciousness initialization. Keep
 // this integration test disabled until dependency boot is explicitly isolated.
 it.skip('reads stored epiphany without semantic retrieval or memory mutation',async()=>{
  expect(process.env.SILHOUETTE_LANCEDB_PATH?.startsWith(tmpdir()+path.sep)).toBe(true);
  expect((lancedbDefault as any).databasePath).toBe(process.env.SILHOUETTE_LANCEDB_PATH);
  const {continuum}=await import('../../services/continuumMemory');
  const {thoughtNarrator}=await import('../../services/cognitive/thoughtNarrator');
  const {lancedbService}=await import('../../services/lancedbService');
  const id=`cold-observation-${Date.now()}`;
  const node={id,content:'EPIPHANY observational fixture',tags:['epiphany'],tier:MemoryTier.WORKING,timestamp:Date.now(),accessCount:7,lastAccess:1};
  const location=process.env.SILHOUETTE_LANCEDB_PATH!;
  try{
  await lancedbService.store(node as any);
  (thoughtNarrator as any).lastNarrative=null;
  const result=await thoughtNarrator.getLatestNarrative();
  expect(result?.text).toBe(node.content);expect(result?.cycleId).toBe(`restored-${id}`);
  const after=await lancedbService.getNodeById(id);expect(after?.accessCount).toBe(7);expect(after?.lastAccess).toBe(1);
  // Ordinary retrieval implementation remains present and independent.
  expect(typeof continuum.retrieve).toBe('function');
  }finally{rmSync(location,{recursive:true,force:true});}
  expect(existsSync(location)).toBe(false);
 });
});
