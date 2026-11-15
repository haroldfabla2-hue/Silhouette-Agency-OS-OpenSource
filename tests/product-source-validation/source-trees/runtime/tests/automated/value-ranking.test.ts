import { describe, it, expect } from 'vitest';
import { valueScore, rankByValue, loadValueRankingConfig } from '../../services/memory/valueRanking';
import { MemoryNode } from '../../types';

const NOW = 1_000_000_000_000;
const DAY = 24 * 3600_000;

const node = (over: Partial<MemoryNode>): MemoryNode => ({
    id: 'n', content: 'c', tags: [], importance: 0.5, accessCount: 0,
    timestamp: NOW, lastAccess: NOW, ...over
} as MemoryNode);

describe('Value ranking (roadmap item 5, eternal-memory safe)', () => {
    it('provenance: an INTROSPECTION outranks a casual node of same recency/importance', () => {
        const casual = node({ id: 'casual', tags: ['source:USER_INPUT'] });
        const intro = node({ id: 'intro', tags: ['source:INTROSPECTION'] });
        expect(valueScore(intro, NOW)).toBeGreaterThan(valueScore(casual, NOW));
    });

    it('recency: a fresh node outranks a 30-day-old node of equal importance', () => {
        const fresh = node({ id: 'fresh', timestamp: NOW });
        const old = node({ id: 'old', timestamp: NOW - 30 * DAY });
        expect(valueScore(fresh, NOW)).toBeGreaterThan(valueScore(old, NOW));
    });

    it('importance: high-importance outranks low-importance at same age', () => {
        const hi = node({ id: 'hi', importance: 0.9 });
        const lo = node({ id: 'lo', importance: 0.1 });
        expect(valueScore(hi, NOW)).toBeGreaterThan(valueScore(lo, NOW));
    });

    it('superseded memories are demoted but NEVER removed (eternal memory)', () => {
        const truth = node({ id: 'truth', tags: ['META_TRUTH', 'source:JANITOR'] });
        const old = node({ id: 'old', tags: ['SUPERSEDED_BY:truth'] });
        const ranked = rankByValue([old, truth], NOW);
        expect(ranked.length).toBe(2);                       // nothing deleted
        expect(ranked.map(n => n.id)).toContain('old');      // still retrievable
        expect(ranked[0].id).toBe('truth');                  // current truth ranks first
    });

    it('rankByValue preserves every node (length invariant, same objects)', () => {
        const nodes = [
            node({ id: 'a', tags: ['SUPERSEDED'] }),
            node({ id: 'b', importance: 0.9, tags: ['epiphany'] }),
            node({ id: 'c', accessCount: 10 })
        ];
        const ranked = rankByValue(nodes, NOW);
        expect(ranked.length).toBe(nodes.length);
        nodes.forEach(n => expect(ranked).toContain(n));
    });

    it('VALUE_RANKING_ENABLED=false returns the original order untouched', () => {
        const cfg = loadValueRankingConfig({ VALUE_RANKING_ENABLED: 'false' } as any);
        const a = node({ id: 'a', importance: 0.1 });
        const b = node({ id: 'b', importance: 0.9 });
        expect(rankByValue([a, b], NOW, cfg).map(n => n.id)).toEqual(['a', 'b']);
    });

    it('access count raises score logarithmically (0 < 5 < 50 reads)', () => {
        const s0 = valueScore(node({ accessCount: 0 }), NOW);
        const s5 = valueScore(node({ accessCount: 5 }), NOW);
        const s50 = valueScore(node({ accessCount: 50 }), NOW);
        expect(s5).toBeGreaterThan(s0);
        expect(s50).toBeGreaterThan(s5);
    });
});
