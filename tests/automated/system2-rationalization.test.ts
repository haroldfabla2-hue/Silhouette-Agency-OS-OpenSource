/**
 * INTEGRATION TEST: System 2 Rationalization Layer
 * Tests the 5-dimension evaluation and ActionDisposition routing.
 * Based on Kahneman's Dual Process Theory.
 *
 * These tests import the REAL decision logic from
 * services/cognitive/rationalization.ts — the same module ThoughtNarrator
 * uses in production. If weights, thresholds, or mappings change, these
 * tests fail. (The previous version of this file re-implemented the logic
 * inline, so it could never catch a production change.)
 */
import { describe, it, expect } from 'vitest';
import {
    WEIGHTS,
    DISPOSITION_THRESHOLDS,
    URGENCY_BY_INTENT,
    computeUrgency,
    computeImpact,
    computeReversibility,
    computeUserAlignment,
    computeLinguisticValence,
    mapQualiaValence,
    blendValence,
    computeComposite,
    classifyDisposition,
    classifyWithConsent
} from '../../services/cognitive/rationalization';

describe('System 2 Rationalization Layer (real module)', () => {

    describe('classifyDisposition — threshold edges', () => {
        it('composite >= 0.75 → ACT_NOW', () => {
            expect(classifyDisposition(DISPOSITION_THRESHOLDS.ACT_NOW)).toBe('ACT_NOW');
            expect(classifyDisposition(0.99)).toBe('ACT_NOW');
        });

        it('0.74 → DELIBERATE (just below ACT_NOW)', () => {
            expect(classifyDisposition(0.74)).toBe('DELIBERATE');
        });

        it('0.50 → DELIBERATE, 0.49 → REFLECT', () => {
            expect(classifyDisposition(DISPOSITION_THRESHOLDS.DELIBERATE)).toBe('DELIBERATE');
            expect(classifyDisposition(0.49)).toBe('REFLECT');
        });

        it('0.25 → REFLECT, 0.24 → INHIBIT', () => {
            expect(classifyDisposition(DISPOSITION_THRESHOLDS.REFLECT)).toBe('REFLECT');
            expect(classifyDisposition(0.24)).toBe('INHIBIT');
            expect(classifyDisposition(0)).toBe('INHIBIT');
        });
    });

    describe('classifyWithConsent — user consent override', () => {
        it('requires_user_consent always yields ASK_USER, even at max score', () => {
            expect(classifyWithConsent({ requires_user_consent: true }, 0.99)).toBe('ASK_USER');
            expect(classifyWithConsent({ requires_user_consent: true }, 0.10)).toBe('ASK_USER');
        });

        it('without the flag it falls through to score classification', () => {
            expect(classifyWithConsent({ requires_user_consent: false }, 0.80)).toBe('ACT_NOW');
            expect(classifyWithConsent(undefined, 0.10)).toBe('INHIBIT');
            expect(classifyWithConsent({}, 0.60)).toBe('DELIBERATE');
        });
    });

    describe('computeComposite — weighting', () => {
        it('perfect impulse (max everything, zero reversibility) scores 1.0', () => {
            const composite = computeComposite({
                urgency: 1, impact: 1, reversibility: 0, userAlignment: 1, valence: 1
            });
            expect(composite).toBeCloseTo(1.0, 10);
        });

        it('fully reversible, neutral dimensions score below ACT_NOW', () => {
            const composite = computeComposite({
                urgency: 0.5, impact: 0.5, reversibility: 1, userAlignment: 0.5, valence: 0.5
            });
            expect(composite).toBeCloseTo(0.425, 10); // 0.15+0.125+0+0.10+0.05
            expect(classifyDisposition(composite)).toBe('REFLECT');
        });

        it('weights sum to 1.0', () => {
            const total = WEIGHTS.urgency + WEIGHTS.impact + WEIGHTS.reversibility
                + WEIGHTS.userAlignment + WEIGHTS.valence;
            expect(total).toBeCloseTo(1.0, 10);
        });

        it('composite stays within [0, 1] for extreme dimension values', () => {
            const low = computeComposite({ urgency: 0, impact: 0, reversibility: 1, userAlignment: 0, valence: 0 });
            const high = computeComposite({ urgency: 1, impact: 1, reversibility: 0, userAlignment: 1, valence: 1 });
            expect(low).toBeGreaterThanOrEqual(0);
            expect(low).toBeLessThanOrEqual(1);
            expect(high).toBeLessThanOrEqual(1 + 1e-9); // 0.3+0.25+0.15+0.2+0.1 has float error
            expect(high).toBeCloseTo(1, 10);
            expect(high).toBeGreaterThan(low);
        });
    });

    describe('monotonicity — more pressure never lowers the score', () => {
        const base = { urgency: 0.5, impact: 0.5, reversibility: 0.5, userAlignment: 0.5, valence: 0.5 };

        it('raising urgency raises composite', () => {
            expect(computeComposite({ ...base, urgency: 0.9 }))
                .toBeGreaterThan(computeComposite(base));
        });

        it('raising impact raises composite', () => {
            expect(computeComposite({ ...base, impact: 0.9 }))
                .toBeGreaterThan(computeComposite(base));
        });

        it('LOWER reversibility (harder to undo) raises composite', () => {
            expect(computeComposite({ ...base, reversibility: 0.1 }))
                .toBeGreaterThan(computeComposite(base));
        });
    });

    describe('computeUrgency — intent mapping', () => {
        it('DIAGNOSTIC intent has highest urgency (0.95 at full confidence)', () => {
            expect(computeUrgency('DIAGNOSTIC', 1.0)).toBeCloseTo(0.95, 10);
        });

        it('CURIOSITY is low urgency, REFLECTION lowest', () => {
            expect(computeUrgency('CURIOSITY', 1.0)).toBeCloseTo(0.30, 10);
            expect(computeUrgency('REFLECTION', 1.0)).toBeCloseTo(0.10, 10);
        });

        it('unknown intent falls back to default 0.3', () => {
            expect(computeUrgency('SOMETHING_ELSE', 1.0)).toBeCloseTo(0.3, 10);
        });

        it('confidence scales urgency', () => {
            expect(computeUrgency('DIAGNOSTIC', 0.5)).toBeCloseTo(0.475, 10);
        });

        it('every known intent maps to a value in (0, 1]', () => {
            for (const intent of Object.keys(URGENCY_BY_INTENT)) {
                const u = computeUrgency(intent, 1.0);
                expect(u).toBeGreaterThan(0);
                expect(u).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('computeImpact / computeReversibility — action-type maps', () => {
        it('execute_task is high impact and hard to reverse', () => {
            expect(computeImpact('execute_task')).toBeCloseTo(0.90, 10);
            expect(computeReversibility('execute_task')).toBeCloseTo(0.30, 10);
        });

        it('"none" action is minimal impact and fully reversible', () => {
            expect(computeImpact('none')).toBeCloseTo(0.05, 10);
            expect(computeReversibility('none')).toBeCloseTo(1.0, 10);
        });

        it('unknown action types fall back to defaults', () => {
            expect(computeImpact('teleport')).toBeCloseTo(0.3, 10);
            expect(computeReversibility('teleport')).toBeCloseTo(0.5, 10);
        });
    });

    describe('computeUserAlignment', () => {
        it('neutral (0.5) when no user facts exist', () => {
            expect(computeUserAlignment('improve the memory system', [])).toBe(0.5);
        });

        it('rises with each fact that shares significant words with the thought', () => {
            const facts = [
                { content: 'User is building a memory system for agents' },
                { content: 'User prefers open source tooling' }
            ];
            const aligned = computeUserAlignment('Improve the memory system', facts);
            expect(aligned).toBeGreaterThan(0.3);
            expect(aligned).toBeLessThanOrEqual(1.0);
        });

        it('no overlap keeps the 0.3 base', () => {
            const facts = [{ content: 'User enjoys hiking on weekends' }];
            expect(computeUserAlignment('Fix the database connection pool', facts)).toBeCloseTo(0.3, 10);
        });
    });

    describe('valence — linguistic, qualia mapping, and blend', () => {
        it('positive language raises linguistic valence', () => {
            expect(computeLinguisticValence('An opportunity to improve and help')).toBeCloseTo(0.75, 10);
        });

        it('negative language lowers linguistic valence', () => {
            expect(computeLinguisticValence('Error and failure risk detected')).toBeCloseTo(0.35, 10);
        });

        it('stays within [0, 1] on stacked signals', () => {
            const v = computeLinguisticValence('opportunity to improve, but error risk of crash');
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        });

        it('maps qualia labels to numeric valence', () => {
            expect(mapQualiaValence('POSITIVE')).toBe(0.75);
            expect(mapQualiaValence('NEGATIVE')).toBe(0.25);
            expect(mapQualiaValence('NEUTRAL')).toBe(0.5);
        });

        it('without qualia, linguistic valence is used in full', () => {
            expect(blendValence(null, 0.8)).toBeCloseTo(0.8, 10);
        });

        it('with qualia, blend is 60% qualia + 40% linguistic', () => {
            expect(blendValence(0.75, 0.5)).toBeCloseTo(0.65, 10);
        });
    });
});
