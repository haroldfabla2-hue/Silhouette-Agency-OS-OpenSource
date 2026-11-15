// Proposed real child only. Supervisor/isolation/execution package not yet prepared.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const mode = process.argv[2];
assert.ok(mode === 'cold' || mode === 'malformed');
assert.equal(fs.readFileSync('FIXTURE_ONLY', 'utf8'), 'HYDRATION_BOUNDARY_ONLY');
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance');
assert.equal(process.env.REDIS_URL, undefined);
const file = 'data/memory_snapshot.json';
if (mode === 'cold') assert.equal(fs.existsSync(file), false);
else assert.equal(fs.readFileSync(file, 'utf8'), '{invalid real snapshot');
const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const before = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
const { providerHealth } = await import('../../../services/providerHealthManager.ts');
const { continuum } = await import('../../../services/continuumMemory.ts');
const { introspection } = await import('../../../services/introspectionEngine.ts');
const json = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item);
const capture = (stage: string, extra = {}) => {
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    const proof = { mode, stage, pid: process.pid,
        core: continuum.getCoreRecoveryReport(), initial: introspection.getInitialWorkStatus(),
        health: providerHealth.getHealthStats(), persistence: providerHealth.getPersistenceStatus(),
        volatile: continuum.getVolatileState(), snapshots: continuum.getSnapshotOperations(),
        effects: continuum.getMemoryEffectOperations(), disk: bytes ? { bytes: bytes.length, sha256: sha(bytes) } : null,
        ...extra };
    fs.writeFileSync(`hydration-${stage}.json`, json(proof));
    console.log('HYDRATION_FIXTURE:' + JSON.stringify({ mode, stage, pid: process.pid }));
};
process.once('beforeExit', () => capture('BEFORE_EXIT'));
const operations = [];
for (let i=0; i<8; i++) {
    const operation = providerHealth.reportFailure('gemini:model-a', 'boom');
    assert.equal(operation.admitted, true);
    assert.equal(providerHealth.observePersistence(operation, 'fixture:hydration'), true);
    operations.push(operation);
}
capture('CALLS_RETURNED', { operationIds: operations.map(o=>o.operationId) });
assert.equal(new Set(operations.map(o=>o.operationId)).size,8);
assert.equal(providerHealth.getPersistenceStatus().operations.length,8);
// Actual snapshot/volatile state is captured, but imports may have allowed
// hydration to settle. No claim of PENDING or zero mutation at this instant.
const outcomes = await Promise.all(operations.map(o=>o.completion));
capture('OUTCOMES_OBSERVED', {outcomes});
const bootstrap = await Promise.allSettled([continuum.readyCore(), introspection.readyInitial()]);
const initialEffect = introspection.getInitialConceptEffectOwner();
const observedEffects = await Promise.allSettled([
    continuum.settleMemoryEffects(), ...(initialEffect ? [initialEffect] : [])
]);
capture('COMPLETIONS_OBSERVED',{outcomes,bootstrap,observedEffects});
assert.equal(providerHealth.isAvailable('gemini:model-a'),false);
assert.equal(providerHealth.isAvailable('gemini:model-b'),true);
assert.equal(providerHealth.getHealthStats()['gemini:model-a'].consecutiveFailures,8);
if(mode==='cold') {
    assert.ok(bootstrap.every(x=>x.status==='fulfilled'));
    assert.notEqual(continuum.getCoreRecoveryReport()?.outcome,'FAILED');
    assert.equal(introspection.getInitialWorkStatus().concept.state,'COMPLETE');
    assert.equal(introspection.getInitialWorkStatus().goals.state,'COMPLETE');
    assert.ok(outcomes.every(x=>x.state==='EFFECTS_COMPLETE'));
    assert.equal(providerHealth.getPersistenceStatus().operations.length,0);
    assert.equal(continuum.getSnapshotOperations().length,0);
    assert.equal(continuum.getMemoryEffectOperations().length,0);
} else {
    assert.equal(bootstrap[0].status,'rejected');
    assert.equal(continuum.getCoreRecoveryReport()?.outcome,'FAILED');
    assert.equal(introspection.getInitialWorkStatus().concept.state,'FAILED');
    assert.equal(introspection.getInitialWorkStatus().goals.state,'FAILED');
    assert.ok(outcomes.every(x=>x.state==='CANONICAL_FAILED_PARTIAL_POSSIBLE'));
    assert.equal(providerHealth.getPersistenceStatus().operations.length,8);
    assert.equal(continuum.getVolatileState().length,0);
    assert.equal(continuum.getSnapshotOperations().length,0);
    assert.equal(continuum.getMemoryEffectOperations().length,0);
    assert.deepEqual(fs.readFileSync(file),before);
}
// No process.exit, mock, private-state write, recovery retry/ack or timer workaround.
