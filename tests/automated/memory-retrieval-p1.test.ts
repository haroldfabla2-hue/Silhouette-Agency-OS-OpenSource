import { afterEach, describe, it, expect } from 'vitest';
import { MemoryTier, type MemoryNode } from '../../types';
import { LanceDbService } from '../../services/lancedbService';
import { validEmbedding, fuseMemories, inScope } from '../../services/memoryRetrieval';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const fresh = async () => { const dir = await mkdtemp(join(tmpdir(), 'agency-p1-')); dirs.push(dir); return new LanceDbService(dir); };
const node = (id: string, content = 'ordinary memory'): MemoryNode => ({ id, content, timestamp: 1000, tier: MemoryTier.MEDIUM, importance: 0.5, tags: [], accessCount: 0, lastAccess: 1000 });

describe('P1 real LanceDB retrieval', () => {
    it('finds the indexed match after row 500, without zero vectors in ANN', async () => {
        const db = await fresh();
        // Bulk-seed the 501 filler rows in ONE transaction: this test asserts
        // retrieval quality beyond row 500, not store() throughput. 502
        // sequential store() calls (each a merge + read-back + FTS
        // invalidation) blow the 120s cap on constrained/shared machines
        // while passing on CI runners (verified 2026-10-15, 8GB shared box).
        await db.storeMany(Array.from({ length: 501 }, (_, i) => node(`p1-row-${i}`)));
        await db.store(node('p1-row-501', 'quasarneedle specific evidence'));
        expect((await db.searchByContent('quasarneedle')).map(n => n.id)).toContain('p1-row-501');
        const identity = { model: 'test-fixture-explicit', version: '1', dimension: 3 };
        await expect(db.projectEmbedding(node('bad-vector'), [0, 0, 0], identity)).rejects.toThrow('Invalid');
        await expect(db.projectEmbedding(node('bad-vector'), [NaN, 1, 2], identity)).rejects.toThrow('Invalid');
        await expect(db.projectEmbedding(node('bad-vector'), [1, 2], identity)).rejects.toThrow('Invalid');
        await db.store(node('good-vector'));
        await db.projectEmbedding(node('good-vector'), [1, 0, 0], identity);
        expect((await db.search([1, 0, 0], 10, undefined, identity)).map(n => n.id)).toEqual(['good-vector']);
        expect(await db.search([1, 0, 0], 10, undefined, { ...identity, model: 'other-model' })).toEqual([]);
        expect((await db.pendingEmbeddings()).length).toBeGreaterThan(0);
    }, 120000);
    it('filters owner before indexed search and excludes exploratory hypotheses', async () => {
        const db = await fresh();
        await db.store({ ...node('private-a', 'siloquery private'), ownerId: 'alice' });
        await db.store({ ...node('private-b', 'siloquery private'), ownerId: 'bob' });
        await db.store({ ...node('hypothesis-a', 'siloquery hypothetical'), tags: ['HYPOTHESIS'] });
        expect((await db.searchByContent('siloquery', 20, { ownerId: 'alice' })).map(n => n.id)).toEqual(['private-a']);
    });
    it('fuses rank lists, chooses latest version, and obeys a conservative context budget', () => {
        const a = node('a', 'needle');
        const b = node('b', 'needle other');
        expect(fuseMemories([[a, b], [{ ...a, timestamp: 2000 }]], 'needle')[0].timestamp).toBe(2000);
        expect(fuseMemories([[a, b]], 'needle', 2).map(n => n.id)).toEqual(['a']);
        expect(inScope({ ...a, ownerId: 'bob' }, { ownerId: 'alice' })).toBe(false);
        expect(validEmbedding([], { model: 'x', version: '1', dimension: 3 })).toBe(false);
    });
});
