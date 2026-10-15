/**
 * [W5] Narrative filler policy — the quota honesty gate for the inner voice.
 *
 * Factory fire test finding: with LLM providers exhausted, NarrativeService
 * fell back to REGEX narration — fabricating first-person prose for system
 * noise ("My internal systems report: ...", "I sense a void in my
 * understanding: ... analogous to insulin-mediated glucose regulation").
 * That filler is doubly dishonest: it fabricates an inner voice that no
 * model produced, and chasing it burns the shared free-tier quota the real
 * work needs.
 *
 * Policy (env-driven, nothing hardcoded):
 *   SILHOUETTE_NARRATIVE_FILLER=off   (DEFAULT) — no regex narration of
 *                                     system noise, no LLM rephrasing below
 *                                     the importance threshold. Dropped
 *                                     thoughts stay in memory; narration is
 *                                     presentation, not record.
 *   SILHOUETTE_NARRATIVE_FILLER=on    — legacy behavior (regex fallback).
 *   SILHOUETTE_NARRATIVE_MIN_IMPORTANCE — LLM narration threshold
 *                                     (default 0.7; legacy queued >= 0.3).
 */
export function fillerEnabled(): boolean {
    return (process.env.SILHOUETTE_NARRATIVE_FILLER || 'off').toLowerCase() === 'on';
}

export function minLlmImportance(): number {
    const n = Number(process.env.SILHOUETTE_NARRATIVE_MIN_IMPORTANCE);
    if (!Number.isFinite(n) || n <= 0 || n > 1) return 0.7;
    return n;
}

export type NarrativeRoute = 'DROP' | 'LLM' | 'REGEX';

/**
 * Where a thought of a given importance goes. With filler off: below the
 * threshold it is dropped (honest silence); at/above it goes to the LLM
 * batch, and if providers fail the batch is dropped rather than
 * regex-fabricated. With filler on: legacy routing (regex under 0.3).
 */
export function routeThought(importance: number): NarrativeRoute {
    if (!fillerEnabled()) {
        return importance >= minLlmImportance() ? 'LLM' : 'DROP';
    }
    return importance < 0.3 ? 'REGEX' : 'LLM';
}
