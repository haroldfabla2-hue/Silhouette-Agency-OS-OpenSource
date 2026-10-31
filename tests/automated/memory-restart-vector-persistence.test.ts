/**
 * Etapa 3 (declared-limit closure from PR #204 review): DEEP-memory VECTOR
 * persistence across a module restart, against REAL storage, with identity.
 *
 * Real: the on-disk LanceDB worker database (canonical memory_records_v2 +
 * the per-identity projection table), the embedding_state lifecycle
 * (EMBEDDING_PENDING -> READY), the per-identity read path, and the module
 * restart itself.
 * Doubled (declared): ONLY the embedding MODEL. generateEmbeddingWithIdentity
 * returns deterministic fixture vectors derived from the text (no external
 * API, no cost) under a declared fixture identity. Everything downstream -
 * validation, canonical write, projection, ANN/exact retrieval - is the
 * real code.
 *
 * Restart scope (declared): in-process module restart (vi.resetModules +
 * fresh import) against the same on-disk storage. NOT an OS process restart.
 *
 * Flow: store two DEEP nodes via the real continuum.store API -> module
 * restart -> assert vectors, identity binding, embedding state and retrieval
 * ranking survive, without any re-embedding of the stored memories.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { MemoryTier } from '../../types';
import type { EmbeddingIdentity } from '../../services/memoryRetrieval';

// Per-run identity: each run writes its own projection table, so stale ANN
// queue/index state left by interrupted earlier runs can never contaminate
// this one (observed: killed runs leave the shared worker DB unreadable for
// the fixed-identity table).
const RUN = `vecrestart-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const FIXTURE_IDENTITY: EmbeddingIdentity = { model: `declared-fixture-restart-${RUN}`, version: '1', dimension: 768 };

// Deterministic fixture vectors: same text -> same vector across module
// restarts (the mock factory is re-evaluated by resetModules).
function fixtureVector(text: string): number[] {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    let state = h >>> 0;
    const v = new Array<number>(FIXTURE_IDENTITY.dimension);
    for (let i = 0; i < v.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        v[i] = (state / 0xffffffff) * 2 - 1;
    }
    return v;
}

const embedCalls: string[] = [];
vi.mock('../../services/geminiService', async (importOriginal) => {
    const actual = await importOriginal<any>();
    const fixture = async (text: string) => {
        embedCalls.push(text);
        return { vector: fixtureVector(text), identity: FIXTURE_IDENTITY };
    };
    return {
        ...actual,
        generateEmbeddingWithIdentity: fixture,
        geminiService: { ...actual.geminiService, generateEmbeddingWithIdentity: fixture }
    };
});

const TARGET = `${RUN} target deep node`;
const DECOY = `${RUN} decoy deep node`;

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

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
    // Tidy the shared worker DB: remove the seeded canonical nodes. The
    // fixture-identity projection rows remain in the test-only worker DB
    // (lancedbService.deleteNode does not prune projection tables - existing
    // behavior, out of scope here).
    try {
        const continuum = await freshContinuum();
        const all = await continuum.getAllNodes();
        for (const n of (all[MemoryTier.DEEP] || []).filter((n: any) => n.content?.includes(RUN))) {
            await continuum.deleteNode(n.id).catch(() => {});
        }
    } catch { /* non-fatal */ }
    await stopSideEffects();
});

