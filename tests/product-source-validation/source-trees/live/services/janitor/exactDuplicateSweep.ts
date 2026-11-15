/**
 * Exact-duplicate sweep — deterministic, LLM-free consolidation of
 * normalized-exact duplicate memory nodes.
 *
 * Why: /v1/system/doctor ("Memory: duplicate content (normalized-exact)")
 * flags groups of nodes whose content is identical after normalization.
 * The janitor's LLM pipeline (detector + verifier) is overkill there:
 * an exact duplicate is a fact, not a judgment call, so confidence is
 * 1.0 by construction and no provider call is needed (zero cost).
 *
 * ETERNAL-MEMORY INVARIANT: this module never deletes, overwrites or
 * truncates a memory original. Non-canonical duplicates keep their full
 * content; they only gain tags (SUPERSEDED, SUPERSEDED_BY:<canonicalId>)
 * — the same marking the janitor applies, so retrieval/loop-prevention
 * treat them identically and janitorService.unsupersede() rolls them back.
 *
 * The canonical survivor is chosen deterministically: highest importance,
 * then highest accessCount, then oldest timestamp, then lowest id — so a
 * rerun over the same universe always consolidates onto the same node.
 */

import type { MemoryNode } from '../../types';
import { JANITOR_TAGS } from './janitorService';
import type { RevisionLedger } from './revisionLedger';

/** Minimum normalized length worth deduplicating (shared with the audit). */
export const MIN_DUP_CONTENT_LEN = 20;

/** Canonical content key. Single source of truth: the doctor memory audit
 *  imports this so the sweep targets exactly what the audit flags. */
export const normalizeContent = (s: string): string =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

/** Nodes already touched by the janitor/sweep (exported: the doctor audit
 *  uses the same predicate so resolved duplicates stop counting). */
export const isJanitorProcessed = (n: MemoryNode): boolean =>
    n.tags.some(t =>
        t === JANITOR_TAGS.META_TRUTH || t === JANITOR_TAGS.SUPERSEDED ||
        t === JANITOR_TAGS.SYNTHESIZED || t.startsWith(JANITOR_TAGS.SUPERSEDED_BY_PREFIX));

/** Deterministic canonical pick: importance > accessCount > age > id. */
const pickCanonical = (group: MemoryNode[]): MemoryNode =>
    [...group].sort((a, b) =>
        (b.importance - a.importance) ||
        (b.accessCount - a.accessCount) ||
        (a.timestamp - b.timestamp) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )[0];

export interface DupGroup {
    /** Normalized-exact key shared by every member. */
    key: string;
    canonicalId: string;
    supersedeIds: string[];
}

/** Pure planner: group the universe, pick the survivor per group.
 *  Output order is stable (sorted by canonicalId) for testability. */
export function planExactDuplicateSupersede(nodes: MemoryNode[]): DupGroup[] {
    const byKey = new Map<string, MemoryNode[]>();
    for (const n of nodes) {
        if (isJanitorProcessed(n)) continue;
        const key = normalizeContent(n.content || '');
        if (key.length < MIN_DUP_CONTENT_LEN) continue;
        const arr = byKey.get(key) || [];
        arr.push(n);
        byKey.set(key, arr);
    }
    return [...byKey.entries()]
        .filter(([, g]) => g.length > 1)
        .map(([key, g]) => {
            const canonical = pickCanonical(g);
            return {
                key,
                canonicalId: canonical.id,
                supersedeIds: g.filter(n => n.id !== canonical.id).map(n => n.id).sort()
            };
        })
        .sort((a, b) => (a.canonicalId < b.canonicalId ? -1 : 1));
}

export interface SweepDeps {
    getAllNodes(): Promise<MemoryNode[]>;
    upsertNode(node: MemoryNode): Promise<void>;
    /** Optional audit trail. Omit on dry-runs that should stay silent. */
    ledger?: RevisionLedger;
    now(): number;
    runId?: string;
}

export interface SweepReport {
    dryRun: boolean;
    groups: number;
    supersededIds: string[];
    /** supersededId -> canonicalId, for reporting/review. */
    canonicalOf: Record<string, string>;
}

/** Plan + (optionally) apply the sweep. In dry-run mode nothing is written:
 *  no node mutations and no ledger appends unless a ledger is passed. */
export async function runExactDuplicateSweep(deps: SweepDeps, dryRun: boolean): Promise<SweepReport> {
    const nodes = await deps.getAllNodes();
    const groups = planExactDuplicateSupersede(nodes);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const runId = deps.runId ?? `dup-sweep-${deps.now()}`;
    const supersededIds: string[] = [];
    const canonicalOf: Record<string, string> = {};

    for (const g of groups) {
        for (const id of g.supersedeIds) {
            const node = byId.get(id);
            if (!node) continue;
            if (!dryRun) {
                // Mirror janitorService marking: strip stale markings, add
                // SUPERSEDED + SUPERSEDED_BY:<canonical>. Content untouched.
                const marked: MemoryNode = {
                    ...node,
                    tags: [...node.tags.filter(t => t !== JANITOR_TAGS.SUPERSEDED && !t.startsWith(JANITOR_TAGS.SUPERSEDED_BY_PREFIX)),
                           JANITOR_TAGS.SUPERSEDED, `${JANITOR_TAGS.SUPERSEDED_BY_PREFIX}${g.canonicalId}`]
                };
                await deps.upsertNode(marked);
            }
            supersededIds.push(id);
            canonicalOf[id] = g.canonicalId;
        }
        try {
            deps.ledger?.append({
                ts: deps.now(), runId,
                event: dryRun ? 'PROPOSED' : 'APPLIED',
                action: 'DUP',
                clusterIds: g.supersedeIds,
                dryRun,
                reason: `exact duplicate of ${g.canonicalId} (normalized-exact; deterministic sweep, no LLM, confidence 1.0 by construction)`
            });
        } catch (e) { console.error('[DUP-SWEEP] Ledger append failed (non-fatal):', e); }
    }

    return { dryRun, groups: groups.length, supersededIds, canonicalOf };
}
