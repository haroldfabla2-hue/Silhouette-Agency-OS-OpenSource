import assert from 'node:assert/strict';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { VectorProjectionJournal } from '../../services/vectorProjectionJournal.ts';
import { LanceDbService } from '../../services/lancedbService.ts';
import { UnifiedVectorMemory } from '../../services/unifiedVectorMemory.ts';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
import { MemoryTier } from '../../types.ts';
const root = process.env.UNIFIED_MEMORY_TEST_DIR;
assert.ok(root?.includes('/qdrant-eval-'));
const directory = path.join(root, `fairness-${process.pid}`);
const identity = { model: 'PUBLIC_FAIRNESS_FIXTURE', version: '1', dimension: 384 };
const vector = Array(384).fill(0); vector[0] = 1;
const node = (id: string) => ({ id, content: 'Public fairness ' + id, tags: [], timestamp: 1, importance: 0.5,
    tier: MemoryTier.DEEP, decayHealth: 100, accessCount: 0, lastAccess: 1, compressionLevel: 0, embeddingIdentity: identity });
(async () => {
    const filename = path.join(directory, 'vector-projection-intents.sqlite');
    let journal = new VectorProjectionJournal(filename);
    for (let i = 0; i < 101; i++) journal.prepare(node('PUBLIC_ORPHAN_' + i), vector, identity);
    const recoverable = journal.prepare(node('PUBLIC_RECOVERABLE'), vector, identity);
    journal.close();
    const target = new VectorMemoryService({ enabled: async () => false });
    const canonical = new LanceDbService(directory, target);
    // Actual prepared journal followed by canonical commit with no projection,
    // the durable state of an interruption before local-vector delivery.
    await canonical.store(node('PUBLIC_RECOVERABLE'));
    // Exact interrupted-write fixture: real store would atomically commit the
    // prepared event key beside its canonical row before local projection.
    const fixtureConnection = await lancedb.connect(directory);
    const fixtureTable = await fixtureConnection.openTable('memory_records_v2');
    await fixtureTable.update({ where: "id = 'PUBLIC_RECOVERABLE'", values: { projection_event_key: recoverable.key } });
    await canonical.replayVectorProjections(50);
    journal = new VectorProjectionJournal(filename);
    const secondBatch = journal.pending(50);
    assert.ok(!secondBatch.some(intent => intent.id === 'PUBLIC_ORPHAN_0'), 'scan cursor survives reopen');
    journal.close();
    const reopened = new LanceDbService(directory, target);
    await reopened.replayVectorProjections(50);
    await reopened.replayVectorProjections(50);
    const hits = await new UnifiedVectorMemory(reopened).searchMemory(vector, 5, undefined, identity);
    assert.equal(hits[0]?.id, 'PUBLIC_RECOVERABLE', 'valid prepared after >batch orphans must recover original local vector without Qdrant');
    journal = new VectorProjectionJournal(filename);
    assert.equal(journal.stats().retained_unsupported, 1, '384 local repaired, not falsely projected to Qdrant');
    assert.equal(journal.stats().prepared, 101, 'orphan intent history retained');
    journal.close();
    console.log(JSON.stringify({ prepared_orphans: 101, batch: 50, cursor_persisted: true,
        recovered_valid_384_local: true, qdrant_disabled: true, orphan_history_preserved: true }));
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
