/**
 * Etapa 3 (plan): integral restart proof of the four memory tiers against
 * REAL storage, not simulated storage.
 *
 * Real: LanceDB on-disk worker database (memory_records_v2 canonical) and
 * the on-disk volatile snapshot (data/memory_snapshot-worker-N.json).
 * Doubled (declared): ONLY the embedding MODEL - generateEmbeddingWithIdentity
 * returns null, so DEEP exercises the real "no embedding provider" canonical
 * path (the same path prod is on during the embedding cooldown). Vector
 * persistence across restart is NOT covered here (declared limit).
 *
 * Restart scope (declared): in-process module restart (vi.resetModules +
 * fresh import) against the same on-disk storage. NOT an OS process restart.
 *
 * Flow: seed one node per tier via the real continuum.store API -> module
 * restart -> assert all four tiers recover with id/content/tier intact.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { MemoryTier } from '../../types';

vi.mock('../../services/geminiService', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, generateEmbeddingWithIdentity: async () => null };
});

const RUN = `restart-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SEED: Array<{ tier: MemoryTier; content: string }> = [
    { tier: MemoryTier.WORKING, content: `${RUN} working tier node` },
    { tier: MemoryTier.MEDIUM, content: `${RUN} medium tier node` },
    { tier: MemoryTier.LONG, content: `${RUN} long tier node` },
    { tier: MemoryTier.DEEP, content: `${RUN} deep tier node` }
];

async function stopSideEffects() {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) await new Promise(r => setTimeout(r, 50));
    mod.dreamer?.stopDreamingLoop?.();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect().catch(() => {});
}

async function freshContinuum() {
    const mod = await import('../../services/continuumMemory');
    return mod.continuum as any;
}

async function waitFor(cond: () => Promise<boolean>, ms = 20000, step = 200): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (await cond()) return;
        await new Promise(r => setTimeout(r, step));
    }
    throw new Error('waitFor timeout');
}

afterAll(async () => {
    // Tidy the shared worker DB: remove the seeded persistent nodes.
    try {
        const continuum = await freshContinuum();
        const all = await continuum.getAllNodes();
        for (const tier of [MemoryTier.MEDIUM, MemoryTier.LONG, MemoryTier.DEEP]) {
            for (const n of (all[tier] || []).filter((n: any) => n.content?.includes(RUN))) {
                await continuum.deleteNode(n.id).catch(() => {});
            }
        }
    } catch { /* non-fatal */ }
    await stopSideEffects();
});

describe('four-tier memory restart against real storage', () => {
    it('all four tiers survive a module restart with content intact', async () => {
        // ---- Phase 1: real writes through the real public API ----
        let continuum = await freshContinuum();
        for (const s of SEED) await continuum.store(s.content, s.tier, ['RESTART_TEST']);
        await continuum.forceSave();

        let all = await continuum.getAllNodes();
        const findIn = (nodes: any, s: string) => (nodes || []).find((n: any) => n.content === s);
        expect(findIn(all[MemoryTier.MEDIUM], SEED[1].content)?.tier).toBe(MemoryTier.MEDIUM);
        expect(findIn(all[MemoryTier.LONG], SEED[2].content)?.tier).toBe(MemoryTier.LONG);
        expect(findIn(all[MemoryTier.DEEP], SEED[3].content)?.tier).toBe(MemoryTier.DEEP);
        expect(findIn(continuum.getVolatileState(), SEED[0].content)).toBeTruthy();

        // ---- Phase 2: module restart against the same on-disk storage ----
        vi.resetModules();
        continuum = await freshContinuum();

        await waitFor(async () => {
            try {
                const nodes = await continuum.getAllNodes();
                return !!(findIn(nodes[MemoryTier.MEDIUM], SEED[1].content)
                    && findIn(nodes[MemoryTier.LONG], SEED[2].content)
                    && findIn(nodes[MemoryTier.DEEP], SEED[3].content)
                    && findIn(continuum.getVolatileState(), SEED[0].content));
            } catch { return false; }
        });

        // ---- Assertions: identity, content and tier placement intact ----
        all = await continuum.getAllNodes();
        const medium = findIn(all[MemoryTier.MEDIUM], SEED[1].content);
        const long = findIn(all[MemoryTier.LONG], SEED[2].content);
        const deep = findIn(all[MemoryTier.DEEP], SEED[3].content);
        const working = findIn(continuum.getVolatileState(), SEED[0].content);

        expect(medium?.tier).toBe(MemoryTier.MEDIUM);
        expect(long?.tier).toBe(MemoryTier.LONG);
        expect(deep?.tier).toBe(MemoryTier.DEEP);
        expect(working).toBeTruthy();
        for (const n of [medium, long, deep, working]) {
            expect(typeof n.id).toBe('string');
            expect(n.tags).toContain('RESTART_TEST');
        }
    }, 30000);
});
