/** NOT EXECUTED. One fresh isolated subprocess per named mode. Actual original
 * singleton constructors, native local stores, entropy and timers. ProvidersOFF.
 * No response/method replacement, private mutation, fake timers or success exit.
 * External phase supervisor MUST enforce original180s/resource containment.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { OwnershipConflict } from '../../services/lifecycle/host';
import { installPreparationHost } from '../../services/lifecycle/bootstrapAuthority';
const mode = process.argv[2];
assert.ok(['constructors','identity-existing','saturated-replay','schema-and-write-failure','power-check','timer-armed','timer-fired','threshold'].includes(mode));
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_INFERENCE_MODE, 'cloud-only');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.SILHOUETTE_FINITE_CONTINUUM, 'exact-original-boundaries-v1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silhouette-continuum-original-'));
process.chdir(root);
Object.assign(process.env, {
 SILHOUETTE_DB_PATH:path.join(root,'main.sqlite'), SILHOUETTE_IDENTITY_DB_PATH:path.join(root,'identity.sqlite'),
 SILHOUETTE_TOOLS_DB_PATH:path.join(root,'tools.db'), SILHOUETTE_LANCEDB_PATH:path.join(root,'memory.lancedb'),
 SILHOUETTE_MEMORY_SNAPSHOT_PATH:path.join(root,'memory_snapshot.json'),
 SILHOUETTE_MEMORY_TRANSITIONS_DIR:path.join(root,'memory-transitions'),
 SILHOUETTE_CONTINUUM_REDIS_KEY:'continuum:test-owner:'+randomUUID()+':volatile',
 WORKSPACE_ROOT:path.join(root,'workspace'), PROPOSAL_OWNER_DIR:root, INGRESS_REPLAY_DIR:root, CONFIRMATION_GATE_DIR:root,
});
fs.writeFileSync(process.env.SILHOUETTE_MEMORY_SNAPSHOT_PATH!, JSON.stringify({working:[],ultraShort:[],short:[]}));
const host = installPreparationHost({scopes:128,active:512,failures:64,resources:256});
const checkpoints = await import('../../services/lifecycle/finiteContinuumCheckpoints');
const permits = await import('../../services/lifecycle/continuumDreamerNotification');
const runtime = await import('../../services/lifecycle/runtimeStopBindings');
const projection = await import('../../services/lifecycle/retainedFailureCategories');
const {MemoryTier} = await import('../../types');
const armed: import('../../services/lifecycle/finiteContinuumCheckpoints').FiniteContinuumStage[] = [];
const arm = (stage: typeof armed[number]) => { checkpoints.armFiniteContinuumStage(stage); armed.push(stage); };
const release = (stage: typeof armed[number]) => { checkpoints.releaseFiniteContinuumStage(stage); armed.splice(armed.indexOf(stage),1); };
const reached = checkpoints.awaitFiniteContinuumStage;
let assertionsComplete = false;
let exactFilesystemOriginal: unknown;
let schemaRejected = false;
// Fixed stages/predicates only. No message/stack/path/schema payload export.
const assertionDiagnostic = {
 stage:'NOT_REACHED', predicate:'NOT_REACHED',
 filesystem:{observed:false,code:'NOT_OBSERVED',syscall:'NOT_OBSERVED',destinationMatches:'NOT_OBSERVED'},
 schemaDisposition:'NOT_OBSERVED', thrownKind:'NOT_OBSERVED',
};

const modeReceiptPath = process.env.SILHOUETTE_FINITE_MODE_RECEIPT;
assert.ok(modeReceiptPath && /^\/evidence\/continuum-mode-[a-z-]+\.json$/.test(modeReceiptPath));
let report: Awaited<ReturnType<typeof host.stop>> | undefined;
const cleanup: PromiseSettledResult<unknown>[]=[];
try {
 if (mode === 'constructors') { arm('concept-before-store'); arm('identity-after-query'); }
 if (mode === 'identity-existing') {
  // Write-and-verify the actual original canonical Lance route before any
  // continuum/gemini/consciousness import can start identity initialization.
  const {lancedbService} = await import('../../services/lancedbService');
  const now = Date.now(); const id = randomUUID();
  const receipt = await lancedbService.store({id,content:'Authored isolated existing identity',tier:MemoryTier.DEEP,tags:['IDENTITY','SACRED'],importance:1,timestamp:now,accessCount:1,lastAccess:now,decayHealth:100,compressionLevel:0});
  assert.equal(receipt.ok,true);
  const actual = await lancedbService.getAllNodes(); assert.ok(actual.some(node => node.id === id));
  arm('identity-after-query');
 }
 const {continuum} = await import('../../services/continuumMemory');
 const {introspection} = await import('../../services/introspectionEngine');
 const {consciousness} = await import('../../services/consciousnessEngine');
 const {dreamer} = await import('../../services/dreamerService');
 if (mode === 'constructors') {
  await Promise.all([reached('concept-before-store'),reached('identity-after-query')]);
  const before = dreamer.finiteOriginalBoundarySnapshot();
  runtime.sealEvaluatedRuntimeProducers();
  release('concept-before-store'); release('identity-after-query');
  await Promise.all([introspection.getInitialOwners().concept,consciousness.ready()]);
  const effect = await introspection.getInitialConceptEffectOwner(); assert.equal(effect?.state,'COMPLETE');
  await permits.joinAcceptedContinuumNotifications();
  const after = dreamer.finiteOriginalBoundarySnapshot();
  assert.equal(after.acceptedCallbackCount-before.acceptedCallbackCount,2);
  assert.equal(after.acceptedCallbackCompleted-before.acceptedCallbackCompleted,2);
  assert.equal(after.acceptedCallbackFailed-before.acceptedCallbackFailed,0);
  assert.equal(after.entropy-before.entropy,2);
  assert.ok((await continuum.getIdentityNodes()).some(node=>node.tags.includes('IDENTITY')));
 } else {
  if (mode === 'identity-existing') { await reached('identity-after-query'); release('identity-after-query'); }
  await Promise.all([introspection.getInitialOwners().concept,consciousness.ready(),continuum.readyCore()]);
  await introspection.getInitialConceptEffectOwner(); await continuum.settleMemoryEffects();
  if (mode === 'identity-existing') {
   // Exactly one real concept callback; the actual existing-identity guard
   // must not produce another callback/reservation or leak at final join.
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().acceptedCallbackCount,1);
   runtime.sealEvaluatedRuntimeProducers(); await permits.joinAcceptedContinuumNotifications();
  }
  if (mode === 'saturated-replay') {
   dreamer.setThreshold(1000000); // Real public configuration, not private state.
   arm('store-claimed-before-hydration');
   const token = permits.reserveCanonicalStoreNotification();
   const first = continuum.storeWithEffectReceipt('Authored original saturation store',MemoryTier.ULTRA_SHORT,[],false,undefined,token);
   await reached('store-claimed-before-hydration');
   const others = Array.from({length:127},(_,i)=>continuum.storeWithEffectReceipt('Authored saturation branch '+i,MemoryTier.ULTRA_SHORT));
   assert.equal(checkpoints.finiteContinuumStageSnapshot().find(stage=>stage.stage==='store-claimed-before-hydration')?.hits,128);
   // Replay at the REAL production128effect reservation limit. It MUST NOT
   // dispose the first store's exclusive claim, even while original is held.
   await assert.rejects(continuum.storeWithEffectReceipt('Replay must not mutate',MemoryTier.ULTRA_SHORT,[],false,undefined,token),error=>error instanceof OwnershipConflict);
   const foreign = Object.freeze({}) as typeof token;
   await assert.rejects(continuum.storeWithEffectReceipt('Foreign must not mutate',MemoryTier.ULTRA_SHORT,[],false,undefined,foreign),error=>error instanceof OwnershipConflict);
   const before = dreamer.finiteOriginalBoundarySnapshot();
   runtime.sealEvaluatedRuntimeProducers(); release('store-claimed-before-hydration');
   const completions = await Promise.all([first,...others]);
   const effects = await Promise.all(completions.map(completion=>completion.effects!.completion));
   assert.equal(effects.length,128); assert.ok(effects.every(effect=>effect.state==='COMPLETE'));
   await permits.joinAcceptedContinuumNotifications();
   const after = dreamer.finiteOriginalBoundarySnapshot();
   assert.equal(after.acceptedCallbackCompleted-before.acceptedCallbackCompleted,128);
   assert.equal(after.entropy-before.entropy,128);
   await assert.rejects(continuum.store('Late independent write forbidden'),/after-producer-cancel/);
   await assert.rejects(dreamer.notifyNewMemory(),/dreamer:notifyNewMemory/);
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().entropy,after.entropy);
  }
  if (mode === 'schema-and-write-failure') {
   const before = dreamer.finiteOriginalBoundarySnapshot();
   assertionDiagnostic.stage='SCHEMA_CALL'; assertionDiagnostic.predicate='SCHEMA_CALL_RESOLVES';
   const rejected = await continuum.storeWithEffectReceipt('',MemoryTier.ULTRA_SHORT);
   assertionDiagnostic.schemaDisposition=rejected.canonicalDisposition==='SCHEMA_REJECTED'?'SCHEMA_REJECTED':'OTHER_OR_UNKNOWN';
   assertionDiagnostic.stage='SCHEMA_DISPOSITION'; assertionDiagnostic.predicate='SCHEMA_REJECTED_EXACT';
   assert.equal(rejected.canonicalDisposition,'SCHEMA_REJECTED');
   assertionDiagnostic.predicate='SCHEMA_NO_EFFECT'; assert.equal(rejected.effects,undefined); schemaRejected = true;
   assertionDiagnostic.stage='SCHEMA_CALLBACK_COUNT'; assertionDiagnostic.predicate='NO_SCHEMA_CALLBACK';
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().acceptedCallbackCount,before.acceptedCallbackCount);
   // Real immutable filesystem obstruction, not a fake canonical response.
   const snapshot = process.env.SILHOUETTE_MEMORY_SNAPSHOT_PATH!;
   assertionDiagnostic.stage='FILESYSTEM_OBSTRUCTION'; assertionDiagnostic.predicate='BACKUP_RENAME';
   fs.renameSync(snapshot,snapshot+'.authored-backup');
   assertionDiagnostic.predicate='CREATE_TARGET_DIRECTORY'; fs.mkdirSync(snapshot);
   assertionDiagnostic.stage='CANONICAL_WRITE'; assertionDiagnostic.predicate='WRITE_REJECTS';
   await assert.rejects(continuum.storeWithEffectReceipt('Authored real denied write',MemoryTier.ULTRA_SHORT),original=>{
    const error=original as NodeJS.ErrnoException & {dest?:string};
    // Exact original target is checked IN MEMORY only; no paths/messages export.
    assertionDiagnostic.filesystem={observed:true,
     code:error?.code==='EISDIR'?'EISDIR':error?.code==='ENOTDIR'?'ENOTDIR':error?.code==='EACCES'?'EACCES':error?.code==='EPERM'?'EPERM':'OTHER_OR_UNKNOWN',
     syscall:error?.syscall==='rename'?'RENAME':error?.syscall==='open'?'OPEN':error?.syscall==='mkdir'?'MKDIR':error?.syscall==='read'?'READ':'OTHER_OR_UNKNOWN',
     destinationMatches:error?.dest===snapshot?'MATCH':'MISMATCH_OR_MISSING'};
    assertionDiagnostic.stage='FILESYSTEM_PREDICATE'; assertionDiagnostic.predicate='ERROR_CODE_EISDIR';
    assert.equal(error.code,'EISDIR');
    assertionDiagnostic.predicate='ERROR_SYSCALL_RENAME'; assert.equal(error.syscall,'rename');
    assertionDiagnostic.predicate='ERROR_DESTINATION_EXACT'; assert.equal(error.dest,snapshot); exactFilesystemOriginal=original; return true;
   });
   assertionDiagnostic.stage='WRITE_CALLBACK_COUNT'; assertionDiagnostic.predicate='NO_WRITE_CALLBACK';
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().acceptedCallbackCount,before.acceptedCallbackCount);
   assertionDiagnostic.stage='FAILED_WRITE_DISPOSITION_JOIN'; assertionDiagnostic.predicate='ORIGINAL_NOTIFICATION_JOIN';
   runtime.sealEvaluatedRuntimeProducers(); await permits.joinAcceptedContinuumNotifications();
  }
  if (mode === 'power-check') {
   arm('power-before-import'); dreamer.startDreamingLoop(); await reached('power-before-import');
   const original = dreamer.cancelAndDrainOriginalProducers(); release('power-before-import'); await original;
   dreamer.startDreamingLoop();
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().intervalArmed,false);
  }
  if (mode === 'timer-armed') {
   arm('eureka-fired-before-body');
   dreamer.armFiniteOriginalEurekaTimer(); assert.equal(dreamer.finiteOriginalBoundarySnapshot().deferredEurekas,1);
   await dreamer.cancelAndDrainOriginalProducers();
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().deferredEurekas,0);
   // Independent real5200ms timer spans the original5s deadline. A removed
   // clearTimeout with only map.clear MUST fire original checkpoint and fail.
   await new Promise<void>(resolve=>setTimeout(resolve,5200));
   assert.equal(checkpoints.finiteContinuumStageSnapshot().find(stage=>stage.stage==='eureka-fired-before-body')?.hits,0);
   release('eureka-fired-before-body');
   assert.throws(()=>dreamer.armFiniteOriginalEurekaTimer(),/after-cancel/);
  }
  if (mode === 'timer-fired') {
   arm('eureka-fired-before-body'); dreamer.armFiniteOriginalEurekaTimer();
   await reached('eureka-fired-before-body'); // Actual original5s timer fired.
   let joined=false; const original=dreamer.cancelAndDrainOriginalProducers().then(()=>{joined=true;});
   await new Promise<void>(resolve=>setImmediate(resolve)); assert.equal(joined,false);
   release('eureka-fired-before-body'); await original;
   assert.equal(dreamer.finiteOriginalBoundarySnapshot().deferredEurekas,0);
  }
  if (mode === 'threshold') {
   arm('notification-hard-cap');
   const before = dreamer.finiteOriginalBoundarySnapshot();
   // Drive actual local entropy body, not mutated counters or fake synthesis.
   const count = 31-before.entropy;
   const claims = Array.from({length:count},()=>permits.claimContinuumNotification(permits.reserveCanonicalStoreNotification()));
   await dreamer.cancelAndDrainOriginalProducers();
   for (const claim of claims.slice(0,-1)) await dreamer.notifyAcceptedContinuumMemory(claim);
   const selected = dreamer.notifyAcceptedContinuumMemory(claims.at(-1)!);
   void selected.catch(()=>undefined);
   await reached('notification-hard-cap');
   release('notification-hard-cap');
   const originalOutcome = await Promise.allSettled([selected]);
   // A genuine providerOFF/late graph failure is evidence, never synthesized
   // into a successful dream. It remains in the actual Host report below.
   const after=dreamer.finiteOriginalBoundarySnapshot();
   assert.equal(after.acceptedCallbackCount-before.acceptedCallbackCount,count);
   assert.equal(after.acceptedCallbackCompleted+after.acceptedCallbackFailed-before.acceptedCallbackCompleted-before.acceptedCallbackFailed,count);
   assert.equal(after.entropy,0);
   console.log('ACTUAL_HARD_CAP_ORIGINAL_OUTCOME',originalOutcome[0].status);
  }
 }
 assertionsComplete=true;
 if (mode==='schema-and-write-failure') { assertionDiagnostic.stage='BODY_ASSERTIONS_COMPLETED'; assertionDiagnostic.predicate='NONE'; }
} catch (original) {
 // Only fixed structural tags, never arbitrary Error.name/message/code strings.
 assertionDiagnostic.thrownKind=original instanceof assert.AssertionError?'ASSERTION_ERROR':original instanceof Error?'OTHER_ERROR':'NON_ERROR_OR_UNKNOWN';
 throw original;
} finally {
 // Independent cleanup never skipped after failed assertion. Release test
 // latches only, not original obligations/timers or errors.
 for (const stage of [...armed]) release(stage);
 runtime.sealEvaluatedRuntimeProducers();
 cleanup.push(...await Promise.allSettled([runtime.drainEvaluatedRuntimeProducers()]));
 cleanup.push(...await Promise.allSettled([runtime.closeEvaluatedRuntimeStorage()]));
 report=await host.stop();
 const categories=projection.projectRetainedFailureCategories(report);
 console.log('ACTUAL_SAME_REPORT_FIXED_CATEGORIES',JSON.stringify(categories));
 let hostCauseAssertionFailure: unknown;
 try {
 if (mode === 'schema-and-write-failure' && assertionsComplete) {
  assertionDiagnostic.stage='HOST_CAUSE_ASSERTIONS'; assertionDiagnostic.predicate='SCHEMA_CASE_REACHED';
  assert.ok(schemaRejected);
  const abandoned=report.failures.filter(failure=>failure.source==='dreamer:canonical-store-notification:accepted-effect:NOT_INVOKED');
  assertionDiagnostic.predicate='RETAINED_SCHEMA_ZOD'; assert.ok(abandoned.some(failure=>failure.original instanceof ZodError));
  assertionDiagnostic.predicate='FILESYSTEM_ORIGINAL_CAPTURED'; assert.ok(exactFilesystemOriginal);
  assertionDiagnostic.predicate='SAME_FILESYSTEM_ORIGINAL_RETAINED'; assert.ok(abandoned.some(failure=>failure.original===exactFilesystemOriginal));
  assertionDiagnostic.predicate='FILESYSTEM_NOT_SCHEMA_ZOD'; assert.ok(!(exactFilesystemOriginal instanceof ZodError));
  assertionDiagnostic.stage='HOST_CAUSE_ASSERTIONS_COMPLETED'; assertionDiagnostic.predicate='NONE';
 }
 } catch (original) {
  assertionDiagnostic.thrownKind=original instanceof assert.AssertionError?'ASSERTION_ERROR':original instanceof Error?'OTHER_ERROR':'NON_ERROR_OR_UNKNOWN';
  hostCauseAssertionFailure=original;
 }
 assert.equal(categories.lifetimeFailures,report.lifetimeFailures);
 assert.equal(categories.acknowledged,report.acknowledged);
 assert.equal(report.state,'INCOMPLETE'); // Existing unsafe frontier remains.
 // No process.exit, forced success, acknowledgement, swallowed original error,
 // global PASS claim or deletion of evidence/native files.
 const phaseReceipt = {version:1,mode,assertionsComplete:assertionsComplete && !hostCauseAssertionFailure,assertionDiagnostic,
  cleanup:cleanup.map(result=>result.status),
  productState:report.state, ownerFailures:report.ownerFailures,taskOutcomeFailures:report.taskOutcomeFailures,
  lifetimeFailures:report.lifetimeFailures, categories,
  componentVerdict:assertionsComplete && !hostCauseAssertionFailure?'ASSERTIONS_COMPLETED_NOT_PRODUCT_PASS':'ASSERTIONS_INCOMPLETE',
  productVerdict:cleanup.some(result=>result.status==='rejected')||report.ownerFailures||report.taskOutcomeFailures?'FAIL_RETAINED_ORIGINAL_EVIDENCE':'INCOMPLETE_FRONTIER',
 };
 fs.writeFileSync(modeReceiptPath!,JSON.stringify(phaseReceipt)+'\n',{flag:'wx',mode:0o600});
 if (hostCauseAssertionFailure) throw hostCauseAssertionFailure;
 console.log(JSON.stringify({mode,assertionsComplete,scope:'FINITE_ORIGINAL_BOUNDARIES_ONLY_NOT_PRODUCT_PASS',cleanup:cleanup.map(result=>result.status),ownerFailures:report.ownerFailures,taskOutcomeFailures:report.taskOutcomeFailures}));
}
