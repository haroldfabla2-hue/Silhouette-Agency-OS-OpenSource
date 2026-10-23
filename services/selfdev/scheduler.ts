/**
 * SELF-DEV AUTONOMOUS SCHEDULER — preparation branch (Alberto 2026-10-23).
 *
 * Highest autonomy compatible with the approved scope: detect its own
 * issues from real system signals, run the full verified cycle in the
 * isolated selfwork clone, and STOP at the human PR gate. It never calls
 * requestPR (approvedBy is a human), never pushes, never merges.
 *
 * Hard rules:
 *  - OFF unless SELFDEV_AUTONOMOUS=true. Deploying this code changes
 *    nothing by itself; activation is a separate operator decision.
 *  - Memory first: if the shared free quota cannot serve the embedding
 *    pipeline (or a continuum incident is open), self-dev defers. The
 *    planner's text-model spend is not ledger-tracked today (honest
 *    limitation), so the binding controls are this deferral, the daily
 *    cap and the daemon interval - not SELFDEV_MAX_CYCLES_PER_DAY=9,
 *    which was never an approved budget.
 *  - No speculative scoping: only incidents with a declared source->scope
 *    mapping become issues; anything else is skipped loudly.
 *  - One active cycle at a time (enforced by the cycle service).
 */
import fs from 'fs';
import path from 'path';
import { selfDevCycleService } from './cycleService';
import { incidentRegistry } from '../incidentRegistry';
import { quotaLedger } from '../quotaLedger';
import { DEFAULT_GEMINI_EMBEDDING_MODEL } from '../llm/defaultModels';
import { builtInProviders } from '../llm/providerRegistry';

export interface SchedulerDecision {
    ran: boolean;
    reason: string;
    cycleId?: string;
    finalState?: string;
}

const AUTO_ISSUE_PREFIX = '[auto] ';

/** Declared source -> cycle input mappings. Never guess a scope. */
const INCIDENT_MAPPINGS: Record<string, { scope: string[]; acceptance: string }> = {
    'continuum-promote': {
        scope: ['services/continuumMemory.ts', 'services/memoryTransitions.ts'],
        acceptance: 'tests/automated/deep-memory-identity.test.ts'
    },
    'continuum-embeddings': {
        scope: ['services/continuumMemory.ts'],
        acceptance: 'tests/automated/deep-memory-identity.test.ts'
    }
};

function enabled(): boolean {
    return process.env.SELFDEV_AUTONOMOUS === 'true';
}

function dailyCap(): number {
    // Conservative default: 2 autonomous cycles/day. The env 9 was never
    // an approved budget; an operator may raise this deliberately.
    return Number(process.env.SELFDEV_AUTONOMOUS_MAX_CYCLES_PER_DAY ?? 2);
}

/** Planner chain as llmGateway would walk it: preferred env leg first,
 *  then registry priority order, with each leg's default model. */
function plannerChain(): { provider: string; model: string }[] {
    const ordered = [...builtInProviders].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    const legs = ordered.map(p => ({ provider: p.id, model: p.model }));
    const pref = process.env.SELFDEV_PLANNER_PROVIDER?.trim();
    if (pref) {
        const model = process.env.SELFDEV_PLANNER_MODEL?.trim() || legs.find(l => l.provider.toLowerCase() === pref.toLowerCase())?.model || 'unknown';
        return [{ provider: pref, model }, ...legs.filter(l => l.provider.toLowerCase() !== pref.toLowerCase())];
    }
    return legs;
}

