/**
 * 🧠 Rationalization Layer (System 2) — Pure decision logic.
 *
 * Extracted from ThoughtNarrator (services/cognitive/thoughtNarrator.ts) so the
 * weighting and disposition logic has a single source of truth that production
 * code AND tests import. Everything in this module is pure: no I/O, no imports
 * from the runtime, no side effects. Behavior is identical to the inline
 * implementation it replaces.
 *
 * Based on:
 *   - Kahneman (2011): System 1 (fast) vs System 2 (slow)
 *   - Strack & Deutsch (2004): Reflective-Impulsive Model (RIM)
 *   - Gross (2015): Emotion Regulation — Cognitive Reappraisal
 */

export type Disposition = 'ACT_NOW' | 'DELIBERATE' | 'REFLECT' | 'INHIBIT' | 'ASK_USER';

export interface Dimensions {
    urgency: number;
    impact: number;
    reversibility: number;
    userAlignment: number;
    valence: number;
}

export interface ScoredDimensions extends Dimensions {
    composite: number;
}

/**
 * Composite weights for the 5 psychological dimensions.
 * Inspired by the Reflective-Impulsive Model: irreversible impulses weigh more.
 */
export const WEIGHTS = {
    urgency: 0.30,
    impact: 0.25,
    reversibility: 0.15,
    userAlignment: 0.20,
    valence: 0.10
} as const;

/** Composite score thresholds that map a score to a disposition. */
export const DISPOSITION_THRESHOLDS = {
    ACT_NOW: 0.75,
    DELIBERATE: 0.50,
    REFLECT: 0.25
} as const;

/** How time-sensitive is this thought? Errors are urgent, curiosity is not. */
export const URGENCY_BY_INTENT: Record<string, number> = {
    'DIAGNOSTIC': 0.95,       // System is broken → fix NOW
    'PROACTIVE_ACTION': 0.60, // Opportunity, moderate urgency
    'USER_INSIGHT': 0.40,     // Useful but not time-sensitive
    'EVOLUTION': 0.35,        // Long-term improvement
    'CURIOSITY': 0.30,        // Interesting but can wait
    'REFLECTION': 0.10        // No urgency at all
};

/** How significant would the resulting action be? */
export const IMPACT_BY_ACTION_TYPE: Record<string, number> = {
    'execute_task': 0.90,     // Running a task = high impact
    'remediate': 0.85,        // Fixing errors = high impact
    'evolve_agent': 0.70,     // Evolving an agent = moderate-high
    'research_gap': 0.40,     // Research = moderate
    'store_fact': 0.20,       // Storing data = low impact
    'none': 0.05              // No action = minimal
};

/** Can the action be undone? Higher = more reversible = safer to act. */
export const REVERSIBILITY_BY_ACTION_TYPE: Record<string, number> = {
    'none': 1.0,              // No action = perfectly reversible
    'store_fact': 0.95,       // Can delete a fact
    'research_gap': 0.90,     // Research is harmless
    'evolve_agent': 0.60,     // Can roll back but complex
    'remediate': 0.50,        // Fixes may have side effects
    'execute_task': 0.30      // Tasks may be hard to undo
};

export const DEFAULT_URGENCY = 0.3;
export const DEFAULT_IMPACT = 0.3;
export const DEFAULT_REVERSIBILITY = 0.5;
export const NEUTRAL_SCORE = 0.5;

/** DIMENSION 1: URGENCY (U) — intent urgency scaled by the LLM's confidence. */
export function computeUrgency(intent: string, confidence: number): number {
    return (URGENCY_BY_INTENT[intent] ?? DEFAULT_URGENCY) * confidence;
}

/** DIMENSION 2: IMPACT (I) — significance of the proposed action type. */
export function computeImpact(actionType: string): number {
    return IMPACT_BY_ACTION_TYPE[actionType] ?? DEFAULT_IMPACT;
}

