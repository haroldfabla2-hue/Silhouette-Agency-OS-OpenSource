import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { loadOrganization, teamOfAgent, teamsForDomain, headOfTeam } from '../../services/org/organization';
import { ReputationLedger } from '../../services/org/reputationLedger';
import { computeReputation, rankByReputation, REPUTATION_FORMULA_VERSION, REPUTATION_PRIOR } from '../../services/org/reputation';
import { emitHelpResponse, requestCollaboration, subscribeHelpProtocol } from '../../services/communication/helpProtocol';
import { systemBus } from '../../services/systemBus';
import type { AgentLike } from '../../services/org/types';

const tmpDirs: string[] = [];
function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-test-'));
    tmpDirs.push(dir);
    return dir;
}
const cleanups: (() => void)[] = [];
afterEach(() => {
    cleanups.splice(0).forEach(off => off());
    tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});
async function mailbox(id: string) {
    await new Promise(resolve => setImmediate(resolve));
    return systemBus.checkMailbox(id);
}

const SEED_AGENTS: AgentLike[] = [
    { id: 'core-01', name: 'Orchestrator_Prime', role: 'System Controller', teamId: 'TEAM_CORE', roleType: 'LEADER' },
    { id: 'core-02', name: 'Intent_Analyzer_Alpha', role: 'Prompt Engineer Lead', teamId: 'TEAM_CORE', roleType: 'WORKER' },
    { id: 'ctx-01', name: 'The_Librarian', role: 'Context Keeper', teamId: 'TEAM_CONTEXT', roleType: 'LEADER' },
    { id: 'ctx-02', name: 'Archivist', role: 'Archive Worker', teamId: 'TEAM_CONTEXT', roleType: 'WORKER' },
    { id: 'lone-01', name: 'Lone_Wolf', role: 'Unaffiliated' }
];

describe('organization as data', () => {
    it('derives a seed org from known agents: teams by teamId, head = LEADER, rest executors', () => {
        const chart = loadOrganization(path.join(tmpDir(), 'absent.json'), SEED_AGENTS);
        expect(chart.teams).toHaveLength(2);
        const core = chart.teams.find(t => t.id === 'TEAM_CORE')!;
        expect(core.headAgentId).toBe('core-01');
        expect(core.memberAgentIds).toEqual(['core-02']);
        expect(chart.unassignedAgentIds).toEqual(['lone-01']);
        expect(core.tenantId).toBe('default');
    });
    it('loads a valid organization.json override with its own heads, members and domains', () => {
        const file = path.join(tmpDir(), 'organization.json');
        fs.writeFileSync(file, JSON.stringify({
            version: 1,
            teams: [{ id: 'TEAM_CORE', name: 'core', headAgentId: 'core-02', memberAgentIds: ['core-01'], domains: ['routing'] }]
        }));
        const chart = loadOrganization(file, SEED_AGENTS);
        const core = chart.teams.find(t => t.id === 'TEAM_CORE')!;
        expect(core.headAgentId).toBe('core-02');
        expect(core.domains).toEqual(['routing']);
        // agents not listed in the file stay routable as unassigned
        expect(chart.unassignedAgentIds).toContain('ctx-01');
    });
    it('falls back loudly to the seed org when the file is invalid', () => {
        const file = path.join(tmpDir(), 'organization.json');
        fs.writeFileSync(file, '{"version": 99}');
        const chart = loadOrganization(file, SEED_AGENTS);
        expect(chart.teams.find(t => t.id === 'TEAM_CORE')!.headAgentId).toBe('core-01');
    });
    it('answers roster lookups: team of an agent, teams for a domain, head of a team', () => {
        const chart = loadOrganization(path.join(tmpDir(), 'absent.json'), SEED_AGENTS);
        expect(teamOfAgent(chart, 'ctx-02')!.id).toBe('TEAM_CONTEXT');
        expect(teamOfAgent(chart, 'lone-01')).toBeNull();
        expect(teamsForDomain(chart, 'context').map(t => t.id)).toContain('TEAM_CONTEXT');
        expect(headOfTeam(chart, 'TEAM_CORE')).toBe('core-01');
    });
});