function todayStartIso(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

export async function runSelfDevSchedulerOnce(): Promise<SchedulerDecision> {
    if (!enabled()) {
        return { ran: false, reason: 'disabled (SELFDEV_AUTONOMOUS is not true)' };
    }

    // One active cycle at a time (the service also enforces this; defer
    // politely instead of throwing).
    const active = selfDevCycleService.list().find(c => ['PLANNED', 'ATTEMPTED', 'EXECUTED', 'VERIFIED', 'PR_SUBMITTED'].includes(c.state));
    if (active) {
        return { ran: false, reason: `deferred: cycle ${active.id} still active (${active.state})` };
    }

    // Daily autonomous budget.
    const todays = selfDevCycleService.countCreatedSince(todayStartIso(), AUTO_ISSUE_PREFIX);
    if (todays >= dailyCap()) {
        return { ran: false, reason: `deferred: daily autonomous cap reached (${todays}/${dailyCap()})` };
    }

    // Memory first: shared free quota must serve embeddings before prose.
    const embedQuota = quotaLedger.status('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
    if (!embedQuota.allowed) {
        return { ran: false, reason: `deferred: embedding quota exhausted (${embedQuota.used}/${embedQuota.budget}); memory pipeline has priority` };
    }
    const embedCooldown = quotaLedger.cooldownUntil('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
    if (embedCooldown) {
        return { ran: false, reason: `deferred: embedding provider cooldown until ${new Date(embedCooldown).toISOString()} (real 429 RetryInfo); memory pipeline has priority` };
    }
    // Note: an OPEN continuum incident is not a reason to defer - fixing it
    // IS serving memory priority. The binding memory-priority control is the
    // quota gate above.

    // PLANNER QUOTA GATE (fail-closed, Main 2026-10-23): the planner burns
    // the SHARED free text-model quota, and llmGateway may fall back through
    // the provider chain, so a cycle can consume any configured leg. The
    // permission is free-tier-only with memory priority; that is a boundary,
    // not a budget number. Rule: without explicit per-provider budget
    // knowledge AND reservable headroom on at least one chain leg, defer and
    // explain - never execute on the 450 default, which is a safety net,
    // not real quota knowledge.
    // Verified bound: cycleService has exactly ONE LLM call site
    // (planWithLLM, 1 call + 1 repair retry); attempt/execute run local
    // vitest only. With the exclusive leg pinned below, a cycle can spend
    // AT MOST plannerEstimate calls, all on the reserved leg.
    const plannerEstimate = Number(process.env.SELFDEV_PLANNER_ESTIMATED_CALLS ?? 2);
    const chain = plannerChain();
    const leg = chain.find(l => {
        const p = l.provider.toLowerCase();
        return quotaLedger.hasExplicitBudget(p, l.model)
            && !quotaLedger.cooldownUntil(p, l.model)
            && quotaLedger.status(p, l.model).used + plannerEstimate <= quotaLedger.budgetFor(p, l.model);
    });
    if (!leg) {
        const why = chain.map(l => {
            const p = l.provider.toLowerCase();
            if (!quotaLedger.hasExplicitBudget(p, l.model)) return `${p}/${l.model}: no explicit budget (real quota unknown)`;
            const cool = quotaLedger.cooldownUntil(p, l.model);
            if (cool) return `${p}/${l.model}: provider cooldown until ${new Date(cool).toISOString()}`;
            const s = quotaLedger.status(p, l.model);
            return `${p}/${l.model}: ${s.used}/${s.budget} used, need ${plannerEstimate}`;
        }).join('; ');
        return { ran: false, reason: `deferred: no free planner route with known quota - ${why || 'no providers configured'}` };
    }
    const legKey = leg.provider.toLowerCase();
    const hold = quotaLedger.reserve(legKey, leg.model, plannerEstimate);
    if (!hold.reserved) {
        return { ran: false, reason: `deferred: planner quota hold failed on ${legKey}/${leg.model} (${hold.used}/${hold.budget}); memory and chat keep priority` };
    }

    // Issue source: oldest open incident with a DECLARED mapping.
    const candidates = incidentRegistry.getOpenIncidents()
        .filter(i => INCIDENT_MAPPINGS[i.source])
        .sort((a, b) => a.firstSeen - b.firstSeen);
    if (candidates.length === 0) {
        return { ran: false, reason: 'no open incidents with a declared scope mapping (never guessing a scope)' };
    }
    const incident = candidates[0];
    const mapping = INCIDENT_MAPPINGS[incident.source];
    if (!fs.existsSync(path.resolve(process.cwd(), mapping.acceptance))) {
        return { ran: false, reason: `deferred: acceptance target ${mapping.acceptance} missing for source ${incident.source}` };
    }

    const issue = `${AUTO_ISSUE_PREFIX}incident ${incident.source} (${incident.kind}): ${incident.summary}${incident.detail ? ' - ' + incident.detail : ''}`.substring(0, 1000);
    // Pin the reserved leg: the planner may use ONLY this provider/model,
    // no fallback into unmeasured legs. Restored after the cycle.
    const saved = {
        p: process.env.SELFDEV_PLANNER_PROVIDER,
        m: process.env.SELFDEV_PLANNER_MODEL,
        f: process.env.SELFDEV_PLANNER_DISABLE_FALLBACK
    };
    process.env.SELFDEV_PLANNER_PROVIDER = leg.provider;
    process.env.SELFDEV_PLANNER_MODEL = leg.model;
    process.env.SELFDEV_PLANNER_DISABLE_FALLBACK = 'true';
    const restore = () => {
        if (saved.p === undefined) delete process.env.SELFDEV_PLANNER_PROVIDER; else process.env.SELFDEV_PLANNER_PROVIDER = saved.p;
        if (saved.m === undefined) delete process.env.SELFDEV_PLANNER_MODEL; else process.env.SELFDEV_PLANNER_MODEL = saved.m;
        if (saved.f === undefined) delete process.env.SELFDEV_PLANNER_DISABLE_FALLBACK; else process.env.SELFDEV_PLANNER_DISABLE_FALLBACK = saved.f;
    };
    try {
        const cycle = selfDevCycleService.create({ issue, scope: mapping.scope, acceptance: { kind: 'vitest', target: mapping.acceptance } });
        console.log(`[SELFDEV-SCHEDULER] Cycle ${cycle.id} created from incident ${incident.source}`);
        await selfDevCycleService.attempt(cycle.id);
        const done = await selfDevCycleService.execute(cycle.id);
        // STOP at the human gate: a VERIFIED cycle waits for a human
        // approvedBy via the existing operator flow. Never requestPR here.
        if (done.state === 'VERIFIED') {
            console.log(`[SELFDEV-SCHEDULER] Cycle ${cycle.id} VERIFIED - awaiting human PR approval (never auto-requested)`);
        } else {
            console.warn(`[SELFDEV-SCHEDULER] Cycle ${cycle.id} ended ${done.state}: ${done.lastError ?? 'no error recorded'}`);
        }
        restore();
        return { ran: true, reason: `cycle ${cycle.id} finished ${done.state} on reserved leg ${legKey}/${leg.model} (no fallback)`, cycleId: cycle.id, finalState: done.state };
    } catch (e: any) {
        restore();
        console.warn(`[SELFDEV-SCHEDULER] cycle failed safely: ${e?.message}`);
        return { ran: false, reason: `cycle error (contained): ${e?.message}` };
    }
}