/** DIMENSION 3: REVERSIBILITY (R) — how undoable the action type is. */
export function computeReversibility(actionType: string): number {
    return REVERSIBILITY_BY_ACTION_TYPE[actionType] ?? DEFAULT_REVERSIBILITY;
}

/**
 * DIMENSION 4: USER ALIGNMENT (A) — overlap between the thought and known
 * user facts. More matching facts = higher alignment. Neutral (0.5) when no
 * facts are known.
 */
export function computeUserAlignment(thought: string, userFacts: { content?: string }[]): number {
    if (userFacts.length === 0) return NEUTRAL_SCORE;

    const thoughtLower = thought.toLowerCase();
    let matchCount = 0;
    for (const fact of userFacts) {
        const factContent = (fact.content || '').toLowerCase();
        // Simple semantic overlap: count shared significant words
        const factWords = factContent.split(/\s+/).filter((w: string) => w.length > 4);
        const hasOverlap = factWords.some((w: string) => thoughtLower.includes(w));
        if (hasOverlap) matchCount++;
    }
    return Math.min(1.0, 0.3 + (matchCount * 0.2));
}

const POSITIVE_PATTERNS = /\b(opportunit|discover|improve|help|creat|optimi|innovat|benefit|solv|succeed|grow)\w*/i;
const NEGATIVE_PATTERNS = /\b(error|fail|risk|danger|broke|crash|corrupt|leak|vulnerab|degrad|overload)\w*/i;

/** DIMENSION 5 (linguistic half): emotional tone of the thought text. */
export function computeLinguisticValence(thought: string): number {
    const t = thought.toLowerCase();
    let valence = NEUTRAL_SCORE;
    if (POSITIVE_PATTERNS.test(t)) valence += 0.25;
    if (NEGATIVE_PATTERNS.test(t)) valence -= 0.15;
    return Math.min(1.0, Math.max(0.0, valence));
}

/** Map a Qualia valence label from the ConsciousnessEngine to a number. */
export function mapQualiaValence(qualia: string): number {
    if (qualia === 'POSITIVE') return 0.75;
    if (qualia === 'NEGATIVE') return 0.25;
    return NEUTRAL_SCORE;
}

/**
 * Blend real Qualia with linguistic analysis.
 * With Qualia: 60% Qualia + 40% linguistic. Without: full linguistic.
 */
export function blendValence(qualiaValence: number | null, linguisticValence: number): number {
    if (qualiaValence === null) return linguisticValence;
    return (qualiaValence * 0.6) + (linguisticValence * 0.4);
}

/** Weighted composite score across the 5 dimensions (RIM-inspired). */
export function computeComposite(dims: Dimensions): number {
    return (
        (dims.urgency * WEIGHTS.urgency) +
        (dims.impact * WEIGHTS.impact) +
        ((1 - dims.reversibility) * WEIGHTS.reversibility) + // Irreversible actions weigh more
        (dims.userAlignment * WEIGHTS.userAlignment) +
        (dims.valence * WEIGHTS.valence)
    );
}

/** Map a composite score to an action disposition via the thresholds. */
export function classifyDisposition(composite: number): 'ACT_NOW' | 'DELIBERATE' | 'REFLECT' | 'INHIBIT' {
    if (composite >= DISPOSITION_THRESHOLDS.ACT_NOW) return 'ACT_NOW';
    if (composite >= DISPOSITION_THRESHOLDS.DELIBERATE) return 'DELIBERATE';
    if (composite >= DISPOSITION_THRESHOLDS.REFLECT) return 'REFLECT';
    return 'INHIBIT';
}

/**
 * Full disposition decision: explicit user-consent flags always win over the
 * score. This is the gate that keeps the autonomous loop accountable.
 */
export function classifyWithConsent(
    safety: { requires_user_consent?: boolean } | undefined,
    composite: number
): Disposition {
    if (safety?.requires_user_consent) return 'ASK_USER';
    return classifyDisposition(composite);
}
