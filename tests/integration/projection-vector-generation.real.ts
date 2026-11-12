import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as lancedb from '@lancedb/lancedb';
import { VectorProjectionJournal } from '../../services/vectorProjectionJournal.ts';
import { LanceDbService } from '../../services/lancedbService.ts';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
import { MemoryTier } from '../../types.ts';
const root = process.env.UNIFIED_MEMORY_TEST_DIR;
assert.ok(root?.includes('/qdrant-eval-'));
const directory = path.join(root, `generation-${process.pid}`);
const filename = path.join(directory, 'vector-projection-intents.sqlite');
const identity = { model: 'PUBLIC_VECTOR_GENERATION', version: '1', dimension: 768 };
const v1 = Array.from({ length: 768 }, (_, i) => Math.sin(i + 0.2) / (i + 3));
const v2 = Array.from({ length: 768 }, (_, i) => Math.cos(i + 0.4) / (i + 5));
const node: any = { id: 'PUBLIC_SAME_PAYLOAD', content: 'Public unchanged exact payload', tags: [], timestamp: 1,
    importance: 0.5, tier: MemoryTier.DEEP, accessCount: 0, lastAccess: 1, embeddingIdentity: identity };
(async () => {
    const target = new VectorMemoryService({ enabled: async () => false });
    const canonical = new LanceDbService(directory, target);
    await canonical.store(node, v1);
    await canonical.store(node, v2);
    let journal = new VectorProjectionJournal(filename);
    const first = journal.pending(1)[0];
    assert.deepEqual(first.vector, v1); // Persist cursor after V1 so V2 is replayed FIRST.
    journal.close();
    const reopened = new LanceDbService(directory, target);
    await reopened.replayVectorProjections(1); // V2 first.
    await reopened.replayVectorProjections(1); // Old V1 last must not overwrite V2.
    await assert.rejects(() => reopened.ensureLocalVectorProjection(node, v1, identity), /Canonical vector generation changed/);
    const connection = await lancedb.connect(directory);
    const name = 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,24);
    const table = await connection.openTable(name);
    const row = (await table.query().toArray())[0];
    assert.deepEqual(Array.from(row.vector.toArray()), Array.from(Float32Array.from(v2)), 'latest committed vector wins even when node checksum is identical');
    const current = (await (await connection.openTable('memory_records_v2')).query().toArray())[0];
    journal = new VectorProjectionJournal(filename);
    assert.equal(journal.stats().superseded, 1);
    assert.equal(journal.stats().pending, 1);
    assert.equal(journal.pending(50)[0].key, current.projection_event_key, 'canonical commit binds exact pending delivery event');
    journal.close();
    const faultDirectory = path.join(directory,'metadata-fault');
    const faultWriter = new LanceDbService(faultDirectory,target);
    await faultWriter.store(node,v1);
    const projectionPath = path.join(faultDirectory,name+'.lance');
    const heldPath = projectionPath+'.held-public-fixture';
    fs.renameSync(projectionPath,heldPath);
    fs.writeFileSync(projectionPath,'PUBLIC FILESYSTEM OBSTRUCTION');
    try {
        await faultWriter.store(node,v2); // Canonical V2 succeeds; actual local I/O fails.
    } finally {
        fs.unlinkSync(projectionPath); fs.renameSync(heldPath,projectionPath);
    }
    const metadataNode = { ...node, accessCount: 2 };
    await faultWriter.store(metadataNode); // Fault removed, but stale local V1 remains. No replay yet.
    const faultReopened = new LanceDbService(faultDirectory,target);
    await faultReopened.replayVectorProjections(50);
    const faultConnection = await lancedb.connect(faultDirectory);
    const faultRows = await (await faultConnection.openTable(name)).query().toArray();
    assert.deepEqual(Array.from(faultRows[0].vector.toArray()),Array.from(Float32Array.from(v2)), 'metadata after real V2 fault must retain V2');
    await faultReopened.storeMany([node]); // Existing exact node bulk update binds reused current V2.
    const bulkRow = (await (await faultConnection.openTable('memory_records_v2')).query().toArray())[0];
    assert.ok(bulkRow.projection_event_key,'new bulk write must not regress to unkeyed history');
    let bulkJournal = new VectorProjectionJournal(path.join(faultDirectory,'vector-projection-intents.sqlite'));
    assert.deepEqual(bulkJournal.get(bulkRow.projection_event_key)!.vector,v2);
    bulkJournal.pending(1); bulkJournal.close(); // Adversarial persisted cursor.
    const bulkReopened = new LanceDbService(faultDirectory,target);
    for(let i=0;i<6;i++) await bulkReopened.replayVectorProjections(1);
    const afterBulk = (await (await faultConnection.openTable(name)).query().toArray())[0];
    assert.deepEqual(Array.from(afterBulk.vector.toArray()),Array.from(Float32Array.from(v2)));
    await assert.rejects(()=>bulkReopened.storeMany([{...node,content:'different unsupported bulk content'}]),/Bulk replacement cannot discard/);
    assert.deepEqual(await bulkReopened.getNodeById(node.id),node,'unsupported vector-bearing bulk replacement rejects before canonical modification');
    const migratedDirectory = path.join(directory,'old-schema');
    const migrated = await lancedb.connect(migratedDirectory);
    const oldRow = { ...current, tags: Array.from(current.tags) }; delete oldRow.projection_event_key;
    await migrated.createTable('memory_records_v2', [oldRow]);
    const writerForOldSchema = new LanceDbService(migratedDirectory,target);
    await writerForOldSchema.store(node,v2);
    const upgraded = await migrated.openTable('memory_records_v2');
    assert.ok((await upgraded.schema()).fields.some(f=>f.name==='projection_event_key'));
    assert.equal(await upgraded.countRows(),1);
    assert.deepEqual(await writerForOldSchema.getNodeById(node.id),node);
    // Actual ledger growth, no removal or compaction, ten identical write attempts.
    const measureFile = path.join(directory, 'cost-ledger.sqlite');
    let measure = new VectorProjectionJournal(measureFile); measure.close();
    const bytesBefore = fs.statSync(measureFile).size;
    measure = new VectorProjectionJournal(measureFile);
    for (let i=0; i<10; i++) measure.prepare(node,v2,identity);
    assert.equal(measure.stats().prepared,10); measure.close();
    const bytesAfter = fs.statSync(measureFile).size;
    console.log(JSON.stringify({ same_payload_V1_V2_cursor_reopen: true, latest_local_vector_exact: true,
        canonical_event_binding: true, real_V2_fault_metadata_reuses_active_V2: true, bulk_existing_generation_coherent: true, stale_receipt_vector_rejected: true, old_schema_additive_upgrade_preserves_node: true, stale_event_superseded: true, identical_attempt_events: 10,
        actual_ledger_bytes_before: bytesBefore, actual_ledger_bytes_after: bytesAfter,
        actual_added_bytes: bytesAfter-bytesBefore, mirror: 'disabled; final Qdrant acceptance NOT RUN' }));
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