describe('reputation ledger (append-only facts)', () => {
    it('appends facts with monotonic seq and reads them back; facts are never mutated', () => {
        const ledger = new ReputationLedger(path.join(tmpDir(), 'rep.jsonl'));
        ledger.append({ ts: 1, type: 'COLLAB_REQUESTED', agentId: 'a', counterpartId: 'b', reason: 'routed' });
        ledger.append({ ts: 2, type: 'COLLAB_HELPED', agentId: 'a', counterpartId: 'b', success: true, latencyMs: 100, reason: 'helped' });
        const all = ledger.readAll();
        expect(all.map(f => f.seq)).toEqual([1, 2]);
        expect(ledger.factsAbout('a')).toHaveLength(2);
        expect(ledger.factsAbout('b')).toHaveLength(0);
    });
    it('requires a non-empty reason and an agentId (audit trail discipline)', () => {
        const ledger = new ReputationLedger(path.join(tmpDir(), 'rep.jsonl'));
        expect(() => ledger.append({ ts: 1, type: 'COLLAB_REQUESTED', agentId: 'a', reason: '' })).toThrow();
        expect(() => ledger.append({ ts: 1, type: 'COLLAB_REQUESTED', agentId: '', reason: 'x' })).toThrow();
    });
});

describe('reputation derived from evidence (scores are never stored)', () => {
    function ledgerWith(facts: Array<Partial<import('../../services/org/reputationLedger').ReputationFact>>): ReputationLedger {
        const ledger = new ReputationLedger(path.join(tmpDir(), 'rep.jsonl'));
        facts.forEach((f, i) => ledger.append({ ts: i + 1, reason: 'test', type: 'COLLAB_HELPED', agentId: 'a', ...f } as any));
        return ledger;
    }
    it('cold start: no evidence -> prior 0.5 with zero confidence (new agents neither punished nor privileged)', () => {
        const report = computeReputation(ledgerWith([]), 'a');
        expect(report.score).toBe(REPUTATION_PRIOR);
        expect(report.confidence).toBe(0);
        expect(report.scope).toBe('global');
        expect(report.formulaVersion).toBe(REPUTATION_FORMULA_VERSION);
    });
    it('consistent helpful work raises the score above the prior; failures push it below', () => {
        const good = computeReputation(ledgerWith([
            { type: 'COLLAB_REQUESTED' }, { type: 'COLLAB_REQUESTED' },
            { success: true, latencyMs: 100 }, { success: true, latencyMs: 200 }
        ]), 'a');
        expect(good.score).toBeGreaterThan(REPUTATION_PRIOR);
        const bad = computeReputation(ledgerWith([
            { type: 'COLLAB_REQUESTED' }, { type: 'COLLAB_REQUESTED' },
            { success: false, latencyMs: 100 }, { success: false, latencyMs: 200 }
        ]), 'a');
        expect(bad.score).toBeLessThan(REPUTATION_PRIOR);
        expect(good.score).toBeGreaterThan(bad.score);
    });
    it('is deterministic: same ledger + same formula version -> identical score', () => {
        const facts = [{ type: 'COLLAB_REQUESTED' }, { success: true, latencyMs: 500 }];
        const r1 = computeReputation(ledgerWith(facts), 'a');
        const r2 = computeReputation(ledgerWith(facts), 'a');
        expect(r1.score).toBe(r2.score);
    });
    it('conditions on context and falls back to the global card when local evidence is thin', () => {
        const facts = [
            { type: 'COLLAB_REQUESTED', context: 'research' }, { type: 'COLLAB_REQUESTED', context: 'research' },
            { type: 'COLLAB_REQUESTED', context: 'research' },
            { success: true, latencyMs: 50, context: 'research' },
            { success: true, latencyMs: 50, context: 'research' },
            { success: true, latencyMs: 50, context: 'research' },
            { success: false, latencyMs: 50, context: 'writing' }
        ];
        const ledger = ledgerWith(facts);
        const scoped = computeReputation(ledger, 'a', 'research');
        expect(scoped.scope).toBe('context');
        // 'writing' has only 1 fact < MIN_CONTEXT_EVIDENCE -> global fallback, visibly marked
        const fallback = computeReputation(ledger, 'a', 'writing');
        expect(fallback.scope).toBe('global-fallback');
    });
    it('ranks candidates by score and keeps stable order on ties', () => {
        const ledger = new ReputationLedger(path.join(tmpDir(), 'rep.jsonl'));
        ledger.append({ ts: 1, type: 'COLLAB_REQUESTED', agentId: 'good', reason: 'r' });
        ledger.append({ ts: 2, type: 'COLLAB_HELPED', agentId: 'good', success: true, latencyMs: 10, reason: 'r' });
        ledger.append({ ts: 3, type: 'COLLAB_REQUESTED', agentId: 'bad', reason: 'r' });
        ledger.append({ ts: 4, type: 'COLLAB_HELPED', agentId: 'bad', success: false, latencyMs: 90000, reason: 'r' });
        const ranked = rankByReputation(ledger, ['bad', 'new', 'good']);
        expect(ranked[0].agentId).toBe('good');
        expect(ranked[2].agentId).toBe('bad');
        // 'new' sits at the prior: above proven-bad, below proven-good
        expect(ranked[1].agentId).toBe('new');
    });
});

