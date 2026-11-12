import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as lancedb from '@lancedb/lancedb';
import { LanceDbService } from '../../services/lancedbService.ts';
import { UnifiedVectorMemory } from '../../services/unifiedVectorMemory.ts';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
import { MemoryTier } from '../../types.ts';
const root = process.env.UNIFIED_MEMORY_TEST_DIR;
assert.ok(root?.includes('/qdrant-eval-'));
const directory = path.join(root, `ordering-${process.pid}`);
const identity = { model: 'PUBLIC_ORDERING_FIXTURE', version: '1', dimension: 768 };
const vector = Array(768).fill(0); vector[0] = 1;
const other = Array(768).fill(0); other[1] = 1;
const target = new VectorMemoryService({ enabled: async () => false });
let reached!: () => void; let release!: () => void;
const checkpointReached = new Promise<void>(resolve => { reached = resolve; });
const barrier = new Promise<void>(resolve => { release = resolve; });
let paused = false;
(async () => {
    const oldWriter = new LanceDbService(directory, target, async () => {
        if (!paused) { paused = true; reached(); await barrier; }
    });
    const node: any = { id: 'PUBLIC_SAME_ID', content: 'Public old content', tags: [], timestamp: 1, importance: 0.5,
        tier: MemoryTier.DEEP, decayHealth: 100, accessCount: 0, lastAccess: 1, compressionLevel: 0, embeddingIdentity: identity };
    await oldWriter.store(node, vector);
    const replay = oldWriter.replayVectorProjections(50);
    await checkpointReached; // Test-only scheduling barrier, no mocked I/O.
    const newWriter = new LanceDbService(directory, target);
    let newCommitted = false;
    const newer = newWriter.store({ ...node, content: 'Public NEW canonical content', timestamp: 2 }, other).then(() => { newCommitted = true; });
    await Promise.resolve();
    assert.equal(newCommitted, false, 'write waits behind verified-source replay boundary');
    release(); await Promise.all([replay, newer]);
    const memory = new UnifiedVectorMemory(newWriter);
    const hits = await memory.searchMemory(other, 10, undefined, identity);
    assert.equal(hits[0]?.payload.content, 'Public NEW canonical content');
    assert.ok(hits[0]?.score > 0.99, 'new vector cannot be replaced by old replay');
    await assert.rejects(() => oldWriter.ensureLocalVectorProjection(node, vector, identity), /Canonical version changed/);
    assert.ok((await memory.searchMemory(other, 10, undefined, identity))[0]?.score > 0.99, 'stale consumer receipt cannot overwrite newer committed vector');
    const connection = await lancedb.connect(directory);
    const name = 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
    const versions = async () => ({ vector: await (await connection.openTable(name)).version(), canonical: await (await connection.openTable('memory_records_v2')).version() });
    const before = await versions();
    for (let i = 0; i < 3; i++) await newWriter.replayVectorProjections(50);
    const reopened = new LanceDbService(directory, target);
    await reopened.replayVectorProjections(50);
    assert.deepEqual(await versions(), before, 'down mirror must not append identical Lance versions after local receipt, including reopen');
    assert.equal(await (await connection.openTable(name)).countRows(), 1);
    console.log(JSON.stringify({ deterministic_barrier: true, same_database_two_instances_serialized: true,
        newer_content_and_vector_retained: true, down_mirror_replays: 4, local_versions_stable_across_reopen: true }));
    process.exit(0);
})().catch(error => { release?.(); console.error(error); process.exit(1); });
