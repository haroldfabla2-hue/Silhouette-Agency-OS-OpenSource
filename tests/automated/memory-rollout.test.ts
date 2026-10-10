import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanceDbService } from '../../services/lancedbService';
import { LexicalHashProvider, MemoryProjectionRollout } from '../../services/memoryProjectionRollout';
import { MemoryTier, type MemoryNode } from '../../types';
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const node = (id: string, content = 'safety document', ownerId = 'alice'): MemoryNode => ({ id, content, ownerId, timestamp: 1, tier: MemoryTier.MEDIUM, tags: [], accessCount: 0, lastAccess: 1, importance: 0.5 });
async function fresh() {
    const path = await mkdtemp(join(tmpdir(), 'rollout-')); dirs.push(path);
    const db = new LanceDbService(path);
    return { db, rollout: new MemoryProjectionRollout(path, db, { backfill: true, annShadow: true }), path };
}
describe('opt-in real projection rollout', () => {
    it('is disabled by default, separates provider identity and re-embeds changed source', async () => {
        const { db, rollout, path } = await fresh(); const provider = new LexicalHashProvider();
        await db.store(node('one'));
        await expect(new MemoryProjectionRollout(path, db).backfill(provider)).rejects.toThrow('disabled');
        expect((await rollout.backfill(provider)).projected).toBe(1);
        expect((await rollout.backfill(provider)).projected).toBe(0);
        const [query] = await provider.embed(['safety document']);
        expect((await rollout.search(query, provider.identity)).map(n => n.id)).toEqual(['one']);
        expect(await rollout.search(query, { ...provider.identity, provider: 'different' })).toEqual([]);
        await db.store(node('one', 'new contract'));
        expect(await rollout.search(query, provider.identity)).toEqual([]);
        expect((await rollout.backfill(provider)).projected).toBe(1);
        await db.deleteNode('one');
        expect(await rollout.search(query, provider.identity)).toEqual([]);
    });
    it('rejects unsupported provider vectors without consuming durable backlog', async () => {
        const { db, rollout } = await fresh(); const provider = new LexicalHashProvider();
        await db.store(node('bad', '---'));
        await expect(rollout.backfill(provider)).rejects.toThrow('No nonzero');
        await db.store(node('bad', 'valid words'));
        expect((await rollout.backfill(provider)).projected).toBe(1);
    });
    it('uses actual IVF index, preserves exact oracle and blocks owners/hypotheses', async () => {
        const { db, rollout } = await fresh(); const provider = new LexicalHashProvider(16);
        for (let i = 0; i < 80; i++) await db.store(node(`n${i}`, `topic${i} contract memory document word${i}`, i === 0 ? 'bob' : 'alice'));
        await db.store({ ...node('hypothesis'), tags: ['HYPOTHESIS'] });
        expect((await rollout.backfill(provider, 100)).projected).toBe(80);
        expect(await rollout.trainAnn(provider.identity, 2)).toEqual({ rows: 80, partitions: 2 });
        const [q] = await provider.embed(['topic1 contract memory document word1']);
        const comparison = await rollout.shadow(q, provider.identity, 10, { ownerId: 'alice' }, 2); // probe every partition
        expect(comparison.referenceCount).toBe(10);
        expect(comparison.recallAtK).toBeGreaterThanOrEqual(0.9); // ties at the k=10 border are inherent to synthetic colliding embeddings
        expect(comparison.annIds).toContain(comparison.exactIds[0]); // the unique exact top-1 must always be found
        expect(comparison.exactIds).not.toContain('n0');
        expect((await rollout.search(q, provider.identity, 100, { ownerId: 'alice' }, 'ann')).some(n => n.ownerId === 'bob')).toBe(false);
        expect(comparison.exactMs).toBeGreaterThan(0);
    }, 120000);
});
