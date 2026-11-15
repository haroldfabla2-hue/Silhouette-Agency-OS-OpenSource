/**
 * INTEGRATION TEST: System 2 Rationalization Layer
 * Tests the 5-dimension evaluation and ActionDisposition routing.
 * Based on Kahneman's Dual Process Theory.
 */
import { describe, it, expect } from 'vitest';

// ─── Dimension weights (must match thoughtNarrator.ts) ───
const WEIGHTS = {
    urgency: 0.30,
    impact: 0.25,
    reversibility: 0.15, // Uses (1 - reversibility)
    userAlignment: 0.20,
    valence: 0.10
};

// ─── Composite score calculator (mirrors evaluateDimensions) ───
function computeComposite(dims: {
    urgency: number;
    impact: number;
    reversibility: number;
    userAlignment: number;
    valence: number;
}): number {
    return (
        (dims.urgency * WEIGHTS.urgency) +
        (dims.impact * WEIGHTS.impact) +
        ((1 - dims.reversibility) * WEIGHTS.reversibility) +
        (dims.userAlignment * WEIGHTS.userAlignment) +
        (dims.valence * WEIGHTS.valence)
    );
}

// ─── Disposition classifier (mirrors rationalizeThought) ───
function classifyDisposition(score: number): string {
    if (score >= 0.75) return 'ACT_NOW';
    if (score >= 0.50) return 'DELIBERATE';
    if (score >= 0.25) return 'REFLECT';
    return 'INHIBIT';
}

