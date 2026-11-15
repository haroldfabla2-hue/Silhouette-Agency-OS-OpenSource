/**
 * Task facts feed reputation: normal task outcomes (not just collaborations)
 * become auditable evidence that changes future routing. Formula v2.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { ReputationLedger } from '../../services/org/reputationLedger';
import { computeReputation, REPUTATION_FORMULA_VERSION, REPUTATION_PRIOR } from '../../services/org/reputation';
import { loadOrganization } from '../../services/org/organization';
import { resolveTeamRoute } from '../../services/org/teamRouting';
import type { AgentLike } from '../../services/org/types';

const tmpDirs: string[] = [];
afterEach(() => { tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });
function ledger(): ReputationLedger {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-rep-'));
    tmpDirs.push(dir);
    return new ReputationLedger(path.join(dir, 'rep.jsonl'));
}

const AGENTS: AgentLike[] = [
    { id: 'dev-head', name: 'Dev_Head', role: 'Engineering Lead', teamId: 'TEAM_DEV', roleType: 'LEADER' },
    { id: 'dev-1', name: 'Coder_One', role: 'Coder', teamId: 'TEAM_DEV', roleType: 'WORKER' },
    { id: 'dev-2', name: 'Coder_Two', role: 'Coder', teamId: 'TEAM_DEV', roleType: 'WORKER' }
];

describe('task facts in the reputation ledger (formula v2)', () => {
    it('is versioned reputation-v2 and counts task outcomes in demonstrated success', () => {
        expect(REPUTATION_FORMULA_VERSION).toBe('reputation-v2');
        const l = ledger();
        for (let i = 0; i < 4; i++) l.append({ ts: i, type: 'TASK_COMPLETED', agentId: 'dev-1', success: true, latencyMs: 1200, reason: 'done' });
        const report = computeReputation(l, 'dev-1');
        expect(report.score).toBeGreaterThan(REPUTATION_PRIOR);
        expect(report.evidenceCount).toBe(4);
    });
    it('failed tasks push the score below the prior', () => {
        const l = ledger();
        for (let i = 0; i < 4; i++) l.append({ ts: i, type: 'TASK_FAILED', agentId: 'dev-2', success: false, reason: 'crash' });
        expect(computeReputation(l, 'dev-2').score).toBeLessThan(REPUTATION_PRIOR);
    });
    it('task and collaboration evidence accumulate in one deterministic score', () => {
        const l = ledger();
        l.append({ ts: 1, type: 'COLLAB_REQUESTED', agentId: 'dev-1', reason: 'r' });
        l.append({ ts: 2, type: 'COLLAB_HELPED', agentId: 'dev-1', success: true, latencyMs: 50, reason: 'r' });
        l.append({ ts: 3, type: 'TASK_COMPLETED', agentId: 'dev-1', success: true, reason: 'r' });
        const r1 = computeReputation(l, 'dev-1');
        const l2 = ledger();
        l2.append({ ts: 1, type: 'COLLAB_REQUESTED', agentId: 'dev-1', reason: 'r' });
        l2.append({ ts: 2, type: 'COLLAB_HELPED', agentId: 'dev-1', success: true, latencyMs: 50, reason: 'r' });
        l2.append({ ts: 3, type: 'TASK_COMPLETED', agentId: 'dev-1', success: true, reason: 'r' });
        expect(computeReputation(l2, 'dev-1').score).toBe(r1.score);
    });
});

describe('E2E: normal task outcomes reroute future work', () => {
    it('a failing executor loses future work to a delivering teammate', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-e2e-'));
        tmpDirs.push(dir);
        const chart = loadOrganization(path.join(dir, 'absent.json'), AGENTS);
        const l = new ReputationLedger(path.join(dir, 'rep.jsonl'));
        // dev-1 fails two normal tasks; dev-2 completes two.
        l.append({ ts: 1, type: 'TASK_FAILED', agentId: 'dev-1', context: 'TEAM_DEV', success: false, reason: 'crash: OOM' });
        l.append({ ts: 2, type: 'TASK_FAILED', agentId: 'dev-1', context: 'TEAM_DEV', success: false, reason: 'crash: timeout' });
        l.append({ ts: 3, type: 'TASK_COMPLETED', agentId: 'dev-2', context: 'TEAM_DEV', success: true, latencyMs: 800, reason: 'done' });
        l.append({ ts: 4, type: 'TASK_COMPLETED', agentId: 'dev-2', context: 'TEAM_DEV', success: true, latencyMs: 900, reason: 'done' });

        // Before evidence, suggestion stands; after evidence, routing follows it.
        const decision = resolveTeamRoute(chart, l, 'dev-head');
        expect(decision.reason).toBe('reputation-routed');
        expect(decision.agentId).toBe('dev-2');
        // And the ledger on disk is the auditable trail of WHY.
        const facts = l.readAll().filter(f => f.agentId === 'dev-1');
        expect(facts.every(f => f.type === 'TASK_FAILED')).toBe(true);
    });
});

describe('wiring (structural)', () => {
    it('agentStream emits honest success/startedAt/helpDriven; orchestrator records task facts without double counting', async () => {
        const stream = await readFile(path.resolve(__dirname, '../../services/agentStream.ts'), 'utf8');
        expect(stream).toContain('const startedAt = Date.now();');
        expect(stream).toContain('success: !failed');
        expect(stream).toContain('helpDriven');
        // crash path emits an explicit failed completion
        expect(stream).toContain('success: false');
        const orch = await readFile(path.resolve(__dirname, '../../services/orchestrator.ts'), 'utf8');
        expect(orch).toContain('private recordTaskFact(payload: any): void');
        expect(orch).toContain('if (!payload?.agentId || payload.helpDriven || payload.queued) return;');
        expect(orch).toContain("type: success ? 'TASK_COMPLETED' : 'TASK_FAILED'");
    });
});
