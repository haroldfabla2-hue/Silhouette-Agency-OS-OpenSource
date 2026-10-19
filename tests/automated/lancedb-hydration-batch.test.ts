import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { LanceDbService } from '../../services/lancedbService';
import type { EmbeddingIdentity } from '../../services/memoryRetrieval';

const IDENTITY: EmbeddingIdentity = { model: 'gemini-embedding-001', version: '1', dimension: 768 };
const TABLE_NAME = 'memory_vectors_' + createHash('sha256').update(JSON.stringify(IDENTITY)).digest('hex').slice(0, 24);

function unitVector(dim: number, seed: number): number[] {
    const v = Array.from({ length: dim }, (_, i) => ((i * 31 + seed * 17) % 13) / 13);
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    return v.map(x => x / norm);
}

function fakeQuery(rows: any[], counter: { queries: number }) {
    return {
        where() { return this; },
        limit() { return this; },
        async toArray() { counter.queries++; return rows; }
    };
}

function makeService(opts: { projectionRows: any[]; canonicalRows: any[] }) {
    const canonicalCounter = { queries: 0 };
    const projectionCounter = { queries: 0 };
    const canonicalTable = { query: () => fakeQuery(opts.canonicalRows, canonicalCounter) };
    const projectionTable = {
        countRows: async () => opts.projectionRows.length,
        query: () => fakeQuery(opts.projectionRows, projectionCounter)
    };
    const fakeDb = {
        async tableNames() { return [TABLE_NAME]; },
        async openTable(name: string) {
            if (name === TABLE_NAME) return projectionTable;
            return canonicalTable;
        }
    };
    const svc = new LanceDbService('/tmp/nonexistent-lancedb-test') as any;
    svc.db = fakeDb;
    svc.table = canonicalTable;
    svc.legacyTable = null;
    svc.initialized = true;
    return { svc, canonicalCounter };
}

describe('LanceDbService batched hydration', () => {
    it('hydrates 50 ranked results with a single canonical query (not 50 full scans)', async () => {
        const n = 50;
        const nodes = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, content: `memory ${i}` }));
        const projectionRows = nodes.map((node, i) => ({ id: node.id, vector: unitVector(768, i + 1) }));
        const canonicalRows = nodes.map(node => ({ id: node.id, json_data: JSON.stringify(node) }));
        const { svc, canonicalCounter } = makeService({ projectionRows, canonicalRows });

        const results = await svc.search(unitVector(768, 0), n, undefined, IDENTITY);

        expect(results.length).toBe(n);
        expect(canonicalCounter.queries).toBe(1);
    });

    it('preserves cosine ranking order in the hydrated results', async () => {
        const query = unitVector(768, 0);
        const near = { id: 'near', content: 'close' };
        const far = { id: 'far', content: 'distant' };
        const projectionRows = [
            { id: far.id, vector: unitVector(768, 999) },
            { id: near.id, vector: [...query] }
        ];
        const canonicalRows = [near, far].map(node => ({ id: node.id, json_data: JSON.stringify(node) }));
        const { svc } = makeService({ projectionRows, canonicalRows });

        const results = await svc.search(query, 2, undefined, IDENTITY);

        expect(results.map((r: any) => r.id)).toEqual(['near', 'far']);
    });

    it('throws on duplicate memory ids instead of silently picking one', async () => {
        const projectionRows = [{ id: 'dup', vector: unitVector(768, 1) }];
        const canonicalRows = [
            { id: 'dup', json_data: '{"id":"dup","content":"a"}' },
            { id: 'dup', json_data: '{"id":"dup","content":"b"}' }
        ];
        const { svc } = makeService({ projectionRows, canonicalRows });

        await expect(svc.search(unitVector(768, 0), 1, undefined, IDENTITY)).rejects.toThrow('Duplicate memory ID');
    });

    it('returns [] when the projection table for the identity does not exist', async () => {
        const { svc } = makeService({ projectionRows: [], canonicalRows: [] });
        svc.db = { async tableNames() { return []; }, async openTable() { throw new Error('no table'); } };
        const results = await svc.search(unitVector(768, 0), 5, undefined, IDENTITY);
        expect(results).toEqual([]);
    });
});
