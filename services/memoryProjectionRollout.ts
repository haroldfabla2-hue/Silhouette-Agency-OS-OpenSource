import * as lancedb from '@lancedb/lancedb';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { LanceDbService } from './lancedbService';
import { validEmbedding, inScope, scopeSql, type MemoryScope, type EmbeddingIdentity } from './memoryRetrieval';
import type { MemoryNode } from '../types';

export interface ProviderIdentity extends EmbeddingIdentity { provider: string }
export interface EmbeddingProvider {
    identity: ProviderIdentity;
    embed(texts: string[]): Promise<number[][]>;
}
export interface ProjectionRow { [key: string]: unknown; id: string; ownerId: string; fingerprint: string; vector: number[] }
export interface ShadowComparison {
    exactIds: string[]; annIds: string[]; recallAtK: number;
    exactMs: number; annMs: number; requestedK: number; referenceCount: number;
}
const fingerprint = (n: MemoryNode) => createHash('sha256').update(JSON.stringify([n.content, n.ownerId || 'system', n.timestamp, n.tags])).digest('hex');
const identityKey = (i: ProviderIdentity) => {
    if (typeof i.provider !== 'string' || !i.provider.trim() || !i.model || !i.version || !Number.isInteger(i.dimension) || i.dimension < 1 || i.dimension > 65536) throw new Error('Explicit provider/model/version/dimension required');
    return createHash('sha256').update(JSON.stringify([i.provider, i.model, i.version, i.dimension])).digest('hex').slice(0, 24);
};

