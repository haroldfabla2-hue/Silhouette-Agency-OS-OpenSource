import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LanceDbService } from '../../services/lancedbService.ts';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
import { MemoryTier } from '../../types.ts';

// Real invalid storage shape followed by repair and actual persistence.
// No claim about native connect rejection, memoization or promise reset.
const root = process.env.UNIFIED_MEMORY_TEST_DIR;
assert.ok(root?.includes('/qdrant-eval-'));
const location = path.join(root, `observation-invalid-storage-${process.pid}.lancedb`);
const reader = new LanceDbService(location);
await assert.rejects(() => reader.getRecentObservations('PUBLIC_INVALID_STORAGE', 0), /bounded/);
assert.deepEqual(await reader.getRecentObservations('PUBLIC_INVALID_STORAGE', 1), []);
assert.equal(await reader.getLatestObservation('PUBLIC_INVALID_STORAGE'), null);
assert.equal(fs.existsSync(location), false, 'absent reads must not create storage');
fs.writeFileSync(location, 'PUBLIC INVALID STORAGE OBSTRUCTION');
const obstructed = fs.statSync(location);
assert.equal(obstructed.isFile(), true);
const failures = await Promise.allSettled([
    reader.getRecentObservations('PUBLIC_INVALID_STORAGE', 1),
    reader.getLatestObservation('PUBLIC_INVALID_STORAGE')
]);
for (const failure of failures) {
    assert.equal(failure.status, 'rejected');
    if (failure.status === 'rejected') assert.match(String(failure.reason), /Observation storage path must be a directory/);
}
assert.equal(fs.readFileSync(location, 'utf8'), 'PUBLIC INVALID STORAGE OBSTRUCTION');
assert.equal((reader as any).observationConnection, null, 'invalid shape rejected before import/connect');
assert.equal((reader as any).initialized, false);
assert.equal((reader as any).ftsReady.size, 0);
fs.unlinkSync(location); // Delete only the identified public fixture.
const disabled = new VectorMemoryService({ enabled: async () => false });
const writer = new LanceDbService(location, disabled);
await writer.store({ id: 'PUBLIC_INVALID_STORAGE_RECOVERY', content: 'Public invalid storage recovery record',
    timestamp: 1, tier: MemoryTier.WORKING, tags: ['PUBLIC_INVALID_STORAGE'], importance: 0.5,
    accessCount: 0, lastAccess: 1 });
assert.deepEqual((await reader.getRecentObservations('PUBLIC_INVALID_STORAGE', 1)).map(node => node.id), ['PUBLIC_INVALID_STORAGE_RECOVERY']);
assert.equal((reader as any).initialized, false);
assert.equal((reader as any).ftsReady.size, 0);
const alias = path.join(root, `observation-valid-directory-link-${process.pid}`);
fs.symlinkSync(location, alias, 'dir');
assert.equal((await new LanceDbService(alias).getLatestObservation('PUBLIC_INVALID_STORAGE'))?.id, 'PUBLIC_INVALID_STORAGE_RECOVERY');
console.log(JSON.stringify({ marker: 'OBSERVATION_INVALID_STORAGE_RECOVERY_REAL_PASS',
    absentUnchanged: true, invalidStorageObservable: true, sameReaderRecovered: true,
    noInitializationOrFTS: true, validDirectorySymlinkReadable: true,
    scope: 'real invalid storage shape and same-reader recovery, not native connect failure or promise reset' }));
