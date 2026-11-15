/**
 * Value ranking for memory retrieval (roadmap item 5).
 *
 * Hard constraint (Alberto, 2026-10-13): ETERNAL MEMORY — the value score
 * decides what gets SHOWN first, never what gets kept. This module has no
 * delete path and rankByValue returns every input node, only reordered.
 *
 * Design: multi-signal relevance score inspired by Generative Agents
 * (recency + importance + access, Park et al. UIST'23) extended with a
 * provenance bonus — introspections, dream intuitions, verified meta-truths
 * and research outrank casual chat on the same topic (the transversal
 * proposal from the 13:52 epiphany findings). Superseded nodes are NOT
 * removed; they are demoted by SUPERSEDED_DEMOTION so the current truth
 * outranks them while the full chain stays retrievable (BELIEFMEM head-first
 * retrieval).
 */

import { MemoryNode } from '../../types';

export interface ValueRankingConfig {
    enabled: boolean;              // VALUE_RANKING_ENABLED, default true
    supersededDemotion: number;    // SUPERSEDED_DEMOTION, default 0.3 — multiplier, never a filter
    recencyHalfLifeMs: number;     // VALUE_RECENCY_HALF_LIFE_HOURS, default 168h (7 days)
}

export const loadValueRankingConfig = (env: NodeJS.ProcessEnv = process.env): ValueRankingConfig => ({
    enabled: (env.VALUE_RANKING_ENABLED ?? 'true').toLowerCase() !== 'false',
    supersededDemotion: Number(env.SUPERSEDED_DEMOTION ?? 0.3),
    recencyHalfLifeMs: Number(env.VALUE_RECENCY_HALF_LIFE_HOURS ?? 168) * 3600_000
});

/** Provenance tags that raise a memory's value: the entity's own verified
 *  cognitive products outrank raw chatter. */
const HIGH_VALUE_TAGS = [
    'source:INTROSPECTION',   // the entity's own narrated thoughts
    'epiphany',               // consciousness cycle outputs
    'INTUITION',              // dream consolidations
    'DREAM',
    'META_TRUTH',             // janitor-verified current truths
    'truth_revision',
    'SYNTHESIZED',
    'RESEARCH',
    'source:RESEARCH'
];

const isSuperseded = (n: MemoryNode): boolean =>
    n.tags.some(t => t === 'SUPERSEDED' || t.startsWith('SUPERSEDED_BY:'));

/**
 * Pure value score in [0, ~1.3]. Components:
 *   importance   0.35 — stored importance (0-1)
 *   recency      0.25 — exponential decay with 7-day half-life (configurable)
 *   access       0.20 — log-scaled access count (log1p(a)/log1p(50), capped)
 *   provenance   0.20 — 1.0 when the node carries a high-value provenance tag
 * Superseded nodes: score × supersededDemotion (demoted, NEVER removed).
 */
export function valueScore(n: MemoryNode, now: number, cfg: ValueRankingConfig = loadValueRankingConfig()): number {
    const importance = Math.min(Math.max(n.importance ?? 0, 0), 1);
    const ageMs = Math.max(0, now - (n.timestamp || 0));
    const recency = Math.pow(0.5, ageMs / cfg.recencyHalfLifeMs);
    const access = Math.min(1, Math.log1p(n.accessCount ?? 0) / Math.log1p(50));
    const provenance = n.tags.some(t => HIGH_VALUE_TAGS.includes(t)) ? 1 : 0;

    let score = 0.35 * importance + 0.25 * recency + 0.20 * access + 0.20 * provenance;
    if (isSuperseded(n)) score *= cfg.supersededDemotion;
    return score;
}

/**
 * Re-rank nodes by value, stable for equal scores (newest first tiebreak).
 * ETERNAL-MEMORY INVARIANT: output length === input length, same node objects.
 */
export function rankByValue(nodes: MemoryNode[], now: number, cfg: ValueRankingConfig = loadValueRankingConfig()): MemoryNode[] {
    if (!cfg.enabled || nodes.length < 2) return nodes;
    return nodes
        .map((n, i) => ({ n, i, s: valueScore(n, now, cfg) }))
        .sort((a, b) => (b.s - a.s) || (b.n.timestamp - a.n.timestamp) || (a.i - b.i))
        .map(x => x.n);
}
