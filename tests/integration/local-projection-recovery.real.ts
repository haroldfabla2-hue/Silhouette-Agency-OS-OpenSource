import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { createHash } from 'node:crypto';
import { LanceDbService } from '../../services/lancedbService.ts';
import { UnifiedVectorMemory } from '../../services/unifiedVectorMemory.ts';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
import { CodebaseAwarenessService } from '../../services/codebaseAwareness.ts';
const root = process.env.UNIFIED_MEMORY_TEST_DIR;
assert.ok(root?.includes('/qdrant-eval-'));
const directory = path.join(root, `local-projection-fault-${process.pid}`);
const target = new VectorMemoryService({ enabled: async () => false });
const identity = { model: 'PUBLIC_REAL_FILESYSTEM_FAILURE', version: '1', dimension: 768 };
const vector = Array(768).fill(0); vector[0] = 1;
const table = 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
const obstruction = path.join(directory, table + '.lance');
(async () => {
    const canonical = new LanceDbService(directory, target);
    await canonical.ensureInitialized();
    // Real filesystem fault: table path is a regular file, so LanceDB cannot
    // create its projection directory. No service method is mocked/replaced.
    fs.writeFileSync(obstruction, 'PUBLIC TEST OBSTRUCTION');
    const memory = new UnifiedVectorMemory(canonical);
    const code = new CodebaseAwarenessService({ memory, embed: async () => ({ vector, identity }) }, false);
    const file: any = { id: 'PUBLIC_FAILED_CODE', name: 'public.ts', type: 'FILE', content: 'export const publicRecovery = "retained canonical";' };
    await assert.rejects(() => code.indexFile(file));
    assert.equal(await canonical.getNodeById('code_file_version:' + file.id), null, 'failed projection must not activate file');
    const retained = (await canonical.getAllNodes()).find(n => n.content.includes('publicRecovery'));
    assert.ok(retained, 'canonical copy survives failed projection');
    fs.unlinkSync(obstruction); // Delete ONLY the identified public-test obstruction.
    const reopened = new LanceDbService(directory, target);
    await reopened.replayVectorProjections(50); // Qdrant remains disabled.
    const connection = await lancedb.connect(directory);
    const repairedTable = await connection.openTable(table);
    assert.equal(await repairedTable.countRows(), 1, 'replay itself repaired local projection before index retry');
    const repairedRows = await repairedTable.query().toArray();
    assert.equal(JSON.parse(repairedRows[0].json_data).content, retained.content);
    const restored = await new UnifiedVectorMemory(reopened).searchMemory(vector, 50, undefined, identity);
    // Code is intentionally not active until indexing retries its full commit.
    assert.equal(restored.length, 0);
    assert.ok((await reopened.getNodeById(retained.id))?.content.includes('publicRecovery'));
    const retry = new CodebaseAwarenessService({ memory: new UnifiedVectorMemory(reopened), embed: async () => ({ vector, identity }) }, false);
    await retry.indexFile(file);
    assert.ok((await retry.query('public')).includes('retained canonical'));
    console.log(JSON.stringify({ real_filesystem_fault: true, failed_index_not_activated: true, canonical_preserved: true,
        replay_with_qdrant_disabled: true, recovered_after_reopen_and_retry: true }));
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
