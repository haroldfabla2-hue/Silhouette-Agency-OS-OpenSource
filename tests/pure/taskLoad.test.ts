import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeTaskMetadata, taskLoadSnapshot } from '../../services/execution/taskLoad';
const row = (status: string, data: any) => ({ status, data: JSON.stringify(data), updated_at: 100 });
const metadata = { planId: 'p', stepOrder: 1, dependsOn: [2], priority: 'HIGH', unknownFuture: { keep: true }, outputRef: { path: 'private' } };
test('lifecycle preserves unknown/dependencies/priority/outputRef', () => {
    const value = mergeTaskMetadata(row('pending', metadata), { startedAt: 110, outputRef: { path: 'replacement' } });
    assert.deepEqual(value, { ...metadata, startedAt: 110 });
});
test('invalid JSON and non-object metadata fail visibly', () => {
    for (const data of ['{', 'null', '[]', '', null]) assert.throws(() => mergeTaskMetadata({ status: 'running', data }, {}));
});
test('late phase never revives failed or completed rows', () => {
    for (const status of ['failed', 'completed']) assert.equal(mergeTaskMetadata(row(status, metadata), { loadPhase: 'executing' }, true), null);
});
test('abandoned/settled/reviewed open row refuses late phase', () => {
    for (const key of ['abandonedInFlight', 'lateSettlement', 'effectsReviewed']) assert.equal(mergeTaskMetadata(row('running', { ...metadata, [key]: { at: 90 } }), { loadPhase: 'executing' }, true), null);
});
test('recovery evidence is retained by ordinary metadata merge', () => {
    const data = { ...metadata, abandonedInFlight: { timedOutAt: 90 }, lateSettlement: { success: false }, effectsReviewed: { at: 95 } };
    assert.deepEqual(mergeTaskMetadata(row('failed', data), { abandonedInFlight: null, lateSettlement: null, effectsReviewed: null }), data);
});
test('phase observations retain evidence and injected time', () => {
    const value = mergeTaskMetadata(row('running', metadata), { loadPhase: 'waiting_resources', loadPhaseAt: 120 }, true);
    assert.deepEqual(value, { ...metadata, loadPhase: 'waiting_resources', loadPhaseAt: 120 });
});
test('parallel plans count separately; terminal uncertainty is not open', () => {
    const snap = taskLoadSnapshot([row('pending', { planId: 'a', loadPhase: 'admitted' }), row('running', { planId: 'b', loadPhase: 'executing' }), row('failed', { abandonedInFlight: { timedOutAt: 90 }, loadPhase: 'executing' })], 125);
    assert.equal(snap.counts.open, 2); assert.equal(snap.counts.terminalUncertain, 1); assert.equal(snap.counts.unresolvedAbandoned, 1); assert.equal(snap.phases.executing, 1); assert.equal(snap.observedAt, 125);
});
test('wait admission and congestion are distinct recorded phases', () => {
    const snap = taskLoadSnapshot([row('running', { loadPhase: 'waiting_resources' }), row('running', { loadPhase: 'waiting_congestion' })], 130);
    assert.equal(snap.phases.waiting_resources, 1); assert.equal(snap.phases.waiting_congestion, 1); assert.equal(snap.phases.executing, 0);
});
test('late settlement retains failed verdict but resolves uncertainty', () => {
    const snap = taskLoadSnapshot([row('failed', { abandonedInFlight: { timedOutAt: 90 }, lateSettlement: { success: true } })], 140);
    assert.equal(snap.counts.failed, 1); assert.equal(snap.counts.completed, 0); assert.equal(snap.counts.open, 0); assert.equal(snap.counts.unresolvedAbandoned, 0);
});
test('legacy metadata does not manufacture live phase', () => {
    const snap = taskLoadSnapshot([row('running', { planId: 'old' })], 150);
    assert.equal(snap.phases.unknown, 1); assert.equal(snap.counts.legacyUnknown, 1); assert.match(snap.semantics, /recorded_not_live/);
});
test('bad metadata gives unknown health, not false empty work', () => {
    const snap = taskLoadSnapshot([{ status: 'running', data: '{', updated_at: 150 }], 160);
    assert.equal(snap.health, 'unknown'); assert.equal(snap.counts.open, 1); assert.equal(snap.counts.metadataInvalid, 1); assert.equal(snap.phases.unknown, 1);
});
test('aggregate never contains private metadata or IDs', () => {
    const encoded = JSON.stringify(taskLoadSnapshot([row('running', { ...metadata, description: 'secretdescription', originalRequest: 'secretrequest', output: 'secretoutput', error: 'secreterror' })], 170));
    for (const value of ['private', 'secret', 'unknownFuture', 'planId', 'dependsOn']) assert.equal(encoded.includes(value), false);
});
test('invalid metadata has explicit provenance unknown and open unknown phase', () => {
    const snap = taskLoadSnapshot([{ status: 'running', data: '{' }], 180);
    assert.equal(snap.counts.metadataInvalid, 1); assert.equal(snap.counts.provenanceUnknown, 1); assert.equal(snap.phases.unknown, 1);
});
test('provenance metadata counted without exposing identifiers', () => {
    const missing = taskLoadSnapshot([row('pending', {})], 190);
    const present = taskLoadSnapshot([row('pending', { planId: 'neverexpose', stepOrder: 1 })], 190);
    assert.equal(missing.counts.provenanceUnknown, 1); assert.equal(present.counts.provenanceUnknown, 0);
    assert.equal(JSON.stringify(present).includes('neverexpose'), false);
});
test('abandoned open phase is unknown not legacy; coverage is candidates only', () => {
    const abandoned = taskLoadSnapshot([row('running', { loadPhase: 'executing', abandonedInFlight: { timedOutAt: 90 } })], 200);
    assert.equal(abandoned.counts.unresolvedAbandoned, 1); assert.equal(abandoned.phases.unknown, 1); assert.equal(abandoned.counts.legacyUnknown, 0);
    assert.equal(taskLoadSnapshot([row('running', {})], 200).counts.legacyUnknown, 1);
    assert.equal(abandoned.coverage, 'task_prefix_ledger_candidates_not_proven_origin');
});
