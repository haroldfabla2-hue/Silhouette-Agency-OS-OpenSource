/** Read-only rollout preflight. Never imports application services or rewrites a
 * store. Usage: node --import tsx scripts/check-continuity-stores.ts /path/to/data
 * Output contains record positions/reasons, not private payloads or agent IDs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.argv[2]||'data');
const report:{rootExists:boolean;stores:Record<string,unknown>;blockers:string[]}={rootExists:fs.existsSync(root),stores:{},blockers:[]};
if(!report.rootExists)report.blockers.push('Data directory absent; source path must be confirmed');
function read(name:string){
 const file=path.join(root,name);
 if(!fs.existsSync(file))return null;
 if(!fs.lstatSync(file).isFile()){report.blockers.push(`${name}: not a regular file`);return null;}
 const bytes=fs.readFileSync(file);
 report.stores[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 try{const parsed=JSON.parse(bytes.toString('utf8'));if(parsed===null)report.blockers.push(`${name}: null store is not a valid snapshot`);return parsed;}
 catch{report.blockers.push(`${name}: unreadable JSON, preserve original`);return null;}
}
const wal=read('wal/memory_wal.json');
if(wal!==null){
 if(!Array.isArray(wal))report.blockers.push('WAL: expected record array');
 else{
  const seen=new Set<string>();const agents=path.join(root,'agents');
  wal.forEach((e:any,index:number)=>{
   const reasons:string[]=[];
   if(!e||typeof e.id!=='string'||!e.id||seen.has(e.id))reasons.push('missing/duplicate record ID');
   if(e?.id)seen.add(e.id);
   const agent=typeof e?.agentId==='string'?path.resolve(agents,e.agentId):agents;
   if(!agent.startsWith(agents+path.sep))reasons.push('legacy agent ID fails lexical containment');
   // Observe existing path components only. Refuse to certify symlink paths.
   if(agent.startsWith(agents+path.sep)){
    const segments=path.relative(agents,agent).split(path.sep);let cursor=agents;
    for(const segment of ['',...segments]){
     if(segment)cursor=path.join(cursor,segment);
     if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink()){reasons.push('agent directory crosses a symlink');break;}
    }
   }
   if(!Number.isFinite(e?.timestamp)||e.timestamp<=0)reasons.push('invalid timestamp');
   if(!['PENDING','COMMITTED','INTERRUPTED'].includes(e?.status))reasons.push('unrecognized record status');
   if(!['MESSAGE_RECEIVED','TASK_STARTED','TASK_COMPLETED','SESSION_CREATED','CHECKPOINT'].includes(e?.type))reasons.push('unrecognized event type');
   if(!e?.data||typeof e.data!=='object'||Array.isArray(e.data))reasons.push('invalid payload container');
   if(reasons.length)report.blockers.push(`WAL record ${index}: ${reasons.join('; ')}`);
  });
  report.stores.walSummary={records:wal.length,unfinished:wal.filter((e:any)=>e?.status!=='COMMITTED').length,
   olderHandlerSafe:!wal.some((e:any)=>e?.status==='INTERRUPTED')};
 }
}
const curiosity=read('curiosity_gaps.json');
if(curiosity!==null){
 if(!curiosity||typeof curiosity!=='object'||Array.isArray(curiosity)){report.blockers.push('Curiosity: expected snapshot object');}
 else {
 if(!Array.isArray(curiosity.gaps))report.blockers.push('Curiosity: gaps array unavailable');
 else curiosity.gaps.forEach((g:any,index:number)=>{
  if(!g||typeof g.topic!=='string'||typeof g.question!=='string'||!Number.isFinite(g.priority)
   ||!Number.isFinite(g.detectedAt)||!Number.isFinite(g.attempts)||!['PENDING','RESEARCHING','RESOLVED','FAILED'].includes(g.status))
   report.blockers.push(`Curiosity record ${index}: incompatible gap fields`);
 });
 if(curiosity.topics!==undefined&&(!curiosity.topics||typeof curiosity.topics!=='object'||Array.isArray(curiosity.topics)))report.blockers.push('Curiosity: malformed topic counters');
 if(curiosity.topics && typeof curiosity.topics==='object' && !Array.isArray(curiosity.topics) && !Object.values(curiosity.topics).every((t:any)=>t && typeof t.topic==='string' && Number.isFinite(t.count) && Number.isFinite(t.lastAccessed) && typeof t.hasDepth==='boolean')) report.blockers.push('Curiosity: incompatible topic fields');
 report.stores.curiosityShape={legacyMissingTopics:curiosity.topics===undefined};
 }
}
console.log(JSON.stringify({...report,preflightPassed:report.blockers.length===0,scope:'WAL record/lexical path and curiosity shape only; not full rollout approval',productionNotInspected:true},null,2));
process.exitCode=report.blockers.length?2:0;
