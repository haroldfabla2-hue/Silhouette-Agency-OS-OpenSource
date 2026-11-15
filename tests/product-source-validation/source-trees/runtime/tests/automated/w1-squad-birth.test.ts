import { describe, it, expect } from 'vitest';
import {
    resolveSquadName,
    generateDynamicIds,
    deriveDynamicCapabilities,
    buildDynamicLeaderInstruction,
} from '../../services/squads/dynamicBirth';
import { AgentCapability } from '../../types';

// W1 — dynamic agents must be born COMPLETE. Regression coverage for the
// factory fire test findings: "undefined Lead" naming, trailing-space IDs,
// and empty capabilities/systemInstruction on spawned leaders.
describe('W1 dynamic squad birth', () => {
    describe('resolveSquadName', () => {
        it('unwraps direct names', () => {
            expect(resolveSquadName({ name: 'Growth Squad' })).toBe('Growth Squad');
        });
        it('unwraps double-wrapped payloads (the "undefined Lead" regression)', () => {
            expect(resolveSquadName({ payload: { name: 'Growth Squad' } })).toBe('Growth Squad');
        });
        it('falls back honestly when no name exists', () => {
            expect(resolveSquadName({})).toBe('Unknown Squad');
            expect(resolveSquadName(undefined)).toBe('Unknown Squad');
        });
        it('never returns undefined', () => {
            for (const p of [{}, { payload: {} }, null, undefined, { name: '' }]) {
                const n = resolveSquadName(p);
                expect(typeof n).toBe('string');
                expect(n.length).toBeGreaterThan(0);
                expect(n).not.toContain('undefined');
            }
        });
    });

    describe('generateDynamicIds', () => {
        it('produces whitespace-free IDs', () => {
            const { squadId, leaderId } = generateDynamicIds(1791955650139);
            expect(squadId).toBe('SQ_DYN_1791955650139');
            expect(leaderId).toBe('agt_dyn_1791955650139');
            expect(squadId).not.toMatch(/\s/);
            expect(leaderId).not.toMatch(/\s/);
        });
        it('defaults to current time and stays unique-ish per call', () => {
            const a = generateDynamicIds();
            expect(a.squadId).toMatch(/^SQ_DYN_\d+$/);
            expect(a.leaderId).toMatch(/^agt_dyn_\d+$/);
        });
    });

    describe('deriveDynamicCapabilities', () => {
        it('respects valid payload capabilities and drops unknown entries', () => {
            const caps = deriveDynamicCapabilities({
                capabilities: [AgentCapability.QA_TESTING, 'NOPE_NOT_REAL', 42],
            });
            expect(caps).toEqual([AgentCapability.QA_TESTING]);
        });
        it('falls through to derivation when payload capabilities are all invalid', () => {
            const caps = deriveDynamicCapabilities({ capabilities: ['NOPE'], role: 'Frontend Developer' });
            expect(caps).toContain(AgentCapability.CODE_GENERATION);
        });
        it('derives role-coherent capabilities when payload has none', () => {
            expect(deriveDynamicCapabilities({ role: 'Frontend Developer' })).toContain(AgentCapability.CODE_GENERATION);
            expect(deriveDynamicCapabilities({ role: 'QA Engineer' })).toContain(AgentCapability.QA_TESTING);
            expect(deriveDynamicCapabilities({ role: 'UX Designer' })).toContain(AgentCapability.VISUAL_DESIGN);
            expect(deriveDynamicCapabilities({ role: 'Security Auditor' })).toContain(AgentCapability.SECURITY_AUDIT);
        });
        it('always includes the base set (memory, web, context)', () => {
            const caps = deriveDynamicCapabilities({});
            expect(caps).toContain(AgentCapability.CONTEXT_MANAGEMENT);
            expect(caps).toContain(AgentCapability.TOOL_MEMORY_WRITE);
            expect(caps).toContain(AgentCapability.TOOL_WEB_SEARCH);
        });
        it('never returns an empty array (no more husk agents)', () => {
            for (const p of [{}, { role: 'Project Coordinator' }, { capabilities: [] }]) {
                expect(deriveDynamicCapabilities(p).length).toBeGreaterThan(0);
            }
        });
    });

    describe('buildDynamicLeaderInstruction', () => {
        it('embeds identity, role, chain of command and the honesty contract', () => {
            const ins = buildDynamicLeaderInstruction('Growth Squad', { role: 'Marketing Lead', category: 'MARKETING' });
            expect(ins).toContain('Growth Squad Lead');
            expect(ins).toContain('Marketing Lead');
            expect(ins).toContain('MARKETING');
            expect(ins).toMatch(/Orchestrator -> Squad Leader/);
            expect(ins).toMatch(/UNAVAILABLE/);
            expect(ins).toMatch(/never claim completion/i);
            expect(ins).toMatch(/never fabricate/i);
        });
        it('handles empty payloads without undefined leakage', () => {
            const ins = buildDynamicLeaderInstruction('Unknown Squad', {});
            expect(ins).not.toMatch(/undefined/);
            expect(ins.length).toBeGreaterThan(100);
        });
    });
});
