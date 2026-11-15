/**
 * Janitor Truth Evaluation Engine v2 — safety-critical test suite.
 *
 * Layer 0 (structural, CI-enforced): the janitor source tree contains NO
 * delete path. If anyone ever adds one, this test fails the build.
 *
 * Behavioral layers use injected fakes (no network, no DB):
 *   - contradiction => meta-truth written, originals PRESERVED (tagged only)
 *   - verifier disagreement => abstain, originals untouched
 *   - low confidence => abstain
 *   - dry-run => proposals logged, nothing stored
 *   - idempotency => a second cycle over the same data takes no new action
 *   - loop prevention => META_TRUTH nodes are never re-analyzed
 *   - reversibility => unsupersede restores the original tags
 *   - circuit breaker => consecutive provider errors abort the run
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JanitorService, JanitorDeps, JANITOR_TAGS, loadConfig } from '../../services/janitor/janitorService';
import { RevisionLedger } from '../../services/janitor/revisionLedger';
import { MemoryNode, MemoryTier } from '../../types';

const NOW = 1_760_000_000_000;

function node(id: string, content: string, tags: string[] = []): MemoryNode {
    return { id, content, timestamp: NOW - 3600_000, tier: MemoryTier.MEDIUM, importance: 0.5, tags, accessCount: 0, lastAccess: NOW - 3600_000 };
}

interface FakeWorld {
    store: Map<string, MemoryNode>;
    notes: string[];
    ledger: RevisionLedger;
    detectorResponses: string[];
    verifierResponses: string[];
    detectorCalls: number;
    verifierCalls: number;
}

function makeWorld(opts: {
    nodes: MemoryNode[];
    detectorResponses?: string[];
    verifierResponses?: string[];
    detectorError?: boolean;
    dryRun?: boolean;
}): { deps: JanitorDeps; world: FakeWorld } {
    const store = new Map(opts.nodes.map(n => [n.id, n]));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-test-'));
    const world: FakeWorld = {
        store, notes: [],
        ledger: new RevisionLedger(path.join(tmp, 'ledger.jsonl')),
        detectorResponses: opts.detectorResponses ?? [],
        verifierResponses: opts.verifierResponses ?? [],
        detectorCalls: 0, verifierCalls: 0
    };
    const deps: JanitorDeps = {
        getCandidates: async () => [...world.store.values()],
        // Fake embedding: one axis per keyword so same-topic entries cluster
        embed: async (text) => {
            const t = text.toLowerCase();
            if (t.includes('coffee')) return [1, 0, 0, 0];
            if (t.includes('tea')) return [0, 1, 0, 0];
            if (t.includes('wine')) return [0, 0, 1, 0];
            return [0, 0, 0, 1];
        },
        upsertNode: async (n) => { world.store.set(n.id, n); },
        getNodeById: async (id) => world.store.get(id) ?? null,
        detector: {
            judge: async () => {
                world.detectorCalls++;
                if (opts.detectorError) throw new Error('detector down');
                const r = world.detectorResponses.shift() ?? '{"action":"EXP","confidence":0.9,"reason":"unrelated"}';
                return { text: r, provider: 'FAKE_A', model: 'a-1' };
            }
        },
        verifier: {
            judge: async () => {
                world.verifierCalls++;
                const r = world.verifierResponses.shift() ?? '{"agree":true,"reason":"justified"}';
                return { text: r, provider: 'FAKE_B', model: 'b-1' };
            }
        },
        ledger: world.ledger,
        noteRevision: async (text) => { world.notes.push(text); },
        now: () => NOW,
        newId: () => `meta-${world.store.size + 1}`
    };
    return { deps, world };
}

describe('Layer 0 — structural invariant: NO delete path in the janitor tree', () => {
    it('janitor sources never call a delete/destroy operation', () => {
        const dir = path.resolve(__dirname, '../../services/janitor');
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
            const src = fs.readFileSync(path.join(dir, f), 'utf-8');
            expect(src, `${f} must not delete`).not.toMatch(/deleteNode\s*\(/);
            expect(src, `${f} must not delete`).not.toMatch(/\.delete\s*\(/);
            expect(src, `${f} must not delete`).not.toMatch(/DROP\s+TABLE/i);
            expect(src, `${f} must not delete`).not.toMatch(/unlinkSync|rmSync/);
        }
    });
});

describe('Truth evaluation behavior', () => {
    const CONTRADICTION = [
        node('n1', 'User likes coffee a lot'),
        node('n2', 'User hates coffee now')
    ];
    const REV_VERDICT = '{"action":"REV","confidence":0.92,"metaTruth":"The user currently dislikes coffee (changed from liking it)","reason":"preference changed over time"}';

    it('resolves a contradiction: meta-truth written, originals PRESERVED with tags', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: [REV_VERDICT],
            dryRun: false
        });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        const report = await svc.runCycle();

        expect(report.applied).toBe(1);
        // Meta-truth exists and links its predecessors
        const meta = [...world.store.values()].find(n => n.tags.includes(JANITOR_TAGS.META_TRUTH));
        expect(meta).toBeDefined();
        expect(meta!.content).toContain('dislikes coffee');
        expect(meta!.parentIds).toEqual(expect.arrayContaining(['n1', 'n2']));
        // ETERNAL MEMORY: both originals survive with full content
        const n1 = world.store.get('n1')!;
        const n2 = world.store.get('n2')!;
        expect(n1.content).toBe('User likes coffee a lot');
        expect(n2.content).toBe('User hates coffee now');
        expect(n1.tags).toContain(JANITOR_TAGS.SUPERSEDED);
        expect(n1.tags.some(t => t === `${JANITOR_TAGS.SUPERSEDED_BY_PREFIX}${meta!.id}`)).toBe(true);
        // Consciousness stream was notified + ledger audited
        expect(world.notes.length).toBe(1);
        expect(world.ledger.metrics().applied).toBe(1);
    });

    it('verifier disagreement => abstain, originals byte-identical', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: [REV_VERDICT],
            verifierResponses: ['{"agree":false,"reason":"could be two different days, not a contradiction"}'],
            dryRun: false
        });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        const report = await svc.runCycle();

        expect(report.applied).toBe(0);
        expect(report.abstained).toBe(1);
        expect(world.store.get('n1')).toEqual(CONTRADICTION[0]);
        expect(world.store.get('n2')).toEqual(CONTRADICTION[1]);
        expect(world.notes.length).toBe(0);
        expect(world.ledger.metrics().abstained).toBe(1);
    });

    it('low confidence => abstain without even calling the verifier', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: ['{"action":"REV","confidence":0.5,"metaTruth":"x","reason":"unsure"}'],
            dryRun: false
        });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        await svc.runCycle();
        expect(world.verifierCalls).toBe(0);
        expect(world.ledger.metrics().abstained).toBe(1);
        expect(world.store.get('n1')).toEqual(CONTRADICTION[0]);
    });

    it('dry-run (the DEFAULT) records proposals and stores nothing', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: [REV_VERDICT]
        });
        const svc = new JanitorService(deps); // loadConfig default: dryRun=true
        const report = await svc.runCycle();

        expect(report.dryRun).toBe(true);
        expect(report.proposed).toBe(1);
        expect(report.applied).toBe(0);
        expect(world.store.size).toBe(2); // no meta-truth written
        expect(world.store.get('n1')).toEqual(CONTRADICTION[0]);
        expect(world.ledger.metrics().proposed).toBe(1);
    });

    it('idempotency: a second cycle over resolved data takes no new action', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: [REV_VERDICT],
            dryRun: false
        });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        await svc.runCycle();
        const callsAfterFirst = world.detectorCalls;
        const report2 = await svc.runCycle();
        // superseded originals + meta-truth are all excluded => no clusters
        expect(report2.clusters).toBe(0);
        expect(world.detectorCalls).toBe(callsAfterFirst);
    });

    it('loop prevention: META_TRUTH nodes never become candidates', async () => {
        const meta = node('m1', '[META-TRUTH] something resolved', [JANITOR_TAGS.META_TRUTH]);
        const other = node('n9', 'coffee is involved here somehow');
        const { deps, world } = makeWorld({ nodes: [meta, other], dryRun: false });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        await svc.runCycle();
        expect(world.detectorCalls).toBe(0); // never even analyzed
    });

    it('reversibility: unsupersede restores original tags and logs the revert', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: [REV_VERDICT],
            dryRun: false
        });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        await svc.runCycle();
        expect(world.store.get('n1')!.tags).toContain(JANITOR_TAGS.SUPERSEDED);

        const ok = await svc.unsupersede('n1', 'human review: not a real contradiction');
        expect(ok).toBe(true);
        expect(world.store.get('n1')!.tags).toEqual([]);
        expect(world.ledger.metrics().reverted).toBe(1);
    });

    it('circuit breaker: consecutive provider errors abort the run, memory untouched', async () => {
        // 4 distinct clusters (coffee/tea/wine/beer pairs) so the breaker can trip mid-run
        const pairs = [
            node('c1', 'coffee fact one'), node('c2', 'coffee fact two'),
            node('t1', 'tea fact one'), node('t2', 'tea fact two'),
            node('w1', 'wine fact one'), node('w2', 'wine fact two'),
            node('b1', 'beer fact one'), node('b2', 'beer fact two')
        ];
        const { deps, world } = makeWorld({ nodes: pairs, detectorError: true, dryRun: false });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false, circuitBreakerLimit: 3 });
        const report = await svc.runCycle();

        expect(report.abortedByCircuitBreaker).toBe(true);
        expect(report.errors).toBeGreaterThanOrEqual(3);
        for (const n of pairs) expect(world.store.get(n.id)).toEqual(n);
        expect(world.ledger.metrics().errors).toBeGreaterThanOrEqual(3);
    });

    it('unparseable detector output => safe abstention', async () => {
        const { deps, world } = makeWorld({
            nodes: CONTRADICTION.map(n => ({ ...n })),
            detectorResponses: ['not json at all'],
            dryRun: false
        });
        const svc = new JanitorService(deps, { ...loadConfig(), dryRun: false });
        const report = await svc.runCycle();
        expect(report.abstained).toBe(1);
        expect(world.store.get('n1')).toEqual(CONTRADICTION[0]);
    });
});
