/**
 * Etapa 3 B/C - dream selection measured from the canonical vector store.
 *
 * Real: LanceDB worker store (canonical memory_records_v2 + per-identity
 * projections), real lancedbService.search score normalization, real
 * cosine math, real DreamerService selection paths. Doubled (declared):
 * enrichWithNeighbors on the Dreamer instance (graph mechanics not under
 * test) and geminiService.generateEmbedding ONLY in the legacy-fallback
 * case (no real external calls anywhere; vectors are deterministic
 * fixtures with known cosines, not model output).
 *
 * Exploration preserved: callers still draw seeds/candidates randomly;
 * selection MEASURES among the drawn. Retrieval k is an approximation
 * bound, never claimed as full recall.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { MemoryNode, MemoryTier } from '../../types';
import { cosineSimilarity } from '../../services/vectorScan';
import { LEGACY_EMBEDDING } from '../../services/memoryRetrieval';

vi.mock('../../services/geminiService', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, generateEmbedding: async () => null, generateEmbeddingWithIdentity: async () => null };
});

import { lancedbService } from '../../services/lancedbService';
import { storedVectorCoverage, pickLeastSimilarMeasured, zoneMembers } from '../../services/dream/dreamSelection';
import { DreamerService } from '../../services/dreamerService';

// Per-run identity: fixed-identity projection tables accumulate stale rows
// across runs in the shared worker DB (observed: ANN rebuilds over 10..35
// accumulated rows; first search after rebuild could return 0 - flake).
const RUN = `dreamsel-${Date.now()}`;
const IDENTITY = { model: `test-embed-${RUN}`, version: '1', dimension: 768 };
const OTHER_IDENTITY = { model: 'other-embed', version: '1', dimension: 768 };

const e = (i: number): number[] => { const v = new Array(768).fill(0); v[i] = 1; return v; };
const norm = (v: number[]): number[] => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)); return v.map(x => x / n); };

// Known cosines against vA = e(0):
const vA = e(0);                                   // self
const vB = e(1);                                   // cos 0
const vC = norm([1, 1, ...new Array(766).fill(0)]); // cos ~0.7071
const vE = e(2);                                   // cos 0 against vA/vB/vC
const vF = norm([0.6, 0.8, ...new Array(766).fill(0)]); // cos 0.6
const vD = e(0);                                   // cos 1.0 (duplicate direction, different node)

let seq = 0;
function node(content: string, vector?: number[], identity = IDENTITY): MemoryNode {
    const n: any = {
        id: `${RUN}-${seq++}`, content, timestamp: Date.now(), tier: MemoryTier.DEEP,
        importance: 0.8, tags: ['DREAMSEL_TEST'], accessCount: 0, lastAccess: Date.now()
    };
    if (vector) { n.embeddingIdentity = identity; n.embeddingVector = vector; }
    return n;
}

afterAll(async () => {
    try {
        const all = await lancedbService.getAllNodes();
        for (const n of all.filter((n: any) => n.id.startsWith(RUN))) await lancedbService.deleteNode(n.id).catch(() => {});
    } catch { /* non-fatal */ }
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) await new Promise(r => setTimeout(r, 50));
    mod.dreamer?.stopDreamingLoop?.();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect().catch(() => {});
});

describe('storedVectorCoverage', () => {
    it('accepts known identity + valid vector; excludes missing, legacy and invalid', () => {
        expect(storedVectorCoverage(node('a', vA)).ok).toBe(true);
        expect(storedVectorCoverage(node('b')).ok).toBe(false);
        expect(storedVectorCoverage(node('c', vA, LEGACY_EMBEDDING)).ok).toBe(false);
        expect(storedVectorCoverage(node('d', [1, 2, 3])).ok).toBe(false); // wrong dimension
    });
});

describe('pickLeastSimilarMeasured (known cosines, drawn-only)', () => {
    it('picks the MEASURED least similar among the drawn candidates', () => {
        const seed = node('seed', vA);
        const drawn = [node('close', vF), node('mid', vC), node('orthogonal', vB)];
        const r = pickLeastSimilarMeasured(seed, drawn);
        expect(r.measured).toBe(true);
        expect(r.pick?.content).toBe('orthogonal');
        expect(r.similarity).toBeCloseTo(0, 5);
    });
    it('measured=false without seed coverage (caller keeps its random pick)', () => {
        const r = pickLeastSimilarMeasured(node('seed-no-vector'), [node('x', vB)]);
        expect(r.measured).toBe(false);
        expect(r.pick).toBeNull();
    });
    it('never mixes identities: a cross-identity candidate is excluded even if less similar', () => {
        const seed = node('seed', vA);
        const drawn = [node('cross', vB, OTHER_IDENTITY), node('same', vC)];
        const r = pickLeastSimilarMeasured(seed, drawn);
        expect(r.measured).toBe(true);
        expect(r.pick?.content).toBe('same'); // cos 0.707, the only measurable candidate
    });
    it('selection is among drawn only, not the whole store', () => {
        const seed = node('seed', vA);
        const notInStoreFar = node('far', vB);
        const r = pickLeastSimilarMeasured(seed, [node('near', vC), notInStoreFar]);
        expect(r.pick?.content).toBe('far');
    });
});

