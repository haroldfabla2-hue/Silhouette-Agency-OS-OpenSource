/**
 * [LEDGER-INTEGRITY] Task ledger evidence + stale reaper:
 *  - markTaskDone persists the step output (truncated) so completions are
 *    auditable as DATA, and flags evidence-free completions loudly while
 *    keeping valid text-only outputs 'completed'.
 *  - reapStaleTasks fails open rows older than the cutoff with an honest
 *    reason, and leaves newer or closed rows untouched. Never deletes.
 * Regression roots: prod 2026-10-16 hollow completion (artifacts:[], output
 * never recorded) and 8 eternal-"running" rows across 2026-10-16..22.
 */
import { describe, it, expect } from 'vitest';
import { sqliteService } from '../../services/sqliteService';
import { markTaskDone, reapStaleTasks, taskIdFor } from '../../services/execution/taskLedger';

const PLAN = 'plan_testledger';

function step(order: number) {
    return {
        order,
        agentId: 'agent-x',
        agentRole: 'Tester',
        taskDescription: `step ${order}`,
        dependsOn: [] as number[],
        requiredCapabilities: [] as any[],
        priority: 'NORMAL'
    } as any;
}

function row(id: string) {
    const r: any = sqliteService.getTasksByPlan(PLAN).find((t: any) => t.id === id);
    return r ? { ...r, data: JSON.parse(r.data ?? '{}') } : null;
}

describe('task ledger integrity', () => {
    it('markTaskDone persists output (truncated at 4000) and outputChars', () => {
        const long = 'x'.repeat(5000);
        markTaskDone(PLAN, step(1), { stepOrder: 1, success: true, output: long, artifacts: [], tokensUsed: 3, executionTimeMs: 10 });
        const r = row(taskIdFor(PLAN, 1))!;
        expect(r.status).toBe('completed');
        expect(r.data.output.length).toBe(4000);
        expect(r.data.outputChars).toBe(5000);
        expect(r.data.evidence).toBeUndefined();
    });

    it('text-only completion keeps completed status with its output as evidence', () => {
        markTaskDone(PLAN, step(2), { stepOrder: 2, success: true, output: 'done: wrote the report in chat', artifacts: [], tokensUsed: 1, executionTimeMs: 5 });
        const r = row(taskIdFor(PLAN, 2))!;
        expect(r.status).toBe('completed');
        expect(r.data.output).toContain('report');
        expect(r.data.evidence).toBeUndefined();
    });

    it('evidence-free completion is flagged, never silent', () => {
        markTaskDone(PLAN, step(3), { stepOrder: 3, success: true, output: '', artifacts: [], tokensUsed: 0, executionTimeMs: 1 });
        const r = row(taskIdFor(PLAN, 3))!;
        expect(r.status).toBe('completed');
        expect(r.data.evidence).toBe('none');
    });

    it('failures keep their error and are not flagged', () => {
        markTaskDone(PLAN, step(4), { stepOrder: 4, success: false, output: '', error: 'boom', tokensUsed: 0, executionTimeMs: 1 });
        const r = row(taskIdFor(PLAN, 4))!;
        expect(r.status).toBe('failed');
        expect(r.data.error).toBe('boom');
        expect(r.data.evidence).toBeUndefined();
    });

    it('reapStaleTasks fails only open rows older than the cutoff', () => {
        const now = Date.now();
        sqliteService.upsertTask({ id: taskIdFor(PLAN, 5), description: 'old open', assigned_to: 'a', status: 'running', data: { planId: PLAN, stepOrder: 5 } });
        sqliteService.upsertTask({ id: taskIdFor(PLAN, 6), description: 'fresh open', assigned_to: 'a', status: 'running', data: { planId: PLAN, stepOrder: 6 } });
        markTaskDone(PLAN, step(7), { stepOrder: 7, success: true, output: 'ok', tokensUsed: 0, executionTimeMs: 1 });
        // age row 5 artificially so it predates the cutoff
        (sqliteService as any).db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now - 60000, taskIdFor(PLAN, 5));
        const reaped = reapStaleTasks(now - 1000, 'test cutoff');
        expect(reaped).toBe(1);
        const old = row(taskIdFor(PLAN, 5))!;
        expect(old.status).toBe('failed');
        expect(old.data.error).toContain('reaped: test cutoff');
        expect(row(taskIdFor(PLAN, 6))!.status).toBe('running');
        expect(row(taskIdFor(PLAN, 7))!.status).toBe('completed');
    });
});
