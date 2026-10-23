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
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { sqliteService } from '../../services/sqliteService';
import { markTaskDone, reapStaleTasks, recordLateSettlement, taskIdFor } from '../../services/execution/taskLedger';
import { noteStepTimedOut, clearAbandonedStep, getAbandonedStepsInFlight } from '../../services/planExecutor';

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
    it('markTaskDone persists the COMPLETE output (no lossy preview) and outputChars', () => {
        const long = 'x'.repeat(5000);
        markTaskDone(PLAN, step(1), { stepOrder: 1, success: true, output: long, artifacts: [], tokensUsed: 3, executionTimeMs: 10 });
        const r = row(taskIdFor(PLAN, 1))!;
        expect(r.status).toBe('completed');
        expect(r.data.output).toBe(long);
        expect(r.data.outputChars).toBe(5000);
        expect(r.data.outputTruncated).toBeUndefined();
        expect(r.data.evidence).toBeUndefined();
    });

    it('large outputs spill COMPLETE to durable storage with a recoverable ref (never omitted by size)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-outputs-'));
        process.env.SILHOUETTE_TASK_OUTPUT_DIR = dir;
        try {
            const huge = 'y'.repeat(300_000); // > 256k inline limit
            markTaskDone(PLAN, step(8), { stepOrder: 8, success: true, output: huge, artifacts: [], tokensUsed: 1, executionTimeMs: 1 });
            const r = row(taskIdFor(PLAN, 8))!;
            expect(r.data.outputPreview).toBe(true);
            expect(r.data.outputChars).toBe(300_000);
            expect(r.data.output).toContain('PREVIEW ONLY');
            const ref = r.data.outputRef;
            expect(ref.bytes).toBe(Buffer.byteLength(huge, 'utf8'));
            expect(ref.sha256).toBe(crypto.createHash('sha256').update(huge, 'utf8').digest('hex'));
            const onDisk = fs.readFileSync(ref.path, 'utf8');
            expect(onDisk).toBe(huge); // full original recoverable, byte for byte
        } finally {
            delete process.env.SILHOUETTE_TASK_OUTPUT_DIR;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('retry gate: NO time-based unblock; only settlement clears (confirmed termination)', () => {
        const p = 'plan_gate_test';
        noteStepTimedOut(p, step(1) as any);
        // still blocked arbitrarily later - elapsed time proves nothing about a live promise
        expect(getAbandonedStepsInFlight().map(s => s.planId)).toContain(p);
        // settlement clears the entry and unblocks a retry
        clearAbandonedStep(p, 1);
        expect(getAbandonedStepsInFlight().map(s => s.planId)).not.toContain(p);
    });

    it('abandonment is durable on the row; late settlement clears flag and sets reconciledAt', () => {
        markTaskDone(PLAN, step(12), { stepOrder: 12, success: false, output: '', error: 'step timeout after 1800000ms', tokensUsed: 0, executionTimeMs: 1800000, abandonedInFlight: 1792780000000 });
        const before = row(taskIdFor(PLAN, 12))!;
        expect(before.status).toBe('failed');
        expect(before.data.abandonedInFlight.timedOutAt).toBe(1792780000000); // survives restarts (SQLite)
        recordLateSettlement(PLAN, 12, { stepOrder: 12, success: true, output: 'late', tokensUsed: 1, executionTimeMs: 2000000 });
        const after = row(taskIdFor(PLAN, 12))!;
        expect(after.data.abandonedInFlight).toBeUndefined(); // uncertainty resolved
        expect(after.data.reconciledAt).toBeTypeOf('number');
        expect(after.data.lateSettlement.output).toBe('late');
        expect(after.status).toBe('failed'); // timeout verdict preserved
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

    it('running-only sweep (Janitor mode) never touches a pending wait', () => {
        const now = Date.now();
        sqliteService.upsertTask({ id: taskIdFor(PLAN, 9), description: 'old pending wait', assigned_to: 'a', status: 'pending', data: { planId: PLAN, stepOrder: 9 } });
        sqliteService.upsertTask({ id: taskIdFor(PLAN, 10), description: 'old running', assigned_to: 'a', status: 'running', data: { planId: PLAN, stepOrder: 10 } });
        (sqliteService as any).db.prepare('UPDATE tasks SET updated_at = ? WHERE id IN (?,?)').run(now - 60000, taskIdFor(PLAN, 9), taskIdFor(PLAN, 10));
        const reaped = reapStaleTasks(now - 1000, 'janitor cutoff', ['running']);
        expect(reaped).toBe(1);
        expect(row(taskIdFor(PLAN, 10))!.status).toBe('failed');
        expect(row(taskIdFor(PLAN, 9))!.status).toBe('pending'); // legitimate wait preserved
    });

    it('recordLateSettlement appends evidence, keeps the timeout verdict', () => {
        markTaskDone(PLAN, step(11), { stepOrder: 11, success: false, output: '', error: 'step timeout after 1800000ms', tokensUsed: 0, executionTimeMs: 1800000 });
        recordLateSettlement(PLAN, 11, { stepOrder: 11, success: true, output: 'late result text', artifacts: ['workspace/late.txt'], tokensUsed: 9, executionTimeMs: 2000000 });
        const r = row(taskIdFor(PLAN, 11))!;
        expect(r.status).toBe('failed'); // verdict stands
        expect(r.data.error).toContain('step timeout');
        expect(r.data.lateSettlement.success).toBe(true);
        expect(r.data.lateSettlement.output).toBe('late result text');
        expect(r.data.lateSettlement.artifacts).toEqual(['workspace/late.txt']);
    });
});
