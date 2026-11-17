// PROPOSAL, NOT RUN: actual owning entry points with complete installed dependencies.
// Fresh node process only, no cwd changes inside concurrent tests. LocalVideoService
// queue and ToolPersistence DATA_DIR are captured under disposable cwd.
// No monkeypatches, fake provider responses, model calls, server or daemon launch.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
test('actual ToolHandler and COMPOSED ToolExecutor carry real file-read lineage and deny arbitrary plugin before invocation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'authored-tool-boundary-'));
 const previousCwd=process.cwd();
 const names=['SILHOUETTE_INFERENCE_MODE','SILHOUETTE_IDENTITY_DB_PATH','SILHOUETTE_LANCEDB_PATH','SILHOUETTE_QUEUE_DIR','SILHOUETTE_MIGRATIONS_DIR','SILHOUETTE_PROVIDERS','SILHOUETTE_DB_PATH','SILHOUETTE_TOOLS_DB_PATH','SILHOUETTE_FS_READ_ROOTS','SILHOUETTE_FS_WRITE_ROOTS','SILHOUETTE_FS_AUDIT_LOG'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{SILHOUETTE_INFERENCE_MODE:'cloud-only',SILHOUETTE_IDENTITY_DB_PATH:path.join(root,'identity.sqlite'),SILHOUETTE_LANCEDB_PATH:path.join(root,'memory.lancedb'),SILHOUETTE_QUEUE_DIR:path.join(root,'queues'),SILHOUETTE_MIGRATIONS_DIR:path.join(previousCwd,'db/migrations/sqlite'),SILHOUETTE_PROVIDERS:'off',SILHOUETTE_DB_PATH:path.join(root,'system.sqlite'),SILHOUETTE_TOOLS_DB_PATH:path.join(root,'tools.sqlite'),SILHOUETTE_FS_READ_ROOTS:root,SILHOUETTE_FS_WRITE_ROOTS:root,SILHOUETTE_FS_AUDIT_LOG:path.join(root,'audit.jsonl')});
 let persistence,sqlite,nervous;
 try{
  process.chdir(root);
  ({sqliteService:sqlite}=await import('../../services/sqliteService.ts'));
  // OFF initialization has now scrubbed non-allowlisted variables. Restore only
  // trusted disposable fixture settings before import-time queue/path capture.
  const fixtureSettings={SILHOUETTE_FS_READ_ROOTS:root,SILHOUETTE_FS_WRITE_ROOTS:root,SILHOUETTE_FS_AUDIT_LOG:path.join(root,'audit.jsonl'),SILHOUETTE_QUEUE_DIR:path.join(root,'queues')};
  Object.assign(process.env,fixtureSettings);
  assert.equal(process.env.SILHOUETTE_PROVIDERS,'off');
  assert.equal(process.env.SILHOUETTE_INFERENCE_MODE,'cloud-only');
  for(const [key,value] of Object.entries(fixtureSettings))assert.equal(process.env[key],value);

  ({toolPersistence:persistence}=await import('../../services/tools/toolPersistence.ts'));
  ({nervousSystem:nervous}=await import('../../services/connectionNervousSystem.ts'));
  const {createTaskEvidence,currentDataLabels}=await import('../../services/execution/taskEvidence.ts');
  console.info('OWNING_TOOL_IMPORT_BEGIN');
  const {toolHandler}=await import('../../services/tools/toolHandler.ts');
  console.info('OWNING_TOOL_IMPORT_COMPLETE');
  const {toolExecutor}=await import('../../services/tools/toolExecutor.ts');
  const {toolRegistry}=await import('../../services/tools/toolRegistry.ts');
  const {pluginRegistry}=await import('../../services/plugins/pluginRegistry.ts');
  for(const [key,value] of Object.entries(fixtureSettings))assert.equal(process.env[key],value);
  const note=path.join(root,'authored-note.txt');fs.writeFileSync(note,'authored private source fixture');
  let calls=0;const plugin={id:'authored-boundary-plugin',name:'Authored Fixture',version:'1',author:'fixture',description:'local fixture',tools:[{name:'authored_sink',effects:'external_comms',description:'must not execute after private source',parameters:{type:'object',properties:{}},handler:async()=>{calls++;return {authored:true};}}]};
  pluginRegistry.register(plugin);
  const tool=(name,handler)=>({id:name,name,description:'authored boundary fixture',parameters:{type:'object',properties:{}},handler,category:'UTILITY',effects:'read_only',createdBy:'USER',enabled:true,usageCount:0,successCount:0,createdAt:Date.now(),version:'1'});
  toolRegistry.registerTool(tool('read_file',{type:'BUILTIN',handlerName:'read_file'}));
  toolRegistry.registerTool(tool('authored_sink',{type:'BUILTIN',handlerName:'PLUGIN:authored-boundary-plugin:authored_sink'}));
  toolRegistry.registerTool(tool('authored_composed',{type:'COMPOSED',steps:[{toolName:'read_file',inputMapping:{path:'{{path}}'},outputAs:'private'},{toolName:'authored_sink',inputMapping:{body:'{{$last}}'}}]}));
  await createTaskEvidence('owning-direct').run(async()=>{
   assert.equal((await toolHandler.handleFunctionCall('read_file',{path:note})).content,'authored private source fixture');
   assert(currentDataLabels().includes('USER_PRIVATE'));
   await assert.rejects(toolHandler.handleFunctionCall('authored_sink',{body:'authored summary'}),/DATA_FLOW_DENIED/);
  });
  const composition=createTaskEvidence('owning-composed');
  await assert.rejects(composition.run(()=>toolExecutor.execute('authored_composed',{path:note})),/DATA_FLOW_DENIED/);
  assert(composition.snapshot().labels.includes('USER_PRIVATE'));assert.equal(calls,0);
 }finally{
  console.info('OWNING_TOOL_CLEANUP_BEGIN',JSON.stringify(process.getActiveResourcesInfo()));
  const cleanup=[];
  for(const close of [()=>nervous?.stop(),()=>persistence?.close(),()=>sqlite?.close(),()=>process.chdir(previousCwd),()=>{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}},()=>fs.rmSync(root,{recursive:true,force:true})]){
   try{close();}catch(error){cleanup.push(error);}
  }
  console.info('OWNING_TOOL_CLEANUP_END',JSON.stringify(process.getActiveResourcesInfo()));
  if(cleanup.length)throw new AggregateError(cleanup,'authored tool fixture cleanup failed');
 }
});
