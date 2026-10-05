/** Actual repository text, actual embeddings, real disk-backed LanceDB exact and IVF queries.
 * Lexical hash baseline only: these measurements do not validate a neural provider or production cutover.
 */
import { readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cpus } from 'node:os';
import * as lancedb from '@lancedb/lancedb';
import { MemoryTier, type MemoryNode } from '../types';
import { LanceDbService } from '../services/lancedbService';
import { LexicalHashProvider, MemoryProjectionRollout } from '../services/memoryProjectionRollout';
async function collect(path: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) result.push(...await collect(full));
        else if (/\.(ts|tsx|md)$/.test(entry.name)) {
            const words = (await readFile(full, 'utf8')).split(/\s+/);
            for (let i = 0; i + 60 <= words.length; i += 60) result.push(words.slice(i, i + 60).join(' '));
        }
    }
    return result;
}
const size = Number(process.argv[2] || 4952);
const unique = [...new Set([...(await collect('services')), ...(await collect('docs')), ...(await collect('server'))])];
if (!Number.isInteger(size) || size < 100 || size > unique.length) throw new Error(`Requested ${size}; unique repository passages available ${unique.length}`);
const passages = unique.slice(0, size);
const path = await mkdtemp(join(tmpdir(), 'agency-benchmark-'));
try {
    const conn = await lancedb.connect(path);
    const records = passages.map((content, i) => {
        const n: MemoryNode = { id: `bench-${i}`, content, timestamp: i + 1, ownerId: 'benchmark', tags: [], tier: MemoryTier.MEDIUM, importance: 0.5, accessCount: 0, lastAccess: i + 1 };
        return { id: n.id, content, originalContent: '', tags: [''], importance: n.importance, timestamp: n.timestamp, tier: n.tier, ownerId: n.ownerId!, accessCount: 0, lastAccess: n.lastAccess, stabilityScore: 0, embedding_state: 'EMBEDDING_PENDING', json_data: JSON.stringify(n) };
    });
    await conn.createTable('memory_records_v2', records);
    const db = new LanceDbService(path), provider = new LexicalHashProvider(64);
    const rollout = new MemoryProjectionRollout(path, db, { backfill: true, annShadow: true });
    const backfill = await rollout.backfill(provider, size);
    const index = await rollout.trainAnn(provider.identity, 32);
    const queries = await provider.embed(Array.from({ length: 110 }, (_, i) => passages[Math.floor(i * size / 110)].split(/\s+/).slice(0, 20).join(' ')));
    const comparisons = [];
    for (const q of queries) comparisons.push(await rollout.shadow(q, provider.identity, 10, { ownerId: 'benchmark' }));
    const measured = comparisons.slice(10);
    const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    const result = { corpus: 'unique non-overlapping 60-word passages from services/docs/server on this branch', corpusSize: size,
        embedding: provider.identity, index, backfill, queries: measured.length, warmupQueries: 10, k: 10, nprobes: 8,
        recallAt10: measured.reduce((s, c) => s + c.recallAtK, 0) / measured.length,
        exactP95Ms: p95(measured.map(c => c.exactMs)), annP95Ms: p95(measured.map(c => c.annMs)),
        measurement: 'raw projection candidates including connection/table-open time; excludes canonical hydration and provider latency',
        environment: { node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length },
        caveats: 'lexical hash baseline, not neural semantic quality; source-derived queries are not held-out relevance labels; no production rollout' };
    console.log(JSON.stringify(result, null, 2));
    if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n');
} finally { await rm(path, { recursive: true, force: true }); }
