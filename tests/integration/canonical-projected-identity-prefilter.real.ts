import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as lance from '@lancedb/lancedb';
import { LanceDbService } from '../../services/lancedbService';
const [root, mode = 'projected-wrong'] = process.argv.slice(2);
const identity = { model: 'PUBLIC_PREFILTER_A', version: '1', dimension: 768 };
const wrong = { ...identity, model: 'PUBLIC_PREFILTER_B' };
const vector = Array(768).fill(0); vector[0] = 1;
const node = (i: number, embeddingIdentity = identity) => ({ id: 'PUBLIC_PREFILTER_' + i,
    content: 'Public fixture '.repeat(20) + i, embeddingIdentity, ownerId: 'PUBLIC', tags: ['PUBLIC'],
    tier: 'DEEP', timestamp: 1, importance: .1, accessCount: 0, lastAccess: 1 });
const db = await lance.connect(root);
const tableName = 'memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,24);
const nodes = Array.from({ length: 5199 }, (_, i) => node(i));
const canonical = await db.createTable('memory_records_v2', nodes.map((n,i) => ({ id:n.id,
    ownerId:n.ownerId, json_data:JSON.stringify(i<4408 && mode==='canonical-wrong' ? {...n,embeddingIdentity:wrong}:n) })));
const projections = nodes.slice(0,4418).map((n,i) => ({ id:n.id, ownerId:n.ownerId, vector,
    json_data:JSON.stringify(i<4408 && mode==='projected-wrong' ? {...n,embeddingIdentity:wrong}:n) }));
await db.createTable(tableName, projections);
// Real fragments make repeated canonical scans visible without changing corpus size.
for (let i=0;i<nodes.length;i+=20) {
    const rows = nodes.slice(i,i+20).map((n,j) => ({ id:n.id, ownerId:n.ownerId,
        json_data:JSON.stringify(i+j<4408 && mode==='canonical-wrong'?{...n,embeddingIdentity:wrong}:n) }));
    await canonical.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
}
const state = async () => {
    const out = [];
    for (const name of await db.tableNames()) {
        const t=await db.openTable(name);out.push([name,await t.version(),await t.countRows()]);
    }
    return JSON.stringify(out);
};
const before=await state();
const service=new LanceDbService(root); const timings=[];
for(let i=0;i<3;i++) {
    const start=performance.now();const hits=await service.search(vector,10,undefined,identity);
    assert.deepEqual(hits.map(n=>n.id),nodes.slice(4408,4418).map(n=>n.id).sort((a,b)=>a.localeCompare(b)));
    timings.push(performance.now()-start);
}
assert.equal(await state(),before);
const result={mode,canonical:5199,projection:4418,lateValidReturned:10,timingsMs:timings,
    maxRssKiB:process.resourceUsage().maxRSS,sourceReadOnly:true};
fs.writeFileSync(root+'/../result-'+mode+'.json',JSON.stringify(result));console.log(JSON.stringify(result));
