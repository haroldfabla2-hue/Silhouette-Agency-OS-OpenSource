// Real owned provider persistence, not provider API calls or Vitest/RPC causality.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { ProviderPersistenceOperation, ProviderPersistenceOutcome } from '../../../services/providerHealthManager.ts';
assert.equal(fs.readFileSync('FIXTURE_ONLY', 'utf8'), 'PROVIDER_HEALTH_ONLY');
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance');
assert.equal(process.env.REDIS_URL, undefined);
const { providerHealth } = await import('../../../services/providerHealthManager.ts');
const { continuum } = await import('../../../services/continuumMemory.ts');
const operations: ProviderPersistenceOperation[] = [];
let outcomes: ProviderPersistenceOutcome[] = [];
const capture = (stage: 'CALLS_RETURNED' | 'COMPLETIONS_OBSERVED' | 'BEFORE_EXIT') => {
    const proof = { stage, pid: process.pid,
        operations: operations.map(({ operationId, admitted }) => ({ operationId, admitted })),
        outcomes, persistence: providerHealth.getPersistenceStatus(), health: providerHealth.getHealthStats(),
        effects: continuum.getMemoryEffectOperations(),
        nodes: continuum.getVolatileState().filter(node => node.tags.includes('system-health')),
        snapshots: continuum.getSnapshotOperations() };
    fs.writeFileSync(`provider-${stage}.json`, JSON.stringify(proof));
    console.log('PROVIDER_HEALTH_FIXTURE:' + JSON.stringify({ event: stage, pid: process.pid }));
};
process.once('beforeExit', () => capture('BEFORE_EXIT'));
// All eight calls and ownership handoffs are synchronous, before yielding any microtask.
for (let index = 0; index < 8; index++) {
    const operation = providerHealth.reportFailure('gemini:model-a', 'boom');
    assert.equal(providerHealth.observePersistence(operation, 'fixture:provider-health'), true);
    assert.equal(operation.admitted, true);
    operations.push(operation);
}
assert.equal(providerHealth.isAvailable('gemini:model-a'), false);
assert.equal(providerHealth.isAvailable('gemini:model-b'), true);
assert.equal(providerHealth.getHealthStats()['gemini:model-a'].consecutiveFailures, 8);
assert.equal(new Set(operations.map(operation => operation.operationId)).size, 8);
const initial = providerHealth.getPersistenceStatus();
assert.equal(initial.operations.length, 8);
assert.ok(initial.operations.every(row => row.state === 'PENDING' && row.observer === 'fixture:provider-health'));
assert.equal(initial.notAdmittedCount, 0);
capture('CALLS_RETURNED');
outcomes = await Promise.all(operations.map(operation => operation.completion));
// Observed bytes are saved before validation can throw; this marker is not PASS.
capture('COMPLETIONS_OBSERVED');
assert.equal(outcomes.length, 8);
for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index];
    assert.equal(outcome.operationId, operations[index].operationId);
    assert.equal(outcome.providerId, 'gemini:model-a');
    assert.equal(outcome.canonical, 'RETURNED_NOT_A_RECEIPT');
    assert.ok(outcome.state === 'EFFECTS_COMPLETE' || outcome.state === 'STORE_RETURNED_UNCONFIRMED', JSON.stringify(outcome));
    const retained = providerHealth.getPersistenceStatus().operations.find(row => row.operationId === outcome.operationId);
    if (outcome.state === 'EFFECTS_COMPLETE') {
        assert.equal(outcome.effects?.state, 'COMPLETE');
        assert.equal(retained, undefined);
    } else {
        assert.ok(retained);
        assert.deepEqual(retained.outcome, outcome);
    }
}
// No process.exit, SQLite close, imported shutdown, private counter, fake promise or sleep.
// No assertion of eight canonical writes: concurrent/dedup/ingestion may skip or handle.