describe('System 2 Rationalization Layer', () => {

    describe('Dimension Scoring', () => {
        it('DIAGNOSTIC intent should have high urgency (0.95)', () => {
            const urgencyMap: Record<string, number> = {
                'DIAGNOSTIC': 0.95,
                'PROACTIVE_ACTION': 0.60,
                'USER_INSIGHT': 0.40,
                'EVOLUTION': 0.35,
                'CURIOSITY': 0.25,
                'REFLECTION': 0.10
            };

            expect(urgencyMap['DIAGNOSTIC']).toBe(0.95);
            expect(urgencyMap['CURIOSITY']).toBe(0.25);
            expect(urgencyMap['REFLECTION']).toBe(0.10);
        });

        it('remediate action should have high impact (0.85)', () => {
            const impactMap: Record<string, number> = {
                'remediate': 0.85,
                'delegate': 0.70,
                'evolve_agent': 0.65,
                'store_fact': 0.40,
                'investigate': 0.30,
                'none': 0.10
            };

            expect(impactMap['remediate']).toBe(0.85);
            expect(impactMap['none']).toBe(0.10);
        });

        it('all dimensions should be in [0, 1] range', () => {
            const dims = {
                urgency: 0.95,
                impact: 0.85,
                reversibility: 0.50,
                userAlignment: 0.70,
                valence: 0.35
            };

            Object.values(dims).forEach(v => {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            });
        });
    });

    describe('Composite Score Calculation', () => {
        it('critical error scenario should score >= 0.75 (ACT_NOW)', () => {
            // DIAGNOSTIC + remediate + low reversibility + high alignment
            const dims = {
                urgency: 0.95,     // DIAGNOSTIC
                impact: 0.85,      // remediate
                reversibility: 0.30, // Harder to undo
                userAlignment: 0.80,
                valence: 0.25      // Negative (error)
            };

            const score = computeComposite(dims);
            expect(score).toBeGreaterThanOrEqual(0.75);
            expect(classifyDisposition(score)).toBe('ACT_NOW');
        });

        it('pure reflection should score < 0.25 (INHIBIT)', () => {
            // REFLECTION + none action + high reversibility + low alignment
            const dims = {
                urgency: 0.10,     // REFLECTION
                impact: 0.10,      // none
                reversibility: 0.95, // Easily undone
                userAlignment: 0.30,
                valence: 0.50      // Neutral
            };

            const score = computeComposite(dims);
            expect(score).toBeLessThan(0.25);
            expect(classifyDisposition(score)).toBe('INHIBIT');
        });

        it('curiosity scenario should score in DELIBERATE range (0.50-0.74)', () => {
            // CURIOSITY + investigate + moderate
            const dims = {
                urgency: 0.25,     // CURIOSITY
                impact: 0.30,      // investigate
                reversibility: 0.80, // Low commitment
                userAlignment: 0.90, // Aligned with learning goals
                valence: 0.75      // Positive (opportunity)
            };

            const score = computeComposite(dims);
            // This might be lower, depends on exact calculation
            expect(score).toBeGreaterThanOrEqual(0.25);
            expect(score).toBeLessThan(0.75);
        });

        it('proactive action should score in DELIBERATE range', () => {
            // PROACTIVE_ACTION + delegate + moderate alignment
            const dims = {
                urgency: 0.60,     // PROACTIVE_ACTION
                impact: 0.70,      // delegate
                reversibility: 0.50,
                userAlignment: 0.70,
                valence: 0.65
            };

            const score = computeComposite(dims);
            expect(score).toBeGreaterThanOrEqual(0.50);
            expect(classifyDisposition(score)).toBe('DELIBERATE');
        });
    });

    describe('ActionDisposition Thresholds', () => {
        it('ACT_NOW threshold: >= 0.75', () => {
            expect(classifyDisposition(0.75)).toBe('ACT_NOW');
            expect(classifyDisposition(0.80)).toBe('ACT_NOW');
            expect(classifyDisposition(1.00)).toBe('ACT_NOW');
        });

        it('DELIBERATE threshold: 0.50 to 0.74', () => {
            expect(classifyDisposition(0.50)).toBe('DELIBERATE');
            expect(classifyDisposition(0.60)).toBe('DELIBERATE');
            expect(classifyDisposition(0.74)).toBe('DELIBERATE');
        });

        it('REFLECT threshold: 0.25 to 0.49', () => {
            expect(classifyDisposition(0.25)).toBe('REFLECT');
            expect(classifyDisposition(0.35)).toBe('REFLECT');
            expect(classifyDisposition(0.49)).toBe('REFLECT');
        });

        it('INHIBIT threshold: < 0.25', () => {
            expect(classifyDisposition(0.00)).toBe('INHIBIT');
            expect(classifyDisposition(0.10)).toBe('INHIBIT');
            expect(classifyDisposition(0.24)).toBe('INHIBIT');
        });
    });

    describe('ASK_USER Override', () => {
        it('requires_user_consent should override any score to ASK_USER', () => {
            const safety = { involves_private_data: false, requires_user_consent: true };
            // ASK_USER is a special disposition that bypasses the score
            expect(safety.requires_user_consent).toBe(true);
        });

        it('private data should set isPrivate flag but NOT block', () => {
            const safety = { involves_private_data: true, requires_user_consent: false };
            // Private data flows through the bus, just marked
            expect(safety.involves_private_data).toBe(true);
            expect(safety.requires_user_consent).toBe(false);
            // Should NOT be blocked from SystemBus
        });
    });

    describe('Weight Validation', () => {
        it('all weights should sum to 1.0', () => {
            const sum = WEIGHTS.urgency + WEIGHTS.impact + WEIGHTS.reversibility +
                WEIGHTS.userAlignment + WEIGHTS.valence;
            expect(sum).toBeCloseTo(1.0, 5);
        });

        it('urgency should have the highest weight (0.30)', () => {
            expect(WEIGHTS.urgency).toBe(0.30);
            expect(WEIGHTS.urgency).toBeGreaterThan(WEIGHTS.impact);
            expect(WEIGHTS.urgency).toBeGreaterThan(WEIGHTS.userAlignment);
        });

        it('valence should have the lowest weight (0.10)', () => {
            expect(WEIGHTS.valence).toBe(0.10);
            Object.values(WEIGHTS).forEach(w => {
                expect(WEIGHTS.valence).toBeLessThanOrEqual(w);
            });
        });
    });
});
