import assert from 'node:assert/strict';
import * as lance from '@lancedb/lancedb';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const root = process.argv[2];
assert.ok(!fs.existsSync(root));
const identity = { model: 'PUBLIC_WINDOW_EQUIVALENCE', version: '1', dimension: 4 };
const db = await lance.connect(root);
const vector = [1, 0, 0, 0];
const nodes = Array.from({ length: 900 }, (_, i) => ({ id: 'PUBLIC_EQ_' + i, content: 'Public ' + i, embeddingIdentity: identity, ownerId: i % 2 ? 'BOB' : 'ALICE', tags: ['PUBLIC'], tier: 'DEEP', timestamp: 1, importance: 0.1, accessCount: 0, lastAccess: 1 }));
await db.createTable('memory_records_v2', nodes.map((n, i) => ({ id: n.id, ownerId: n.ownerId, json_data: JSON.stringify(i < 513 ? { ...n, content: n.content + ' stale' } : n) })));
await db.createTable('memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24), nodes.map(n => ({ id: n.id, ownerId: n.ownerId, json_data: JSON.stringify(n), vector })));
const { LanceDbService } = await import(new URL('../../services/lancedbService.ts', import.meta.url).href);
const service = new LanceDbService(root);
const start = performance.now();
for (const page of ['256', '25000']) {
    process.env.LANCEDB_SCAN_PAGE_ROWS = page;
    for (const [filter, k] of [[undefined, 10], [undefined, 300], ["`ownerId` = 'ALICE'", 10], ["id = 'PUBLIC_EQ_899'", 1]] as const) {
        const hits = await service.search(vector, k, filter, identity);
        const expected = nodes.slice(513).filter(n => !filter || (filter.includes('ALICE') ? n.ownerId === 'ALICE' : n.id === 'PUBLIC_EQ_899')).sort((a, b) => a.id.localeCompare(b.id)).slice(0, k);
        assert.deepEqual(hits, expected);
    }
}
console.log(JSON.stringify({ equalScoreStaleScopeLatePageCases: 8, pass: true, ms: performance.now() - start }));
// All stale, same full corpus. Both must exhaust candidates and return empty.
const canonical = await db.openTable('memory_records_v2');
await canonical.update({ values: { json_data: '{malformed' } });
const allStale = new LanceDbService(root);
process.env.LANCEDB_SCAN_PAGE_ROWS = '25000';
const staleStart = performance.now();
assert.deepEqual(await allStale.search(vector, 10, undefined, identity), []);
console.log(JSON.stringify({ allStaleReturned: 0, allStaleMs: performance.now() - staleStart }));
