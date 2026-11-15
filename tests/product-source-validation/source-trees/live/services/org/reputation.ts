/**
 * Reputation by accumulated evidence — derived scores, never stored.
 *
 * Frontier grounding (what this surpasses and how):
 *  - TrustFlow (2026): topic-aware reputation vectors. Requires learned
 *    embeddings; opaque. Ours is deterministic and recomputable: same ledger,
 *    same formula version, same score (Agent Reputations spec principle:
 *    "a score that cannot be recomputed is an opinion").
 *  - AgentReputation (FSE'26): context-conditioned reputation cards +
 *    verification regimes. We condition on collaboration context (the role/
 *    domain the help was about) and fall back to the global card when local
 *    evidence is thin — no reputation conflation across domains.
 *  - Silhouette's own assets: the ledger is append-only like the janitor and
 *    identity ledgers, and facts can be reconciled against eternal memory
 *    provenance — reputation grounded in evidence the user can audit.
 *
 * Formula v2 (REPUTATION_FORMULA_VERSION = 'reputation-v2'):
 *   Like v1, plus normal task outcomes join the success component:
 *   successRate      = (helped ok + tasks completed + 1)
 *                      / (helped total + tasks completed + tasks failed + 2) — Laplace prior 0.5
 *   responseRate     = (answered + 1) / (requested + 2)
 *   speedScore       = mean over answers of 1 / (1 + latencyMs / 60000)     (0.5 if none)
 *   composite        = 0.6*success + 0.25*response + 0.15*speed
 * Weights are success-dominant by design: fast answers that always fail must
 * score BELOW the prior — responsiveness and speed only pay off on good work.
 *   confidence       = min(1, evidenceCount / CONFIDENCE_FULL_EVIDENCE)
 *   score            = PRIOR + confidence * (composite - PRIOR)
 * Cold start: no evidence → score = PRIOR (0.5), confidence 0 — new agents
 * are neither punished nor privileged; routing ties break toward the head.
 *
 * v1 -> v2: TASK_COMPLETED/TASK_FAILED facts enter successRate and the
 * evidence count. The version bump is deliberate: same ledger, different
 * formula version, different score — scores stay recomputable per version.
 */

import { ReputationFact, ReputationLedger } from './reputationLedger';

export const REPUTATION_FORMULA_VERSION = 'reputation-v2';
export const REPUTATION_PRIOR = 0.5;
export const CONFIDENCE_FULL_EVIDENCE = 10;
export const MIN_CONTEXT_EVIDENCE = 3;
const LATENCY_REFERENCE_MS = 60_000;

export interface ReputationReport {
    agentId: string;
    context: string | null;
    scope: 'context' | 'global' | 'global-fallback';
    score: number;              // 0..1, PRIOR-centered
    confidence: number;         // 0..1
    evidenceCount: number;
    components: {
        successRate: number;
        responseRate: number;
        speedScore: number;
        composite: number;
    };
    formulaVersion: string;
}

function componentsFor(facts: ReputationFact[]) {
    const requested = facts.filter(f => f.type === 'COLLAB_REQUESTED').length;
    const helped = facts.filter(f => f.type === 'COLLAB_HELPED');
    const successes = helped.filter(f => f.success === true).length;
    const tasksCompleted = facts.filter(f => f.type === 'TASK_COMPLETED').length;
    const tasksFailed = facts.filter(f => f.type === 'TASK_FAILED').length;
    const latencies = helped.map(f => f.latencyMs).filter((x): x is number => typeof x === 'number' && x >= 0);

    // v2: normal task outcomes count toward demonstrated success, alongside help.
    const successRate = (successes + tasksCompleted + 1) / (helped.length + tasksCompleted + tasksFailed + 2);
    const responseRate = (helped.length + 1) / (requested + 2);
    const speedScore = latencies.length > 0
        ? latencies.reduce((acc, ms) => acc + 1 / (1 + ms / LATENCY_REFERENCE_MS), 0) / latencies.length
        : REPUTATION_PRIOR;
    const composite = 0.6 * successRate + 0.25 * responseRate + 0.15 * speedScore;
    return { successRate, responseRate, speedScore, composite, evidenceCount: requested + helped.length + tasksCompleted + tasksFailed };
}

function toReport(agentId: string, context: string | null, scope: ReputationReport['scope'], facts: ReputationFact[]): ReputationReport {
    const c = componentsFor(facts);
    const confidence = Math.min(1, c.evidenceCount / CONFIDENCE_FULL_EVIDENCE);
    return {
        agentId,
        context,
        scope,
        score: REPUTATION_PRIOR + confidence * (c.composite - REPUTATION_PRIOR),
        confidence,
        evidenceCount: c.evidenceCount,
        components: {
            successRate: c.successRate,
            responseRate: c.responseRate,
            speedScore: c.speedScore,
            composite: c.composite
        },
        formulaVersion: REPUTATION_FORMULA_VERSION
    };
}

/**
 * Context-conditioned reputation: with a context, only facts in that context
 * count; if context evidence is thinner than MIN_CONTEXT_EVIDENCE, fall back
 * to the global card (marked 'global-fallback' so callers can see it).
 */
export function computeReputation(ledger: ReputationLedger, agentId: string, context?: string): ReputationReport {
    const all = ledger.factsAbout(agentId);
    if (!context) return toReport(agentId, null, 'global', all);
    const needle = context.toLowerCase();
    const scoped = all.filter(f => (f.context || '').toLowerCase() === needle);
    if (scoped.length >= MIN_CONTEXT_EVIDENCE) return toReport(agentId, context, 'context', scoped);
    const global = toReport(agentId, context, all.length === 0 ? 'global' : 'global-fallback', all);
    return global;
}

/** Rank candidate agents by reputation for a context. Ties keep input order (stable). */
export function rankByReputation(ledger: ReputationLedger, agentIds: string[], context?: string): Array<{ agentId: string; report: ReputationReport }> {
    return agentIds
        .map(agentId => ({ agentId, report: computeReputation(ledger, agentId, context) }))
        .sort((a, b) => b.report.score - a.report.score);
}
