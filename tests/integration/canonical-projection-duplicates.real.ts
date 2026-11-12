import assert from 'node:assert/strict';
import * as lance from '@lancedb/lancedb';
import { createHash } from 'node:crypto';
import { LanceDbService } from '../../services/lancedbService';
const root = process.argv[2];
const identity = { model: 'PUBLIC_DUPLICATE_PROJECTION', version: '1', dimension: 3 };
const name = 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,24);
const node = (id: string) => ({ id, content: 'Public ' + id, ownerId: 'ALICE', tags: ['PUBLIC'],
    embeddingIdentity: identity, tier: 'DEEP', timestamp: 1, importance: .1, accessCount: 0, lastAccess: 1 });
const a = node('PUBLIC_DUP_A'), b = node('PUBLIC_DUP_B'), c = node('PUBLIC_DUP_C');
const db = await lance.connect(root);
await db.createTable('memory_records_v2', [a,b,c].map(n => ({ id:n.id, ownerId:n.ownerId, json_data:JSON.stringify(n) })));
const row = (n: any, vector: number[]) => ({ id:n.id, ownerId:'ALICE', json_data:JSON.stringify(n), vector });
const table = await db.createTable(name, [
    row(a,[0,1,0]), row({...a,content:'Public stale high score'},[1,0,0]),
    row({...a,ownerId:'BOB'},[1,0,0]), row(b,[.8,.6,0]), row(c,[.1,.99,0]),
]);
const service = new LanceDbService(root);
for (const page of ['2','25000']) {
    process.env.LANCEDB_SCAN_PAGE_ROWS=page;
    assert.deepEqual((await service.search([1,0,0],3,undefined,identity)).map(n=>n.id),[b.id,c.id,a.id]);
    assert.deepEqual((await service.search([1,0,0],2,"`ownerId` = 'ALICE'",identity)).map(n=>n.id),[b.id,c.id]);
}
// More coherent duplicate projections than one window, not a unique-ID schema.
await table.add(Array.from({length:300},()=>row(a,[1,0,0])));
for (const limit of [3,300]) {
    const hits=await service.search([1,0,0],limit,undefined,identity);
    assert.deepEqual(hits.map(n=>n.id),[a.id,b.id,c.id]);
    assert.equal(new Set(hits.map(n=>n.id)).size,hits.length);
}
console.log('PUBLIC_DUPLICATE_PROJECTION_PASS');
