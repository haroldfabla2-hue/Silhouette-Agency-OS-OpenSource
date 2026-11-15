import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// P1: the LLM planner and the outcome ledger are the trust foundation for
// any future autonomy. Pinned contracts:
// 1. Planner output parsing tolerates fences/prose but never accepts a
//    payload without an ops array.
// 2. One repair retry happens on invalid planner output; the cycle stays
//    honestly PLANNED if the planner keeps failing.
// 3. Outcome truth comes from GitHub (merged/closed), mapped into the
//    persisted cycle; metrics aggregate real stored cycles only.

vi.mock('../../services/llmGateway', () => ({
    llmGateway: { complete: vi.fn() }
}));

import { llmGateway } from '../../services/llmGateway';
import { SelfDevCycleService } from '../../services/selfdev/cycleService';

const complete = llmGateway.complete as ReturnType<typeof vi.fn>;

let dir: string;
let svc: InstanceType<typeof SelfDevCycleService>;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfdev-p1-'));
    svc = new SelfDevCycleService({ dir });
    complete.mockReset();
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function makeCycle() {
    return svc.create({
        issue: 'document the P1 planner contract',
        scope: ['docs/'],
        acceptance: { kind: 'vitest', target: 'tests/automated/fase1-selfdev-metrics.test.ts' }
    });
}

const VALID_PLAN = JSON.stringify({ ops: [{ op: 'write', path: 'docs/p1.md', content: '# P1', rationale: 'document the contract' }] });

describe('parsePlanJson', () => {
    it('parses strict JSON', () => {
        const ops = SelfDevCycleService.parsePlanJson(VALID_PLAN);
        expect(ops[0].path).toBe('docs/p1.md');
    });
    it('tolerates code fences and surrounding prose', () => {
        const ops = SelfDevCycleService.parsePlanJson('Sure! Here is the plan:\n```json\n' + VALID_PLAN + '\n```\nHope that helps.');
        expect(ops[0].op).toBe('write');
    });
    it('rejects output without an ops array', () => {
        expect(() => SelfDevCycleService.parsePlanJson('{"hello":"world"}')).toThrow(/ops array/);
        expect(() => SelfDevCycleService.parsePlanJson('no json at all')).toThrow(/no JSON object/);
    });
});

describe('LLM planner', () => {
    it('retries once with a repair prompt after invalid output, then succeeds', async () => {
        complete
            .mockResolvedValueOnce({ text: 'I cannot help with that.' })
            .mockResolvedValueOnce({ text: '```json\n' + VALID_PLAN + '\n```' });
        const c = makeCycle();
        const after = await svc.attempt(c.id);
        expect(complete).toHaveBeenCalledTimes(2);
        expect(after.state).toBe('ATTEMPTED');
        expect(after.patch?.source).toBe('llm');
    });

    it('stays PLANNED with an honest error when the planner keeps failing', async () => {
        complete.mockResolvedValue({ text: 'no json here' });
        const c = makeCycle();
        const after = await svc.attempt(c.id);
        expect(after.state).toBe('PLANNED');
        expect(after.lastError).toMatch(/planner unavailable or invalid plan/);
    });
});

describe('syncOutcome + metrics', () => {
    const realFetch = global.fetch;
    const envBackup = { ...process.env };

    beforeEach(() => {
        process.env.GITHUB_REPO_OWNER = 'o';
        process.env.GITHUB_REPO_NAME = 'r';
        process.env.GITHUB_TOKEN = 't';
    });

    afterEach(() => {
        global.fetch = realFetch;
        process.env.GITHUB_TOKEN = envBackup.GITHUB_TOKEN;
        process.env.GITHUB_REPO_OWNER = envBackup.GITHUB_REPO_OWNER;
        process.env.GITHUB_REPO_NAME = envBackup.GITHUB_REPO_NAME;
    });

    function openPrCycle(): string {
        const c = makeCycle();
        const store: any = (svc as any).store;
        const row = store.cycles.find((x: any) => x.id === c.id);
        row.state = 'PR_OPEN';
        row.patch = { source: 'llm', ops: [{ op: 'write', path: 'docs/p1.md', content: '# P1', rationale: 'x' }] };
        row.pr = { approvedBy: 'alberto', requestedAt: new Date(Date.parse(c.createdAt) + 60000).toISOString(), number: 42, url: 'https://example.invalid/pr/42' };
        (svc as any).save();
        return c.id;
    }

    it('maps a merged PR into the persisted outcome and metrics', async () => {
        const id = openPrCycle();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ merged_at: '2026-10-14T17:00:00Z', state: 'closed' }) }) as any;
        const c = await svc.syncOutcome(id);
        expect(c.outcome?.state).toBe('merged');
        const m = svc.metrics();
        expect(m.prs.merged).toBe(1);
        expect(m.prs.mergeRate).toBe(1);
        expect(m.bySource.llm).toBe(1);
        expect(m.medianMsPlanToPR).toBe(60000);
    });

    it('maps a closed-unmerged PR honestly', async () => {
        const id = openPrCycle();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ merged_at: null, closed_at: '2026-10-14T18:00:00Z', state: 'closed' }) }) as any;
        const c = await svc.syncOutcome(id);
        expect(c.outcome?.state).toBe('closed-unmerged');
        expect(svc.metrics().prs.mergeRate).toBe(0);
    });

    it('fails loudly when GitHub is unreachable instead of guessing', async () => {
        const id = openPrCycle();
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
        await expect(svc.syncOutcome(id)).rejects.toThrow(/503/);
    });
});
