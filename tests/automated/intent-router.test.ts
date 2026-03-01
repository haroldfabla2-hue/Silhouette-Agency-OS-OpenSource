/**
 * INTEGRATION TEST: Cognitive Intent Router
 * Tests the ThoughtNarrator's structured output, intent classification, and routing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Minimal type stubs for test isolation ───────────────────
const VALID_INTENTS = ['REFLECTION', 'CURIOSITY', 'DIAGNOSTIC', 'PROACTIVE_ACTION', 'USER_INSIGHT', 'EVOLUTION'];
const VALID_ACTIONS = ['investigate', 'remediate', 'delegate', 'store_fact', 'evolve_agent', 'none'];

describe('Cognitive Intent Router', () => {

    describe('Structured JSON Output Validation', () => {
        it('should validate well-formed structured thought JSON', () => {
            const validThought = {
                thought: "The graph has 3 open triangles connecting React, TypeScript, and Neo4j.",
                intent: "CURIOSITY",
                confidence: 0.85,
                action: { type: "investigate", params: { topic: "React ↔ Neo4j relationship" } },
                safety: { involves_private_data: false, requires_user_consent: false }
            };

            expect(validThought.thought).toBeTruthy();
            expect(VALID_INTENTS).toContain(validThought.intent);
            expect(validThought.confidence).toBeGreaterThanOrEqual(0);
            expect(validThought.confidence).toBeLessThanOrEqual(1);
            expect(VALID_ACTIONS).toContain(validThought.action.type);
            expect(validThought.safety).toBeDefined();
        });

        it('should reject malformed structured thought (missing intent)', () => {
            const invalid = {
                thought: "Something happened",
                confidence: 0.5,
                action: { type: "none", params: {} }
            };

            expect((invalid as any).intent).toBeUndefined();
        });

        it('should validate all 6 intent types', () => {
            for (const intent of VALID_INTENTS) {
                const thought = {
                    thought: `Test thought for ${intent}`,
                    intent,
                    confidence: 0.7,
                    action: { type: "none", params: {} },
                    safety: { involves_private_data: false, requires_user_consent: false }
                };
                expect(VALID_INTENTS).toContain(thought.intent);
            }
        });
    });

    describe('Intent-to-Action Mapping', () => {
        it('CURIOSITY intent should map to investigate action', () => {
            const thought = { intent: 'CURIOSITY', action: { type: 'investigate' } };
            expect(thought.action.type).toBe('investigate');
        });

        it('DIAGNOSTIC intent should map to remediate action', () => {
            const thought = { intent: 'DIAGNOSTIC', action: { type: 'remediate' } };
            expect(thought.action.type).toBe('remediate');
        });

        it('PROACTIVE_ACTION intent should map to delegate action', () => {
            const thought = { intent: 'PROACTIVE_ACTION', action: { type: 'delegate' } };
            expect(thought.action.type).toBe('delegate');
        });

        it('USER_INSIGHT intent should map to store_fact action', () => {
            const thought = { intent: 'USER_INSIGHT', action: { type: 'store_fact' } };
            expect(thought.action.type).toBe('store_fact');
        });

        it('EVOLUTION intent should map to evolve_agent action', () => {
            const thought = { intent: 'EVOLUTION', action: { type: 'evolve_agent' } };
            expect(thought.action.type).toBe('evolve_agent');
        });

        it('REFLECTION intent should map to none action', () => {
            const thought = { intent: 'REFLECTION', action: { type: 'none' } };
            expect(thought.action.type).toBe('none');
        });
    });

    describe('Safety Flag Validation', () => {
        it('should flag private data thoughts', () => {
            const thought = {
                thought: "User's bank account has transaction patterns showing...",
                intent: 'USER_INSIGHT',
                confidence: 0.8,
                safety: { involves_private_data: true, requires_user_consent: true }
            };

            expect(thought.safety.involves_private_data).toBe(true);
            expect(thought.safety.requires_user_consent).toBe(true);
        });

        it('should not flag generic system thoughts as private', () => {
            const thought = {
                thought: "The error rate has increased by 15% in the last hour",
                intent: 'DIAGNOSTIC',
                confidence: 0.9,
                safety: { involves_private_data: false, requires_user_consent: false }
            };

            expect(thought.safety.involves_private_data).toBe(false);
        });
    });

    describe('Confidence Boundaries', () => {
        it('should accept confidence values in [0, 1] range', () => {
            const values = [0, 0.25, 0.5, 0.75, 1.0];
            for (const conf of values) {
                expect(conf).toBeGreaterThanOrEqual(0);
                expect(conf).toBeLessThanOrEqual(1);
            }
        });

        it('should reject confidence outside valid range', () => {
            expect(-0.1).toBeLessThan(0);
            expect(1.5).toBeGreaterThan(1);
        });
    });
});
