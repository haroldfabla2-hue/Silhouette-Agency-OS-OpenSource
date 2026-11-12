import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as lance from '@lancedb/lancedb';
const [mode, root, source = new URL('../../services/lancedbService.ts', import.meta.url).pathname] = process.argv.slice(2);
const identity = { model: 'PUBLIC_MEMORY_SCALE', version: '1', dimension: 768 };
const vector = Array(768).fill(0);
vector[0] = 1;
if (mode === 'seed') {
    if (fs.existsSync(root))
        throw Error('Existing fixture');
    const db = await lance.connect(root);
    const nodes = Array.from({ length: 5199 }, (_, i) => ({ id: 'PUBLIC_SCALE_' + i, content: 'Public performance fixture content '.repeat(20) + i, embeddingIdentity: identity, embeddingVector: vector, ownerId: 'PUBLIC', tags: ['PUBLIC'], tier: 'DEEP', timestamp: 1, importance: 0.1, accessCount: 0, lastAccess: 1 }));
    await db.createTable('memory_records_v2', nodes.map((n, i) => ({ id: n.id, content: n.content, ownerId: n.ownerId, tags: n.tags, tier: n.tier, embedding_state: 'READY', json_data: JSON.stringify(i < 512 ? { ...n, embeddingIdentity: { ...identity, model: 'PUBLIC_STALE_OTHER' } } : n) })));
    await db.createTable('memory_vectors_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24), nodes.slice(0, 4418).map((n, i) => ({ id: n.id, ownerId: n.ownerId, vector: i < 512 || i >= 4408 ? vector : vector.map((v, j) => j === 0 ? 0.8 : j === 1 ? 0.6 : 0), json_data: JSON.stringify(n) })));
    console.log('SEEDED_PUBLIC_COUNTS', 5199, 4418);
    process.exit();
}
const { LanceDbService } = await import(pathToFileURL(source).href);
const service = new LanceDbService(root);
const connection = await lance.connect(root);
const snapshot = async () => { const out = []; for (const name of await connection.tableNames()) {
    const t = await connection.openTable(name);
    out.push([name, await t.version(), await t.countRows()]);
} return JSON.stringify(out); };
const before = await snapshot();
const results = [];
for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const hits = await service.search(vector, 10, undefined, identity);
    if (hits.length !== 10 || !hits.every(n => Number(n.id.split('_').pop()) >= 4408))
        throw Error('Late-page valid top-k recall control');
    results.push({ ms: performance.now() - start, returned: hits.length, rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed });
}
if (before !== await snapshot())
    throw Error('Read changed table versions/counts');
console.log(JSON.stringify({ scaleReadPass: true, page: process.env.LANCEDB_SCAN_PAGE_ROWS, results, maxRssKiB: process.resourceUsage().maxRSS, fixtureCanonical: 5199, fixtureProjection: 4418 }));