/** Opt-in projection. Exact remains the default, even after an index is built. */
export class MemoryProjectionRollout {
    private queue: Promise<void> = Promise.resolve();
    constructor(private readonly path: string, private readonly canonical: LanceDbService,
        private readonly flags = { backfill: false, annShadow: false }) {}
    private async table(identity: ProviderIdentity): Promise<lancedb.Table | null> {
        const db = await lancedb.connect(this.path);
        const name = 'rollout_vectors_' + identityKey(identity);
        return (await db.tableNames()).includes(name) ? db.openTable(name) : null;
    }
    /** Batch writes are serialized; callers cannot smuggle arbitrary rows past canonical verification. */
    public backfill(provider: EmbeddingProvider, limit = 100, scope: MemoryScope = {}): Promise<{ projected: number; stale: number; remaining: number }> {
        if (!this.flags.backfill) return Promise.reject(new Error('Backfill flag is disabled'));
        if (!Number.isInteger(limit) || limit < 1 || limit > 10000) return Promise.reject(new Error('Invalid batch size'));
        identityKey(provider.identity);
        const run = this.queue.then(async () => {
            const existing = await this.table(provider.identity);
            const projected = existing ? await existing.query().limit(await existing.countRows()).toArray() : [];
            const byId = new Map(projected.map(r => [r.id, r.fingerprint]));
            const pending = (await this.canonical.getAllNodes()).filter(n => inScope(n, scope) && byId.get(n.id) !== fingerprint(n));
            const batch = pending.slice(0, limit);
            if (!batch.length) return { projected: 0, stale: 0, remaining: 0 };
            const vectors = await provider.embed(batch.map(n => n.content));
            if (vectors.length !== batch.length || vectors.some(v => !validEmbedding(v, provider.identity))) throw new Error('Provider returned incompatible embeddings');
            const rows: ProjectionRow[] = [];
            let stale = 0;
            for (let i = 0; i < batch.length; i++) {
                const current = await this.canonical.getNodeById(batch[i].id);
                if (!current || fingerprint(current) !== fingerprint(batch[i]) || !inScope(current, scope)) { stale++; continue; }
                rows.push({ id: current.id, ownerId: current.ownerId || 'system', fingerprint: fingerprint(current), vector: vectors[i] });
            }
            if (rows.length) {
                const db = await lancedb.connect(this.path);
                const table = existing || await db.createTable('rollout_vectors_' + identityKey(provider.identity), rows);
                if (existing) await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
            }
            return { projected: rows.length, stale, remaining: pending.length - rows.length };
        });
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
    public async trainAnn(identity: ProviderIdentity, partitions = 16): Promise<{ rows: number; partitions: number }> {
        if (!this.flags.annShadow) throw new Error('ANN shadow flag is disabled');
        await this.queue;
        const table = await this.table(identity);
        if (!table) throw new Error('Projection missing');
        const rows = await table.countRows();
        if (!Number.isInteger(partitions) || partitions < 1 || rows < partitions * 32) throw new Error('Insufficient training rows or invalid partitions');
        await table.createIndex('vector', { config: lancedb.Index.ivfFlat({ distanceType: 'cosine', numPartitions: partitions }), replace: true });
        return { rows, partitions };
    }
    /** Raw projection candidates for benchmark use. Never treated as canonical evidence. */
    public async candidates(vector: number[], identity: ProviderIdentity, k = 10, scope: MemoryScope = {}, mode: 'exact' | 'ann' = 'exact', probes = 8): Promise<ProjectionRow[]> {
        if (!validEmbedding(vector, identity) || !Number.isInteger(k) || k < 1 || k > 1000) throw new Error('Invalid query');
        if (mode === 'ann' && !this.flags.annShadow) throw new Error('ANN shadow flag is disabled');
        const table = await this.table(identity);
        if (!table) return [];
        if (mode === 'ann' && !(await table.listIndices()).some(index => index.columns.includes('vector'))) throw new Error('ANN index has not been trained');
        if (!Number.isInteger(probes) || probes < 1) throw new Error('Invalid probe count');
        let query = table.vectorSearch(vector).distanceType('cosine').where(scopeSql(scope)).limit(k);
        query = mode === 'exact' ? query.bypassVectorIndex() : query.nprobes(probes);
        return await query.toArray() as ProjectionRow[];
    }
    /** Revalidates owner, hypothesis status, deletion and source revision against canonical memory. */
    public async search(vector: number[], identity: ProviderIdentity, k = 10, scope: MemoryScope = {}, mode: 'exact' | 'ann' = 'exact'): Promise<MemoryNode[]> {
        if (!Number.isInteger(k) || k < 1 || k > 1000) throw new Error('Invalid result limit');
        const rows = await this.candidates(vector, identity, Math.min(1000, k * 3), scope, mode);
        const nodes: MemoryNode[] = [];
        for (const row of rows) {
            const n = await this.canonical.getNodeById(row.id);
            if (n && fingerprint(n) === row.fingerprint && inScope(n, scope)) nodes.push(n);
        }
        return nodes.slice(0, k);
    }
    public async shadow(vector: number[], identity: ProviderIdentity, k = 10, scope: MemoryScope = {}, probes = 8): Promise<ShadowComparison> {
        const start = performance.now();
        const exact = await this.candidates(vector, identity, k, scope, 'exact');
        const middle = performance.now();
        const ann = await this.candidates(vector, identity, k, scope, 'ann', probes);
        const end = performance.now();
        const exactIds = exact.map(r => r.id), annIds = ann.map(r => r.id);
        return { exactIds, annIds, recallAtK: exactIds.length ? annIds.filter(id => exactIds.includes(id)).length / exactIds.length : 0,
            exactMs: middle - start, annMs: end - middle, requestedK: k, referenceCount: exactIds.length };
    }
}

/** Real deterministic lexical hash embedding baseline. NOT a neural semantic model. */
export class LexicalHashProvider implements EmbeddingProvider {
    readonly identity: ProviderIdentity;
    constructor(dimension = 64) { this.identity = { provider: 'local-lexical-hash', model: 'token-sha256', version: '1', dimension }; }
    async embed(texts: string[]): Promise<number[][]> {
        return texts.map(text => {
            const vector = Array(this.identity.dimension).fill(0) as number[];
            for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
                const hash = createHash('sha256').update(token).digest();
                vector[hash.readUInt32LE(0) % vector.length] += hash[4] & 1 ? 1 : -1;
            }
            if (!vector.some(v => v !== 0)) throw new Error('No nonzero lexical embedding');
            return vector;
        });
    }
}