describe('help bus records real collaboration facts', () => {
    it('records COLLAB_REQUESTED, COLLAB_HELPED (with latency) and COLLAB_SERVED for a real request', async () => {
        const facts: any[] = [];
        const requesterId = crypto.randomUUID();
        const helperId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({
            findHelper: role => role === 'Librarian' ? helperId : null,
            prepare: async request => request.context,
            recordFact: f => facts.push(f)
        }));
        const sent = requestCollaboration({ target_role: 'Librarian', message: 'Read the project license', context: 'LICENSE' },
            { requesterId, requesterRole: 'Developer' });
        const requests = await mailbox(helperId);
        const solution = await readFile('LICENSE', 'utf8');
        emitHelpResponse(requests[0].payload, helperId, solution, true);
        await mailbox(requesterId);
        const requested = facts.find(f => f.type === 'COLLAB_REQUESTED');
        expect(requested).toMatchObject({ agentId: helperId, counterpartId: requesterId, context: 'Librarian', requestId: sent.id });
        const helped = facts.find(f => f.type === 'COLLAB_HELPED');
        expect(helped).toMatchObject({ agentId: helperId, success: true, requestId: sent.id });
        expect(typeof helped.latencyMs).toBe('number');
        const served = facts.find(f => f.type === 'COLLAB_SERVED');
        expect(served).toMatchObject({ agentId: requesterId, counterpartId: helperId, success: true });
    });
    it('records COLLAB_UNROUTABLE when no specialist exists', async () => {
        const facts: any[] = [];
        const requesterId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: () => null, prepare: async () => undefined, recordFact: f => facts.push(f) }));
        const sent = requestCollaboration({ target_role: 'absent', message: 'help' }, { requesterId });
        await mailbox(requesterId);
        expect(facts.find(f => f.type === 'COLLAB_UNROUTABLE')).toMatchObject({ agentId: requesterId, context: 'absent', success: false, requestId: sent.id });
    });
    it('a recording failure is logged and never breaks help delivery', async () => {
        const requesterId = crypto.randomUUID();
        const helperId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({
            findHelper: () => helperId, prepare: async r => r.context,
            recordFact: () => { throw new Error('disk full'); }
        }));
        requestCollaboration({ target_role: 'Librarian', message: 'help' }, { requesterId });
        const requests = await mailbox(helperId);
        expect(requests).toHaveLength(1);
    });
});

describe('orchestrator wiring (structural)', () => {
    it('replaces the hardcoded role map with the org roster and records facts on the live bus', async () => {
        const source = await readFile(path.resolve(__dirname, '../../services/orchestrator.ts'), 'utf8');
        expect(source).not.toContain('roleMap');
        expect(source).toContain("recordFact: fact => this.reputationLedger.append(fact)");
        expect(source).toContain('loadOrganization(defaultOrganizationPath(), INITIAL_AGENTS)');
        expect(source).toContain('rankByReputation(this.reputationLedger, candidates, role)');
    });
});
