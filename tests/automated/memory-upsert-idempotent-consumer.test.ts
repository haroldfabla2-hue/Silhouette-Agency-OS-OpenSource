/**
 * Auditor follow-up (ba873b6 review): prove the REAL continuum consumer
 * collapses a replayed stable id to exactly one stored node, in-process and
 * across a module restart (snapshot reload). The lifecycle file proves the
 * journal side with a declared double; this file proves the consumer side
 * against the real store, so "exactly one stored effect" is not generalized
 * from a doubled consumer.
 *
 * Real: continuum working tier + on-disk volatile snapshot (per-worker path).
 * Doubled (declared): ONLY the embedding model (returns null) - concept
 * writes are ULTRA_SHORT/working and never touch an embedding provider.
 * Restart scope (declared): in-process module restart (vi.resetModules +
 * fresh import) against the same on-disk snapshot. NOT an OS process restart.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { MemoryTier } from '../../types';

vi.mock('../../services/geminiService', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, generateEmbeddingWithIdentity: async () => null };
});

const RUN = `upsert-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TAGS = ['system', 'concept-vector'];

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

function workingMatches(continuum: any, id: string): any[] {
    return (continuum.working as any[]).filter(n => n.id === id);
}

async function stopSideEffects() {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) await new Promise(r => setTimeout(r, 50));
    mod.dreamer?.stopDreamingLoop?.();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect().catch(() => {});
}

const seededIds: string[] = [];

beforeAll(async () => {
    // Environment parity with the sibling restart suites: create the LanceDB
    // table through an AWAITED deep-tier write up front. Working-tier-only
    // stores never create it, leaving table creation to a background tick
    // that races the module-restart init ("table already exists", unhandled).
    const continuum = await freshContinuum();
    const anchorId = crypto.randomUUID();
    seededIds.push(anchorId);
    await continuum.store(`${RUN} deep-anchor ${anchorId}`, MemoryTier.DEEP, TAGS, false, { id: anchorId, timestamp: Date.now() });
});

afterAll(async () => {
    try {
        const continuum = await freshContinuum();
        for (const id of seededIds) await continuum.deleteNode(id).catch(() => {});
        await continuum.forceSave().catch(() => {});
    } catch { /* non-fatal */ }
    await stopSideEffects();
});

describe('real continuum consumer: stable-id replay collapses to one node', () => {
    it('upsert mechanics: same id re-delivered with fresher content keeps exactly one working-tier node (latest wins)', async () => {
        const continuum = await freshContinuum();
        const id = crypto.randomUUID();
        seededIds.push(id);
        const ts = Date.now();
        await continuum.store(`${RUN} v1 ${id}`, undefined, TAGS, false, { id, timestamp: ts });
        // Same stable id, different content: bypasses the RAM recent-hash
        // dedup, so this exercises the working-tier upsert itself.
        await continuum.store(`${RUN} v2 ${id}`, undefined, TAGS, false, { id, timestamp: ts + 1 });
        const matches = workingMatches(continuum, id);
        expect(matches.length).toBe(1);
        expect(matches[0].content).toBe(`${RUN} v2 ${id}`);
    }, 30000);

    it('restart replay: identical entry re-delivered after a module restart keeps exactly one stored node', async () => {
        let continuum = await freshContinuum();
        const id = crypto.randomUUID();
        seededIds.push(id);
        const ts = Date.now();
        const content = `${RUN} replay ${id}`;
        await continuum.store(content, undefined, TAGS, false, { id, timestamp: ts });
        await continuum.forceSave();

        // Module restart: fresh instance reloads the working tier from the
        // on-disk snapshot; the RAM recent-hash dedup is empty again, so the
        // replay below takes the full store path - exactly the crash window
        // "store confirmed, journal ACK lost".
        vi.resetModules();
        continuum = await freshContinuum();
        await waitFor(async () => workingMatches(continuum, id).length > 0);

        await continuum.store(content, undefined, TAGS, false, { id, timestamp: ts }); // replay
        expect(workingMatches(continuum, id).length).toBe(1);
        // Declared limit: a second restart would re-prove durability of the
        // collapse, but each in-process restart multiplies the LanceDB
        // init race window (harness-only, prod restarts are process-level);
        // sibling restart suites use exactly one restart for the same reason.
    }, 40000);
});
