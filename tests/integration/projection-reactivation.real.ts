import assert from 'node:assert/strict';
import path from 'node:path';
import { VectorProjectionJournal } from '../../services/vectorProjectionJournal.ts';
import { LanceDbService } from '../../services/lancedbService.ts';
import { UnifiedVectorMemory } from '../../services/unifiedVectorMemory.ts';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
import { MemoryTier } from '../../types.ts';
const root = process.env.UNIFIED_MEMORY_TEST_DIR;
assert.ok(root?.includes('/qdrant-eval-'));
const directory = path.join(root, `reactivation-${process.pid}`);
const filename = path.join(directory, 'vector-projection-intents.sqlite');
const identity = { model: 'PUBLIC_REACTIVATION_FIXTURE', version: '1', dimension: 768 };
const vector = Array.from({ length: 768 }, (_, i) => Math.sin(i + 0.19) / (i + 3));
const node: any = { id: 'PUBLIC_RESTORED_ID', content: 'Public exact A', tags: [], timestamp: 1,
    importance: 0.5, tier: MemoryTier.DEEP, accessCount: 0, lastAccess: 1, embeddingIdentity: identity };
(async () => {
    const disabled = new VectorMemoryService({ enabled: async () => false });
    const canonical = new LanceDbService(directory, disabled);
    let journal = new VectorProjectionJournal(filename);
    await canonical.store(node, vector);
    const [first] = journal.pending(50);
    assert.ok(first);
    // Explicit historical terminal LEDGER fixture, not a successful mirror double.
    // No mirror is run or claimed. This exercises real durable state transitions.
    journal.completed(first.key);
    await canonical.store({ ...node, content: 'Public B', timestamp: 2 }, vector);
    const [second] = journal.pending(50);
    assert.ok(second); journal.completed(second.key);
    await canonical.store(node, vector); // Exact payload, timestamp, identity and vector A reused.
    journal.close(); journal = new VectorProjectionJournal(filename);
    const restore = journal.pending(50);
    assert.equal(restore.length, 1, 'restored A must have its own pending delivery event');
    assert.notEqual(restore[0].key, first.key, 'value checksum is not delivery-event identity');
    assert.deepEqual(restore[0].node, node);
    assert.deepEqual(restore[0].vector, vector);
    assert.equal(journal.stats().complete, 2, 'terminal history must not be reset or deleted');
    const restoredKey = restore[0].key;
    journal.superseded(restoredKey);
    await canonical.store(node, vector);
    const repeated = journal.pending(50);
    assert.equal(repeated.length, 1, 'superseded exact value must also reactivate as new event');
    assert.notEqual(repeated[0].key, restoredKey);
    journal.close();
    const reopened = new LanceDbService(directory, disabled);
    const result = await reopened.replayVectorProjections(50);
    assert.equal(result.pending, 1, 'disabled mirror remains honestly pending, not falsely acknowledged');
    const hits = await new UnifiedVectorMemory(reopened).searchMemory(vector, 1, undefined, identity);
    assert.equal(hits[0]?.payload.content, node.content);
    assert.deepEqual(await reopened.getNodeById(node.id), node);
    journal = new VectorProjectionJournal(filename);
    assert.equal(journal.stats().complete, 2);
    assert.equal(journal.stats().superseded, 1);
    assert.equal(journal.stats().pending, 1);
    journal.close();
    console.log(JSON.stringify({ exact_A_B_A_reactivation: true, complete_history_retained: 2,
        superseded_history_retained: 1, restored_delivery_pending_after_reopen: true,
        real_local_replay_retains_A: true, mirror_acceptance: 'NOT RUN; disabled, terminal ACKs are explicit ledger fixtures' }));
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