describe('deep-memory vector persistence across module restart (real storage, declared fixture identity)', () => {
    it('vectors, identity binding and READY state survive restart and serve retrieval without re-embedding', async () => {
        // ---- Phase 1: real writes through the real public API ----
        let continuum = await freshContinuum();
        await continuum.store(TARGET, MemoryTier.DEEP, ['RESTART_TEST']);
        await continuum.store(DECOY, MemoryTier.DEEP, ['RESTART_TEST']);

        const { lancedbService } = await import('../../services/lancedbService');
        await waitFor(async () => {
            const hits = await lancedbService.search(fixtureVector(TARGET), 5, undefined, FIXTURE_IDENTITY, { withScores: true });
            return hits.some(h => h.content === TARGET) && hits.some(h => h.content === DECOY);
        });

        const preRestart = await lancedbService.search(fixtureVector(TARGET), 5, undefined, FIXTURE_IDENTITY, { withScores: true });
        expect(preRestart[0]?.content).toBe(TARGET);
        expect(preRestart[0]?.similarity).toBeGreaterThan(0.9999);
        // embedding_state lifecycle: neither seeded node is EMBEDDING_PENDING.
        const pendingBefore = await lancedbService.pendingEmbeddings(500);
        expect(pendingBefore.some(n => n.content?.includes(RUN))).toBe(false);

        // ---- Phase 2: module restart against the same on-disk storage ----
        vi.resetModules();
        continuum = await freshContinuum();
        const { lancedbService: lancedbAfter } = await import('../../services/lancedbService');

        // ---- Phase 3: vectors + identity serve retrieval after restart ----
        await waitFor(async () => {
            try {
                const hits = await lancedbAfter.search(fixtureVector(TARGET), 5, undefined, FIXTURE_IDENTITY, { withScores: true });
                return hits[0]?.content === TARGET;
            } catch { return false; }
        });
        const postRestart = await lancedbAfter.search(fixtureVector(TARGET), 5, undefined, FIXTURE_IDENTITY, { withScores: true });
        expect(postRestart[0]?.content).toBe(TARGET);
        expect(postRestart[0]?.similarity).toBeGreaterThan(0.9999);
        // Same measured similarity before/after the restart (stable read path;
        // tolerance covers exact-scan vs ANN route differences).
        const preTop = preRestart[0]?.similarity;
        expect(typeof preTop).toBe('number');
        expect(postRestart[0]?.similarity).toBeCloseTo(preTop as number, 4);
        // Ranking matches an independent local cosine computation.
        const decoyHit = postRestart.find(h => h.content === DECOY);
        expect(decoyHit?.similarity).toBeCloseTo(cosine(fixtureVector(TARGET), fixtureVector(DECOY)), 3);
        // Identity binding: a different identity has no projection and serves nothing.
        const wrongIdentity: EmbeddingIdentity = { model: 'declared-fixture-other', version: '1', dimension: 768 };
        expect(await lancedbAfter.search(fixtureVector(TARGET), 5, undefined, wrongIdentity, { withScores: true })).toEqual([]);
        // embedding_state persisted READY across the restart.
        const pendingAfter = await lancedbAfter.pendingEmbeddings(500);
        expect(pendingAfter.some(n => n.content?.includes(RUN))).toBe(false);
        // Retrieval of persisted vectors needs no embedding model: the
        // explicit-vector searches above embed nothing. (Declared race: the
        // scheduled backfillMemoryEmbeddings pass may re-embed a row in its
        // brief pre-READY PENDING window - same vector, same identity,
        // idempotent projection. Once READY, passes skip the row.) So assert
        // stability from here on, not a fixed call count.
        const callsAtReady = embedCalls.length;
        await lancedbAfter.search(fixtureVector(TARGET), 5, undefined, FIXTURE_IDENTITY, { withScores: true });
        await lancedbAfter.search(fixtureVector(DECOY), 5, undefined, FIXTURE_IDENTITY, { withScores: true });
        expect(embedCalls.length).toBe(callsAtReady);

        // ---- Phase 4: the public retrieval path serves the target ----
        // Declared caveat: continuum re-sorts each candidate list by
        // activation score and fuses lists (reciprocal rank), so public
        // rank-1 is NOT determined by vector similarity alone - retrieval
        // quality is out of scope here; persistence is what this proves.
        const results = await continuum.retrieve(TARGET, 'RESTART_TEST');
        expect(results.some(r => r.content === TARGET)).toBe(true);
    }, 60000);
});
