import { describe, it, expect } from 'vitest';
import { resolveAgentTarget } from '../../services/org/agentLocator';
import { Agent, AgentRoleType, AgentStatus, AgentTier } from '../../types';

function fakeAgent(id: string, name: string): Agent {
    return {
        id, name, teamId: 'TEAM_CORE', category: 'CORE',
        roleType: AgentRoleType.LEADER, role: 'r', status: AgentStatus.WORKING,
        enabled: true, preferredMemory: 'RAM', memoryLocation: 'RAM',
        cpuUsage: 1, ramUsage: 1, lastActive: 0, tier: AgentTier.CORE,
    };
}

const AGENTS = [
    fakeAgent('core-01', 'Orchestrator_Prime'),
    fakeAgent('core-02', 'Intent_Analyzer_Alpha'),
    fakeAgent('agt_dyn_1791955650139 ', 'Growth Lead'), // legacy trailing space
];

describe('W4 agent locator', () => {
    it('resolves exact IDs', () => {
        expect(resolveAgentTarget('core-02', AGENTS)?.name).toBe('Intent_Analyzer_Alpha');
    });
    it('resolves the Orchestrator alias to core-01 (the fire-test bug)', () => {
        expect(resolveAgentTarget('Orchestrator', AGENTS)?.id).toBe('core-01');
        expect(resolveAgentTarget('orchestrator', AGENTS)?.id).toBe('core-01');
        expect(resolveAgentTarget('Orchestrator_Prime', AGENTS)?.id).toBe('core-01');
    });
    it('resolves legacy trailing-space IDs both directions', () => {
        expect(resolveAgentTarget('agt_dyn_1791955650139', AGENTS)?.name).toBe('Growth Lead');
        expect(resolveAgentTarget('agt_dyn_1791955650139 ', AGENTS)?.name).toBe('Growth Lead');
    });
    it('fails loudly (undefined) for unknown targets — no silent rot', () => {
        expect(resolveAgentTarget('Nobody', AGENTS)).toBeUndefined();
        expect(resolveAgentTarget('', AGENTS)).toBeUndefined();
        expect(resolveAgentTarget('  ', AGENTS)).toBeUndefined();
        expect(resolveAgentTarget(undefined, AGENTS)).toBeUndefined();
    });
});
