/**
 * Exact-duplicate sweep: eternal-memory-safe, deterministic consolidation
 * of normalized-exact duplicates. No LLM, no deletion — tags only.
 */
import { describe, it, expect } from 'vitest';
import {
    planExactDuplicateSupersede, runExactDuplicateSweep, normalizeContent, MIN_DUP_CONTENT_LEN
} from '../../services/janitor/exactDuplicateSweep';
import { runMemoryAudit, type MemoryAuditDeps } from '../../services/health/memoryAudit';
import type { MemoryNode } from '../../types';
import { MemoryTier } from '../../types';

let seq = 0;
const makeNode = (content: string, overrides: Partial<MemoryNode> = {}): MemoryNode => ({
    id: overrides.id ?? `n-${++seq}`,
    content,
    timestamp: overrides.timestamp ?? 1_700_000_000_000 + seq,
    tier: MemoryTier.MEDIUM,
    importance: overrides.importance ?? 5,
    tags: overrides.tags ?? [],
    accessCount: overrides.accessCount ?? 0,
    lastAccess: overrides.lastAccess ?? 0,
    ...overrides
});

const LONG = 'the user prefers concise spanish reports with links and evidence';
const LONG_B = 'completely different memory about deployment topology and ports';
const baseAuditDeps = (nodes: MemoryNode[]): MemoryAuditDeps => ({
    nodes, souls: [], janitorMetrics: null, now: Date.now()
});

describe('exact-duplicate sweep', () => {
    it('normalization matches the doctor audit (case, punctuation, whitespace)', () => {
        expect(normalizeContent('  The USER prefers concise spanish reports with links and evidence!! '))
            .toBe(normalizeContent(LONG));
        expect(MIN_DUP_CONTENT_LEN).toBeGreaterThan(0);
    });

    it('finds exactly the groups the doctor audit flags', () => {
        const nodes = [
            makeNode(LONG, { id: 'a' }),
            makeNode(LONG.toUpperCase(), { id: 'b' }),
            makeNode(LONG + '  ', { id: 'c' }),
            makeNode(LONG_B, { id: 'd' }),
            makeNode('short', { id: 'e' }), // below MIN_DUP_CONTENT_LEN
            makeNode('short', { id: 'f' }),
        ];
        const groups = planExactDuplicateSupersede(nodes);
        expect(groups).toHaveLength(1);
        expect(new Set([groups[0].canonicalId, ...groups[0].supersedeIds]))
            .toEqual(new Set(['a', 'b', 'c']));

        const audit = runMemoryAudit(baseAuditDeps(nodes));
        const dupCheck = audit.find(c => c.name.includes('duplicate content'))!;
        expect(dupCheck.status).toBe('warning');
        expect(dupCheck.message).toContain('1 unresolved duplicate group');
    });

    it('picks the canonical deterministically: importance > accessCount > age > id, order-independent', () => {
        const members = () => [
            makeNode(LONG, { id: 'z-old', timestamp: 100, importance: 5, accessCount: 1 }),
            makeNode(LONG, { id: 'y-important', timestamp: 300, importance: 9, accessCount: 0 }),
            makeNode(LONG, { id: 'x-accessed', timestamp: 200, importance: 5, accessCount: 7 }),
        ];
        const shuffled = [members(), [...members()].reverse(), [members()[1], members()[2], members()[0]]];
        for (const set of shuffled) {
            const g = planExactDuplicateSupersede(set);
            expect(g).toHaveLength(1);
            expect(g[0].canonicalId).toBe('y-important'); // highest importance wins
            expect(g[0].supersedeIds).toEqual(['x-accessed', 'z-old']);
        }
        // ties on importance+accessCount fall to oldest timestamp, then id
        const tied = planExactDuplicateSupersede([
            makeNode(LONG, { id: 'b', timestamp: 50 }),
            makeNode(LONG, { id: 'a', timestamp: 50 }),
        ]);
        expect(tied[0].canonicalId).toBe('a');
    });

    it('skips janitor-processed nodes (idempotent universe handling)', () => {
        const nodes = [
            makeNode(LONG, { id: 'a' }),
            makeNode(LONG, { id: 'b', tags: ['SUPERSEDED', 'SUPERSEDED_BY:a'] }),
            makeNode(LONG, { id: 'c', tags: ['META_TRUTH'] }),
        ];
        expect(planExactDuplicateSupersede(nodes)).toHaveLength(0);
    });

    it('apply: tags only, zero deletion, content byte-identical, audit flips to ok, rerun is a no-op', async () => {
        const store = new Map<string, MemoryNode>();
        for (const n of [
            makeNode(LONG, { id: 'keep', importance: 9 }),
            makeNode(LONG, { id: 'dup1', importance: 5 }),
            makeNode(LONG, { id: 'dup2', importance: 5 }),
            makeNode(LONG_B, { id: 'other' }),
        ]) store.set(n.id, n);
        const before = new Map([...store].map(([k, v]) => [k, { ...v }]));

        const deps = {
            getAllNodes: async () => [...store.values()].map(n => ({ ...n })),
            upsertNode: async (n: MemoryNode) => { store.set(n.id, n); },
            now: () => Date.now(),
        };
        const report = await runExactDuplicateSweep(deps, false);
        expect(report.groups).toBe(1);
        expect(report.supersededIds.sort()).toEqual(['dup1', 'dup2']);
        expect(report.canonicalOf['dup1']).toBe('keep');

        // Eternal memory: no node removed, no content touched.
        expect(store.size).toBe(before.size);
        for (const [id, orig] of before) expect(store.get(id)!.content).toBe(orig.content);

        const dup1 = store.get('dup1')!;
        expect(dup1.tags).toContain('SUPERSEDED');
        expect(dup1.tags).toContain('SUPERSEDED_BY:keep');

        // Doctor audit now reads clean.
        const audit = runMemoryAudit(baseAuditDeps([...store.values()]));
        expect(audit.find(c => c.name.includes('duplicate content'))!.status).toBe('ok');

        // Idempotent: second sweep has nothing to do.
        const again = await runExactDuplicateSweep(deps, false);
        expect(again.groups).toBe(0);
        expect(again.supersededIds).toHaveLength(0);
    });

    it('dry-run: plans but writes nothing', async () => {
        const store = new Map<string, MemoryNode>();
        store.set('a', makeNode(LONG, { id: 'a' }));
        store.set('b', makeNode(LONG, { id: 'b' }));
        const upserts: string[] = [];
        const report = await runExactDuplicateSweep({
            getAllNodes: async () => [...store.values()],
            upsertNode: async (n) => { upserts.push(n.id); },
            now: () => 1,
        }, true);
        expect(report.dryRun).toBe(true);
        expect(report.groups).toBe(1);
        expect(upserts).toHaveLength(0);
        expect(store.get('b')!.tags).toHaveLength(0);
    });
});