describe('zoneMembers (real LanceDB canonical projections)', () => {
    it('filters by measured similarity band, excludes the seed, ranked best-first', async () => {
        const seed = node('zone-seed', vA);
        const inBand707 = node('in-band-0707', vC);
        const inBand060 = node('in-band-060', vF);
        const outLow = node('out-low', vB);   // cos 0 < 0.30
        const outHigh = node('out-high', vD); // cos 1 > 0.85
        for (const n of [seed, inBand707, inBand060, outLow, outHigh]) {
            await lancedbService.store(n, (n as any).embeddingVector);
        }

        const zone = await zoneMembers(seed, { min: 0.30, max: 0.85 }, 4);
        expect(zone.source).toBe('canonical');
        const contents = zone.members.map(m => m.content);
        expect(contents).toContain('in-band-0707');
        expect(contents).toContain('in-band-060');
        expect(contents).not.toContain('out-low');
        expect(contents).not.toContain('out-high');
        expect(contents).not.toContain('zone-seed');
        for (const m of zone.members) {
            expect(m.similarity).toBeGreaterThanOrEqual(0.30);
            expect(m.similarity).toBeLessThanOrEqual(0.85);
        }
        // Ranked best-first by measured similarity
        expect(zone.members[0].content).toBe('in-band-0707');
        // Measured values match the known fixture cosines
        expect(zone.members.find(m => m.content === 'in-band-060')?.similarity).toBeCloseTo(0.6, 2);
    });

    it('source none without seed coverage (legacy path runs unchanged)', async () => {
        const zone = await zoneMembers(node('no-vector'), { min: 0.3, max: 0.85 }, 4);
        expect(zone.source).toBe('none');
        expect(zone.members).toHaveLength(0);
    });

    it('search withScores normalizes both engines to similarity in [-1,1], ranked desc', async () => {
        const seed = node('norm-seed', vA);
        const r = await lancedbService.search(vA, 10, undefined, IDENTITY, { withScores: true });
        expect(r.length).toBeGreaterThan(0);
        for (let i = 0; i < r.length; i++) {
            expect(typeof r[i].similarity).toBe('number');
            expect(r[i].similarity!).toBeGreaterThanOrEqual(-1);
            expect(r[i].similarity!).toBeLessThanOrEqual(1.000001);
            if (i > 0) expect(r[i - 1].similarity!).toBeGreaterThanOrEqual(r[i].similarity!);
        }
        expect(seed.id).toBeTruthy();
    });
});

describe('DreamerService rewiring (real selection, declared doubles)', () => {
    it('gatherParadoxes picks the measured-orthogonal partner for ANY random seed', async () => {
        const svc: any = new DreamerService();
        svc.enrichWithNeighbors = async (nodes: MemoryNode[]) => nodes; // declared double
        // Geometry: vA=e0, vB=e1 (cos 0), vC=(e0+e1)/sqrt2 (cos .7071 with
        // both), vE=e2 (cos 0 with all three). EVERY seed has an orthogonal
        // partner (the previous 3-fixture version left seed pC without one:
        // ~1/3 of runs measured cos .7071 - seed-dependent flake, caught in
        // a parallel run). Seed pC is the discriminating case: only the
        // MEASURED pick (pE) gives cos 0; a random partner gives 0 just 1/3.
        const fixtures = [node('pA', vA), node('pB', vB), node('pC', vC), node('pE', vE)];
        const out: MemoryNode[] = await svc.gatherParadoxes({ MEDIUM: fixtures, DEEP: [] });
        expect(out).toHaveLength(2);
        const sim = cosineSimilarity((out[0] as any).embeddingVector, (out[1] as any).embeddingVector);
        expect(sim).toBeCloseTo(0, 5);
    });

    it('gatherConstellation uses canonical zone members when the seed has coverage', async () => {
        const svc: any = new DreamerService();
        svc.enrichWithNeighbors = async (nodes: MemoryNode[]) => nodes; // declared double
        const seedOnly = node('zone-seed', vA); // same id as stored fixture above
        const out: MemoryNode[] = await svc.gatherConstellation({ MEDIUM: [seedOnly], DEEP: [] });
        const contents = out.map(n => n.content);
        expect(contents).toContain('zone-seed');
        expect(contents).toContain('in-band-0707'); // measured canonical member
        expect(contents).not.toContain('out-low');
        expect(out.find(n => n.content === 'in-band-0707')?.tags).toContain('CONSTELLATION_MEMBER');
    });
});
