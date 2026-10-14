/**
 * E2E: a request flows through the organization hierarchy.
 *
 * user message -> suggested agent -> TEAM resolution -> best-evidence
 * EXECUTOR -> executor escalates to '@team-head' over the real bus ->
 * head answers -> response reaches the executor's mailbox -> every step
 * lands as auditable facts in a real append-only reputation ledger ->
 * the ledger now differentiates the team and reroutes by evidence.
 *
 * No mocks: real org chart, real in-process bus, real ledger on disk.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadOrganization, teamOfAgent } from '../../services/org/organization';
import { ReputationLedger } from '../../services/org/reputationLedger';
import { resolveTeamRoute } from '../../services/org/teamRouting';
import { computeReputation } from '../../services/org/reputation';
import { emitHelpResponse, requestCollaboration, subscribeHelpProtocol } from '../../services/communication/helpProtocol';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';
import type { AgentLike } from '../../services/org/types';

const tmpDirs: string[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
    cleanups.splice(0).forEach(off => off());
    tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});
async function mailbox(id: string) {
    await new Promise(resolve => setImmediate(resolve));
    return systemBus.checkMailbox(id);
}

const AGENTS: AgentLike[] = [
    { id: 'res-head', name: 'Research_Head', role: 'Research Lead', teamId: 'TEAM_SCIENCE', roleType: 'LEADER' },
    { id: 'res-exec-1', name: 'Researcher_Pro', role: 'Researcher', teamId: 'TEAM_SCIENCE', roleType: 'WORKER' },
    { id: 'res-exec-2', name: 'Research_Synthesizer', role: 'Synthesizer', teamId: 'TEAM_SCIENCE', roleType: 'WORKER' }
];

describe('E2E hierarchy flow', () => {
    it('user request -> team -> executor -> escalation to head -> response -> auditable evidence', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-org-'));
        tmpDirs.push(dir);
        const chart = loadOrganization(path.join(dir, 'absent.json'), AGENTS);
        const ledger = new ReputationLedger(path.join(dir, 'reputation-ledger.jsonl'));

        // 1) User message arrives; the orchestrator's analysis suggests the head.
        //    Team routing keeps the suggestion while evidence is absent.
        const first = resolveTeamRoute(chart, ledger, 'res-head');
        expect(first.reason).toBe('no-evidence-keep-suggested');
        expect(first.agentId).toBe('res-head');

        // 2) Wire the bus exactly as the orchestrator does (roster + @team-head + ledger).
        cleanups.push(subscribeHelpProtocol({
            findHelper: (role, request) => {
                if (role === '@team-head' && request) {
                    const team = teamOfAgent(chart, request.requesterId);
                    return team ? team.headAgentId : null;
                }
                const found = AGENTS.find(a => a.role === role || a.name === role);
                return found ? found.id : null;
            },
            prepare: async request => request.context,
            recordFact: fact => ledger.append(fact)
        }));

        // 3) The executor doing the work hits a hard problem and escalates to its head.
        const escalation = requestCollaboration(
            { target_role: '@team-head', message: 'Source contradicts the meta-truth; need a decision', context: { taskId: 't-1' } },
            { requesterId: 'res-exec-1', requesterRole: 'Researcher' });
        expect(escalation.status).toBe('queued');

        // 4) The HEAD (not another executor) receives the escalation.
        const headRequests = await mailbox('res-head');
        expect(headRequests).toHaveLength(1);
        expect(headRequests[0].protocol).toBe(SystemProtocol.HELP_REQUEST);
        expect(headRequests[0].payload).toMatchObject({ requesterId: 'res-exec-1', targetRole: '@team-head', requestId: escalation.id });
        expect(await mailbox('res-exec-2')).toHaveLength(0);

        // 5) The head decides and answers; the response reaches the EXECUTOR.
        emitHelpResponse(headRequests[0].payload, 'res-head', 'Keep the newer source; mark the old one superseded_by.', true);
        const executorResponses = await mailbox('res-exec-1');
        expect(executorResponses).toHaveLength(1);
        expect(executorResponses[0].payload).toMatchObject({ helperId: 'res-head', success: true, requestId: escalation.id });

        // 6) Every step is auditable in the ledger on disk.
        const facts = ledger.readAll();
        expect(facts.find(f => f.type === 'COLLAB_REQUESTED')).toMatchObject({ agentId: 'res-head', counterpartId: 'res-exec-1', context: '@team-head' });
        expect(facts.find(f => f.type === 'COLLAB_HELPED')).toMatchObject({ agentId: 'res-head', success: true });
        expect(facts.find(f => f.type === 'COLLAB_SERVED')).toMatchObject({ agentId: 'res-exec-1', counterpartId: 'res-head', success: true });

        // 7) Evidence now differentiates the team: a successful head scores above the prior.
        const headRep = computeReputation(ledger, 'res-head');
        expect(headRep.score).toBeGreaterThan(0.5);
        expect(headRep.evidenceCount).toBeGreaterThan(0);
    });

    it('evidence-based rerouting: after a failing executor and a proven one, work follows the evidence', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-org-'));
        tmpDirs.push(dir);
        const chart = loadOrganization(path.join(dir, 'absent.json'), AGENTS);
        const ledger = new ReputationLedger(path.join(dir, 'reputation-ledger.jsonl'));
        // res-exec-1 asked twice, failed twice; res-exec-2 asked twice, delivered twice.
        const record = (agentId: string, ok: boolean, i: number) => {
            ledger.append({ ts: i * 2, type: 'COLLAB_REQUESTED', agentId, context: 'TEAM_SCIENCE', reason: 'routed' });
            ledger.append({ ts: i * 2 + 1, type: 'COLLAB_HELPED', agentId, context: 'TEAM_SCIENCE', success: ok, latencyMs: 100, reason: ok ? 'delivered' : 'failed' });
        };
        record('res-exec-1', false, 1); record('res-exec-1', false, 2);
        record('res-exec-2', true, 3); record('res-exec-2', true, 4);

        const decision = resolveTeamRoute(chart, ledger, 'res-head');
        expect(decision.reason).toBe('reputation-routed');
        expect(decision.agentId).toBe('res-exec-2');
        expect(decision.headAgentId).toBe('res-head');
    });

    it('orchestrator wires team routing and @team-head escalation (structural)', async () => {
        const { readFile } = await import('node:fs/promises');
        const source = await readFile(path.resolve(__dirname, '../../services/orchestrator.ts'), 'utf8');
        expect(source).toContain('resolveTeamRoute(this.orgChart, this.reputationLedger, agentId)');
        expect(source).toContain("role === '@team-head'");
        expect(source).toContain('teamOfAgent(this.orgChart, request.requesterId)');
    });
});
