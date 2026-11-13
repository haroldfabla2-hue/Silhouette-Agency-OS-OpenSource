// Baseline observation only. No provider request, mocks, module reset, shutdown or drain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.equal(fs.readFileSync('FIXTURE_ONLY', 'utf8'), 'PROVIDER_HEALTH_ONLY');
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance');
assert.equal(process.env.REDIS_URL, undefined);
const { providerHealth } = await import('../../../services/providerHealthManager.ts');
const { continuum } = await import('../../../services/continuumMemory.ts');
const returns: { index: number; type: string; thenable: boolean }[] = [];
const capture = (stage: 'CALLS_RETURNED' | 'BEFORE_EXIT') => {
    const proof = { stage, pid: process.pid, returns, health: providerHealth.getHealthStats(),
        effects: continuum.getMemoryEffectOperations(),
        nodes: continuum.getVolatileState().filter(node => node.tags.includes('system-health')),
        snapshots: continuum.getSnapshotOperations() };
    fs.writeFileSync(`provider-${stage}.json`, JSON.stringify(proof));
    console.log('PROVIDER_HEALTH_FIXTURE:' + JSON.stringify({ event: stage, pid: process.pid }));
};
// Observe final public state without awaiting/importing any additional owner.
// beforeExit may never arrive. Supervisor treats that as real bounded FAIL.
process.once('beforeExit', () => capture('BEFORE_EXIT'));
for (let index = 0; index < 8; index++) {
    const returned: unknown = providerHealth.reportFailure('gemini:model-a', 'boom');
    returns.push({ index, type: typeof returned, thenable: returned !== null &&
        (typeof returned === 'object' || typeof returned === 'function') && 'then' in returned });
    assert.equal(returned, undefined, 'Baseline void return changed: reconcile contract, do not assume ownership');
}
assert.equal(providerHealth.isAvailable('gemini:model-a'), false);
assert.equal(providerHealth.isAvailable('gemini:model-b'), true);
assert.equal(providerHealth.getHealthStats()['gemini:model-a'].consecutiveFailures, 8);
capture('CALLS_RETURNED');
// No process.exit, sqlite close, forced state, provider invocation, fake promise or sleep.
// This is NOT Vitest/RPC reproduction: only the same cold provider graph and eight calls.
