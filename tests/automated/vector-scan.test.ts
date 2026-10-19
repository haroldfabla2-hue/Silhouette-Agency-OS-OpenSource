import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cosineSimilarity, rankByCosine, maxVectorScanRows, cpuSupportsNativeVectorKernels, DEFAULT_MAX_VECTOR_SCAN_ROWS } from '../../services/vectorScan';
import { lancedbService } from '../../services/lancedbService';
import { scopeSql, type EmbeddingIdentity } from '../../services/memoryRetrieval';
import { MemoryTier } from '../../types';

describe('vectorScan cosine helpers', () => {
    it('computes cosine similarity for comparable vectors', () => {
        expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
        expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
        expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
        expect(cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1);
    });
    it('rejects incomparable vectors instead of producing NaN', () => {
        expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
        expect(cosineSimilarity([], [])).toBeNull();
        expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
        expect(cosineSimilarity([NaN, 0], [1, 0])).toBeNull();
    });
    it('ranks rows by score, honors the limit and skips incomparable rows', () => {
        const rows = [
            { id: 'orthogonal', vector: [0, 1] },
            { id: 'aligned', vector: [2, 0] },
            { id: 'near', vector: [1, 0.1] },
            { id: 'mismatch', vector: [1, 0, 0] },
        ];
        const ranked = rankByCosine(rows, [1, 0], 2);
        expect(ranked.map(r => r.id)).toEqual(['aligned', 'near']);
        expect(ranked[0]._score).toBeGreaterThan(ranked[1]._score);
        expect((rows[1] as any)._score).toBeUndefined(); // input rows are not mutated
    });
    it('reads arrow-style vector cells (toArray / iterable), where numeric indexing fails', () => {
        const arrowLike = { length: 2, toArray: () => Float32Array.from([1, 0]) };
        expect((arrowLike as any)[0]).toBeUndefined(); // reproduces the LanceDB scan pitfall
        const rows = [
            { id: 'arrow', vector: arrowLike },
            { id: 'plain', vector: [0, 1] },
        ];
        const ranked = rankByCosine(rows, [1, 0], 2);
        expect(ranked.map(r => r.id)).toEqual(['arrow', 'plain']);
    });
});

describe('vectorScan scan cap', () => {
    it('defaults and honors a positive env override', () => {
        expect(maxVectorScanRows({} as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_VECTOR_SCAN_ROWS);
        expect(maxVectorScanRows({ LANCEDB_SCAN_MAX_ROWS: '5000' } as NodeJS.ProcessEnv)).toBe(5000);
        expect(maxVectorScanRows({ LANCEDB_SCAN_MAX_ROWS: '-3' } as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_VECTOR_SCAN_ROWS);
        expect(maxVectorScanRows({ LANCEDB_SCAN_MAX_ROWS: 'abc' } as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_VECTOR_SCAN_ROWS);
    });
});

describe('native vector kernel preflight', () => {
    it('detects AVX from cpuinfo content and fails safe when unreadable', () => {
        const dir = mkdtempSync(join(tmpdir(), 'cpuinfo-'));
        try {
            const withAvx = join(dir, 'with');
            const withoutAvx = join(dir, 'without');
            writeFileSync(withAvx, 'processor\t: 0\nflags\t\t: fpu sse sse2 avx avx2 avx512f\n');
            writeFileSync(withoutAvx, 'processor\t: 0\nflags\t\t: fpu sse sse2\n');
            expect(cpuSupportsNativeVectorKernels(withAvx)).toBe(true);
            expect(cpuSupportsNativeVectorKernels(withoutAvx)).toBe(false);
            expect(cpuSupportsNativeVectorKernels(join(dir, 'missing'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('LanceDbService semantic search via portable JS scan', () => {
    const identity: EmbeddingIdentity = { model: 'scan-test', version: '1', dimension: 4 };
    const node = (id: string, ownerId: string) => ({
        id, ownerId, content: `content of ${id}`, originalContent: '',
        tags: ['scan-test'], importance: 0.5, timestamp: Date.now(),
        tier: MemoryTier.DEEP, accessCount: 0, lastAccess: Date.now(), stabilityScore: 0,
    });
    afterEach(() => { delete process.env.LANCEDB_SCAN_MAX_ROWS; delete process.env.LANCEDB_SCAN_PAGE_ROWS; delete process.env.VECTOR_ENGINE; });

    it('returns cosine-ranked nodes, applies SQL scope filters and honors the scan cap', async () => {
        await lancedbService.store(node('scan-a', 'alice') as any);
        await lancedbService.store(node('scan-b', 'alice') as any);
        await lancedbService.store(node('scan-c', 'bob') as any);
        await lancedbService.projectEmbedding(node('scan-a', 'alice') as any, [1, 0, 0, 0], identity);
        await lancedbService.projectEmbedding(node('scan-b', 'alice') as any, [0.9, 0.1, 0, 0], identity);
        await lancedbService.projectEmbedding(node('scan-c', 'bob') as any, [0, 1, 0, 0], identity);

        const ranked = await lancedbService.search([1, 0, 0, 0], 10, undefined, identity);
        expect(ranked.map(n => n.id)).toEqual(['scan-a', 'scan-b', 'scan-c']);

        const scoped = await lancedbService.search([1, 0, 0, 0], 10, scopeSql({ ownerId: 'alice' }), identity);
        expect(scoped.map(n => n.id)).toEqual(['scan-a', 'scan-b']);

        // Paged scan never drops rows: force the scan engine on a fresh instance
        // (the shared singleton already picked the ANN engine) and page size 1
        // over 3 vectors must still return all 3, ranked.
        process.env.VECTOR_ENGINE = 'scan';
        process.env.LANCEDB_SCAN_PAGE_ROWS = '1';
        const { LanceDbService } = await import('../../services/lancedbService');
        const { mkdtempSync } = await import('node:fs');
        const { join: joinPath } = await import('node:path');
        const { tmpdir: tmpd } = await import('node:os');
        const fresh = new LanceDbService(joinPath(mkdtempSync(joinPath(tmpd(), 'paged-')), 'db.lancedb'));
        await fresh.store(node('paged-a', 'alice') as any);
        await fresh.store(node('paged-b', 'alice') as any);
        await fresh.store(node('paged-c', 'bob') as any);
        await fresh.projectEmbedding(node('paged-a', 'alice') as any, [1, 0, 0, 0], identity);
        await fresh.projectEmbedding(node('paged-b', 'alice') as any, [0.9, 0.1, 0, 0], identity);
        await fresh.projectEmbedding(node('paged-c', 'bob') as any, [0, 1, 0, 0], identity);
        expect((await fresh.search([1, 0, 0, 0], 10, undefined, identity)).map(n => n.id)).toEqual(['paged-a', 'paged-b', 'paged-c']);
        delete process.env.VECTOR_ENGINE;
    });

    it('ranks knowledge rows without the native vector path', async () => {
        const aligned = new Array(768).fill(0); aligned[0] = 1;
        const orthogonal = new Array(768).fill(0); orthogonal[1] = 1;
        await lancedbService.ensureKnowledgeTable();
        await lancedbService.storeKnowledge({ id: 'k-aligned', content: 'aligned', vector: aligned });
        await lancedbService.storeKnowledge({ id: 'k-orthogonal', content: 'orthogonal', vector: orthogonal });
        const results = await lancedbService.searchKnowledge([...aligned], 1);
        expect(results.length).toBe(1);
        expect(results[0].id).toBe('k-aligned');
        expect(results[0]._distance).toBeCloseTo(0);
    });
});
