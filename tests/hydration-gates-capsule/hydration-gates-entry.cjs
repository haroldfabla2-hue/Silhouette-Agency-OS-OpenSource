'use strict';
// PROPOSED hydration-gates capsule entry v3; reviewed, NOT executed in CI.
// Real modules only, compiled into /app. No doubles: console wrappers are
// capture-only observers writing a BOUNDED structured journal (byte-capped AND
// line-capped; either overflow is FAIL, never silent truncation); nothing is
// forwarded, so stdout carries only protocol lines (HGRECEIPT / HGJOURNAL) and
// stderr stays EMPTY. stdout outside the protocol fails the supervisor. The UI
// listener is a real subscription.
//
// Startup is settled BEFORE any case window: a real pre-existing agent row is
// persisted BEFORE importing the orchestrator, so initializeSwarm takes its
// 'existing' branch (no fire-and-forget genesis), and the entry awaits the
// REAL startupSettlement() receipt and asserts branch/outcome/fallback. The
// settlement is a limited measurement; its unobservedFailureDomains are
// reported verbatim, never treated as universal readiness.
//
// Genuine failure production, two real ways: target missing from persistence
// ('agent-missing' -> hydrateAgent false), and admission genuinely denied by
// the REAL arbiter after its own stopProcessingTimer() (process-permanent;
// the denial cases therefore run last and in sequence).
//
// NO LLM path is reached by construction: the qa-01 case rejects before
// diagnosis; the expansion cases never enter remediation. The research-01 and
// dev-01 gates sit behind a successful LLM diagnosis and are NOT covered
// here; they remain source-audited only. No rollback of pre-hydration
// persistence is claimed anywhere: the birth case PINS the current
// not-reverted leader row as a fact, it does not endorse it.
//
// Oracles: primary = state (activeActors snapshots, squad registry, persisted
// rows); windowed journal/UI capture is partial observability per case, never
// an absolute proof a method never ran. Expected warn/error lines are matched
// per case with FULL correlation (stream + every required substring incl. the
// case's agent id and the exact error token, each exactly once); every other
// warn/error in ANY phase is FAIL.
//
// NATURAL TERMINATION rests on real lifecycle stops, each exercised per owner
// with its real API and its failure preserved (no stop failure skips the
// remaining owners): arbiter queue (stopProcessingTimer, zero-field receipt),
// powerManager throttle (stopThrottleTimer), narrative batch
// (preserveAndStopBatchProcessor, awaited; error/boundExhausted/remainingItems
// checked, pending debt preserved not dropped), neuroLink discovery
// (stopDiscovery: TIMER-ONLY scope, receipt asserts intervalWasArmed and
// nodesRegistered===0 in this fixture), continuousMemory (shutdown() called;
// closed flag observed afterwards - call-return alone is not claimed as
// proof), nervousSystem.stop() (no receipt API; interval never armed here).
// No process.exit on the success path; failures set process.exitCode and the
// process still ends when the loop drains. Exhaustion of the supervisor's
// bounded deadline is FAIL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=`hg_${Date.now()}_`;
const receipt=(row)=>{process.stdout.write('HGRECEIPT '+JSON.stringify(row)+'\n');};
// --- Bounded structured journal (capture-only; ANY overflow is FAIL) ---
const JOURNAL_MAX_BYTES=40960,LINE_MAX=400;
const journal=[];let journalBytes=0,journalOverflow=false,lineOverflow=false,seq=0,phase='pre-import';
const jrecord=(stream,text)=>{
 let line=text;
 if(line.length>LINE_MAX){lineOverflow=true;line=line.slice(0,LINE_MAX)+'[TRUNCATED-FAIL]';}
 const b=Buffer.byteLength(line)+24;
 if(journalBytes+b>JOURNAL_MAX_BYTES){journalOverflow=true;return;}
 journalBytes+=b;journal.push({seq:seq++,phase,stream,line});
};
const origLog=console.log,origErr=console.error,origWarn=console.warn;
const fmt=a=>a.map(String).join(' ');
console.log=(...a)=>jrecord('log',fmt(a));
console.warn=(...a)=>jrecord('warn',fmt(a));
console.error=(...a)=>jrecord('error',fmt(a));
const jwindow=startSeq=>journal.filter(e=>e.seq>=startSeq);
const jtext=(startSeq,stream)=>jwindow(startSeq).filter(e=>!stream||e.stream===stream).map(e=>e.line).join('\n');
// Expected warn/error lines per case window: stream + EVERY required
// substring (full correlation: case id + exact error token), exactly once.
const expectWindow=(startSeq,expected)=>{
 const lines=jwindow(startSeq).filter(e=>e.stream==='warn'||e.stream==='error');
 const remaining=[...lines];
 for(const exp of expected){
  const idx=remaining.findIndex(e=>e.stream===exp.stream&&exp.allOf.every(s=>e.line.includes(s)));
  assert.ok(idx>=0,`expected ${exp.stream} line missing in window: ${JSON.stringify(exp.allOf)}`);
  remaining[idx].consumed=true;remaining.splice(idx,1);
 }
 assert.deepEqual(remaining.map(e=>e.stream+': '+e.line),[],`unexpected warn/error lines in window: ${JSON.stringify(remaining.map(e=>e.line))}`);
};
const assertNoStrayWarnError=()=>{
 const strays=journal.filter(e=>(e.stream==='warn'||e.stream==='error')&&!e.consumed);
 assert.deepEqual(strays.map(e=>e.phase+':'+e.stream+':'+e.line),[],`stray warn/error: ${JSON.stringify(strays.slice(0,3).map(e=>e.phase+':'+e.line))}`);
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const waitFor=async(pred,ms=8000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(pred())return true;await sleep(25);}return false;};
const UI_MAX=200;const uiEvents=[];let uiOverflow=false;
let failure,caseError,accountingError;const teardownFailures=[];
let arbiterStopReceipt,settlementReceipt,unsubscribeUi;
const imp={};const stops={};
(async()=>{
 try{
  // --- pre-import environment assertions. Single-UID-map model: bwrap
  // unprivileged maps exactly one uid (0 inside the namespace); the
  // irreversible drop is the capability bounding-set purge + no_new_privs
  // BEFORE the product runs, not a uid transition. ---
  assert.equal(process.getuid(),0);assert.equal(process.getgid(),0);
  const status=fs.readFileSync('/proc/self/status','utf8');
  for(const cap of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])assert.match(status,new RegExp('^'+cap+':\\s+0+$','m'));
  assert.match(status,/^NoNewPrivs:\s+1$/m);
  assert.equal(process.env.SILHOUETTE_PROVIDERS,'off');assert.equal(process.env.SILHOUETTE_BOOT_MODE,'normal');
  assert(!process.env.REDIS_URL);assert(!process.env.USE_REDIS||process.env.USE_REDIS==='false');
  // --- fixture phase: persist a REAL pre-existing agent BEFORE orchestrator ---
  phase='fixture';
  imp.sqliteService=(await import('./services/sqliteService.js')).sqliteService;
  imp.agentPersistence=(await import('./services/agentPersistence.js')).agentPersistence;
  imp.agentFileSystem=(await import('./services/agents/agentFileSystem.js')).agentFileSystem;
  const types=await import('./types.js');
  const {SystemProtocol,AgentStatus,AgentTier,AgentRoleType}=types;
  const cwd=process.cwd();
  assert.ok(imp.agentFileSystem.getAgentDir('probe').startsWith(cwd+path.sep),`SETUP: agent fs root outside fixture cwd: ${imp.agentFileSystem.getAgentDir('probe')}`);
  assert.ok(process.env.SILHOUETTE_DB_PATH&&path.resolve(process.env.SILHOUETTE_DB_PATH).startsWith(cwd+path.sep),`SETUP: SILHOUETTE_DB_PATH outside fixture cwd: ${process.env.SILHOUETTE_DB_PATH}`);
  const probeAgent=(id,name,category,role)=>({id,name,teamId:`${P}team`,category,roleType:AgentRoleType&&AgentRoleType.WORKER||'WORKER',role,status:AgentStatus.IDLE,enabled:true,memoryLocation:'RAM',cpuUsage:1,ramUsage:1,lastActive:Date.now(),tier:AgentTier.SPECIALIST,preferredMemory:'RAM',capabilities:[],systemInstruction:`${P} probe agent`});
  imp.agentPersistence.saveAgent(probeAgent('fixture-preexisting-01','Fixture Preexisting','FIXTURECAT','fixture preexisting role'));
  assert.ok(imp.agentPersistence.getAllAgentIds().length>=1,'SETUP: fixture row not persisted');
  // --- import-startup phase: existing branch + settled startup ---
  phase='import-startup';
  imp.systemBus=(await import('./services/systemBus.js')).systemBus;
  imp.resourceArbiter=(await import('./services/resourceArbiter.js')).resourceArbiter;
  imp.orchestrator=(await import('./services/orchestrator.js')).orchestrator;
  imp.remediation=(await import('./services/remediationService.js')).remediation;
  imp.neuroLink=(await import('./services/neuroLinkService.js')).neuroLink;
  imp.narrative=(await import('./services/narrativeService.js')).narrative;
  imp.powerManager=(await import('./services/powerManager.js')).powerManager;
  imp.nervousSystem=(await import('./services/connectionNervousSystem.js')).nervousSystem;
  imp.continuousMemory=(await import('./services/memory/continuousMemory.js')).continuousMemory;
  const orch=imp.orchestrator;
  settlementReceipt=await orch.startupSettlement();
  assert.equal(settlementReceipt.branch,'existing',`startup branch: ${settlementReceipt.branch}`);
  assert.equal(settlementReceipt.constructionCompleted,true,'construction not completed');
  assert.equal(settlementReceipt.fallbackUsed,false,'startup fallback used');
  assert.equal(settlementReceipt.outcome,'ok',`startup outcome: ${settlementReceipt.outcome}; failures=${JSON.stringify(settlementReceipt.startupFailures)}`);
  assert.deepEqual([...settlementReceipt.startupFailures],[],'startup failures present');
  assert.ok(!imp.agentPersistence.getAllAgentIds().includes('qa-01'),'SETUP: genesis repopulated qa-01 despite existing branch');
  assertNoStrayWarnError();
  receipt({check:'startup-settlement',ok:true,branch:settlementReceipt.branch,outcome:settlementReceipt.outcome,tailRegistrations:settlementReceipt.orchestrationTailRegistrations,unobservedFailureDomains:[...settlementReceipt.unobservedFailureDomains],scope:'settlement-is-limited-measurement-not-readiness'});
  // UI subscription AFTER startup settlement: case windows observe case noise only.
  unsubscribeUi=imp.systemBus.subscribe(SystemProtocol.UI_REFRESH,(event)=>{if(uiEvents.length<UI_MAX)uiEvents.push(event);else uiOverflow=true;});
  try{
   // CASE 1: qa-01 missing -> mobilization rejects at the exact gate, before
   // diagnosis, research, plan or fix markers; actor set unchanged.
   phase='case1';
   if(orch.activeActors.has('qa-01'))orch.dehydrateAgent('qa-01');
   imp.sqliteService.deleteAgent('qa-01');
   assert.equal(imp.agentPersistence.loadAgent('qa-01'),null,'SETUP: qa-01 row present');
   assert.equal(orch.activeActors.has('qa-01'),false,'SETUP: qa-01 actor active');
   const actorsBefore=[...orch.activeActors.keys()].sort();
   const j1=seq;const uiStart1=uiEvents.length;
   await assert.rejects(imp.remediation.mobilizeSquad(`${P}targetA`,[`${P} signature A`]),/AGENT_REQUIRED_BUT_NOT_HYDRATED:qa-01/);
   const text1=jtext(j1,'log');
   assert.ok(text1.includes('MOBILIZING SQUADS'),'mobilization marker missing');
   for(const marker of ['🩺 Diagnosis:','🔬 Consulting Research Squad','🏗️ Dev Squad Planning Phase','🛠️ FIX SQUAD DEPLOYED'])
    assert.ok(!text1.includes(marker),`marker after gate (partial log oracle): ${marker}`);
   assert.deepEqual([...orch.activeActors.keys()].sort(),actorsBefore,'actor set changed by refused mobilization');
   assert.ok(!uiEvents.slice(uiStart1).some(e=>String(e&&e.payload&&e.payload.message||'').includes('Diagnosis')),'UI diagnosis message in refused mobilization window');
   expectWindow(j1,[{stream:'warn',allOf:['[ORCHESTRATOR] Agent hydration target missing:','qa-01']}]);
   receipt({check:'qa-hydration-gate',ok:true,oracle:'state-primary, windowed-journal-partial'});
   // Denial cases: genuinely stop the real arbiter (process-permanent).
   phase='case2';
   arbiterStopReceipt=imp.resourceArbiter.stopProcessingTimer();
   assert.equal(typeof arbiterStopReceipt.intervalWasArmed,'boolean','arbiter stop receipt shape');
   assert.equal(arbiterStopReceipt.pendingAdmissions,0,`arbiter pending admissions nonzero: ${arbiterStopReceipt.pendingAdmissions}`);
   assert.equal(arbiterStopReceipt.activeAdmissions,0,`arbiter active admissions nonzero: ${arbiterStopReceipt.activeAdmissions}`);
   assert.equal(arbiterStopReceipt.activeQueueRuns,0,`arbiter active queue runs nonzero: ${arbiterStopReceipt.activeQueueRuns}`);
   // CASE 2: expansion with REUSABLE leader, admission denied ->
   // REUSED_AGENT_NOT_HYDRATED; a REAL pre-existing inactive squad fixture
   // with matching name+category must STAY inactive; no success UI.
   const name2=`${P}Reuse Squad`,category2='PROBECAT',role2='probe reusable role';
   imp.agentPersistence.saveAgent(probeAgent(`${P}reused`,'Probe Reusable',category2,role2));
   assert.ok(imp.agentPersistence.loadAgent(`${P}reused`),'SETUP: reusable row not persisted');
   assert.equal(orch.activeActors.has(`${P}reused`),false,'SETUP: reusable already active');
   orch.squads.push({id:`${P}sq`,name:name2.toUpperCase(),leaderId:`${P}reused`,members:[`${P}reused`],category:category2,active:false,port:0});
   assert.ok(orch.getSquads().some(s=>s.name===name2.toUpperCase()&&s.active===false),'SETUP: inactive squad fixture not registered');
   const j2=seq;const uiStart2=uiEvents.length;
   imp.systemBus.emit(SystemProtocol.SQUAD_EXPANSION,{name:name2,category:category2,role:role2,reason:`${P} probe`});
   assert.ok(await waitFor(()=>jtext(j2,'error').includes('REUSED_AGENT_NOT_HYDRATED')),'REUSED_AGENT_NOT_HYDRATED not observed in case window');
   const squad2=orch.getSquads().find(s=>s.name===name2.toUpperCase());
   assert.equal(squad2&&squad2.active,false,'inactive squad fixture reactivated by failed expansion');
   assert.equal(orch.activeActors.has(`${P}reused`),false,'reusable leader activated by failed expansion');
   assert.ok(!uiEvents.slice(uiStart2).some(e=>{const m=String(e&&e.payload&&e.payload.message||'');return m.includes(name2)||m.includes('reactivated with existing agent');}),'success UI emitted in reuse window');
   expectWindow(j2,[
    {stream:'warn',allOf:['[ORCHESTRATOR] Agent hydration not admitted:',`${P}reused`]},
    {stream:'error',allOf:['[ORCHESTRATOR] Squad expansion hydration failed; activation not confirmed:','REUSED_AGENT_NOT_HYDRATED']},
   ]);
   receipt({check:'expansion-reuse-hydration-gate',ok:true});
   // CASE 3: expansion with NEW birth, admission denied ->
   // NEW_LEADER_NOT_HYDRATED; no squad registered; no success UI (generic
   // 'Swarm Topology Updated' included); the leader row persisted BEFORE
   // hydration is NOT reverted - pinned as current behavior, not endorsed.
   phase='case3';
   const name3=`${P}Fresh Squad`;
   const j3=seq;const uiStart3=uiEvents.length;
   imp.systemBus.emit(SystemProtocol.SQUAD_EXPANSION,{name:name3,category:'PROBECAT2',role:'probe fresh role',reason:`${P} probe`});
   assert.ok(await waitFor(()=>jtext(j3,'error').includes('NEW_LEADER_NOT_HYDRATED')),'NEW_LEADER_NOT_HYDRATED not observed in case window');
   assert.ok(!orch.getSquads().some(s=>s.name===name3.toUpperCase()),'squad registered by failed birth');
   assert.ok(!uiEvents.slice(uiStart3).some(e=>{const m=String(e&&e.payload&&e.payload.message||'');return m.includes(name3)||m.includes('Swarm Topology Updated');}),'success UI emitted in birth window');
   const leaderRow=imp.sqliteService.getAllAgents().find(a=>a.name===`${name3} Lead`);
   assert.ok(leaderRow,'leader row missing: current no-rollback behavior changed (fact pin, not endorsement)');
   assert.equal(orch.activeActors.has(leaderRow.id),false,'born leader activated by failed expansion');
   expectWindow(j3,[
    {stream:'warn',allOf:['[ORCHESTRATOR] Agent hydration not admitted:',leaderRow.id]},
    {stream:'error',allOf:['[ORCHESTRATOR] Squad expansion hydration failed; activation not confirmed:','NEW_LEADER_NOT_HYDRATED']},
   ]);
   receipt({check:'expansion-birth-hydration-gate',ok:true,persistedLeaderNotReverted:true});
  }catch(e){caseError=e;}
 }catch(e){failure=e;}
 // --- Unconditional teardown: every owner that ACTUALLY imported is stopped
 // through its real API; a stop failure is collected (T pattern), never
 // skips the remaining owners. Coverage is bounded by `imp`: a mid-graph
 // import failure leaves modules that were never imported unstopped — there
 // is nothing to stop there, but 'every owner stopped' is then NOT claimed;
 // any teardown failure fails the run via TEARDOWN. ---
 phase='cleanup';
 const T=(label,fn)=>Promise.resolve().then(fn).catch(e=>{teardownFailures.push(label+': '+String(e&&e.message?e.message:e));});
 if(typeof unsubscribeUi==='function')await T('unsubscribe',()=>unsubscribeUi());
 if(imp.narrative)await T('narrative.preserveAndStop',async()=>{
  const r=await imp.narrative.preserveAndStopBatchProcessor();
  assert.equal(r.intervalWasArmed,true,'narrative batch interval was not armed');
  assert.equal(r.error,null,`narrative preserve error: ${r.error}`);
  assert.equal(r.boundExhausted,false,'narrative preserve bound exhausted (work still owned)');
  assert.equal(r.remainingItems,0,`narrative remaining items after preserve: ${r.remainingItems}`);
  // Settled-path receipt fields (verified in narrativeService source): with
  // this empty fixture the measured expectations are all zero/false. This is
  // the measured scope, NOT a full drain claim for arbitrary workloads.
  assert.equal(r.pendingPreserved,0,`narrative pending preserved nonzero on empty fixture: ${r.pendingPreserved}`);
  assert.ok(!r.deferredUnacknowledged,'narrative deferred unacknowledged on empty fixture');
  assert.equal(r.refusedLate,0,`narrative refused-late nonzero: ${r.refusedLate}`);
  assert.equal(r.admissionFailures,0,`narrative admission failures nonzero: ${r.admissionFailures}`);
  assert.ok(!r.subscriptionFailed,`narrative subscription failed: ${r.subscriptionFailed}`);
  stops.narrative=r;
 });
 if(imp.powerManager)await T('powerManager.stopThrottleTimer',()=>{
  stops.powerManager=imp.powerManager.stopThrottleTimer();
  assert.equal(stops.powerManager.intervalWasArmed,true,'powerManager throttle interval was not armed');
 });
 if(imp.neuroLink)await T('neuroLink.stopDiscovery',()=>{
  stops.neuroLink=imp.neuroLink.stopDiscovery();
  assert.equal(stops.neuroLink.intervalWasArmed,true,'neuroLink discovery interval was not armed');
  assert.equal(stops.neuroLink.nodesRegistered,0,`neuroLink nodes present: timer-only scope requires empty set, got ${stops.neuroLink.nodesRegistered}`);
 });
 if(imp.nervousSystem)await T('nervousSystem.stop',()=>{imp.nervousSystem.stop();stops.nervousSystem='stop-returned (no receipt API; interval never armed on this path)';});
 if(imp.continuousMemory)await T('continuousMemory.shutdown',()=>{
  imp.continuousMemory.shutdown();
  // Effect observation: the instance reports itself closed afterwards.
  // Call-return alone is NOT claimed as proof of persistence.
  assert.equal(imp.continuousMemory.closed,true,'continuousMemory not closed after shutdown');
  stops.continuousMemory='shutdown-returned; closed-observed';
 });
 if(imp.sqliteService)await T('sqliteService.close',()=>{imp.sqliteService.close();assert.equal(imp.sqliteService.db.open,false);});
 if(imp.resourceArbiter)await T('resourceArbiter.stopProcessingTimer',()=>{
  // The arbiter timer is process-permanent once armed: always call the real
  // stop when the module imported. Reuse the case-2 receipt when the denial
  // cases already stopped it; otherwise stop it here. Queue-field zeroes are
  // asserted only on the case-2 path (a mid-import failure can leave queued
  // work; this stop is best-effort there, and the run fails anyway).
  const r=arbiterStopReceipt||imp.resourceArbiter.stopProcessingTimer();
  assert.equal(typeof r.intervalWasArmed,'boolean','arbiter stop receipt shape');
  stops.arbiter=r;
 });
 try{
  assert.equal(journalOverflow,false,'journal byte cap exceeded: evidence would be incomplete');
  assert.equal(lineOverflow,false,'journal line cap exceeded: a line was truncated (marked TRUNCATED-FAIL)');
  assert.equal(uiOverflow,false,'UI event cap exceeded: evidence would be incomplete');
  assertNoStrayWarnError();
 }catch(e){accountingError=e;}
 console.log=origLog;console.error=origErr;console.warn=origWarn;
 for(const e of journal)process.stdout.write('HGJOURNAL '+JSON.stringify(e)+'\n');
 const finalFailure=failure||caseError||(teardownFailures.length?new Error('TEARDOWN: '+teardownFailures.join(' | ')):null)||accountingError;
 if(finalFailure){
  receipt({check:'hydration-gates-capsule',ok:false,phase,error:String(finalFailure&&finalFailure.message?finalFailure.message:finalFailure)});
  process.exitCode=1;
 }else{
  receipt({check:'hydration-gates-capsule',ok:true,researchDevGates:'not-covered-require-real-llm',journalEntries:journal.length,journalBytes,stops});
 }
})().catch(e=>{console.log=origLog;console.error=origErr;console.warn=origWarn;for(const x of journal)process.stdout.write('HGJOURNAL '+JSON.stringify(x)+'\n');receipt({check:'hydration-gates-capsule',ok:false,phase:'entry-internal',error:String(e&&e.message?e.message:e)});process.exitCode=1;});
