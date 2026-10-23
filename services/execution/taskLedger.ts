/**
 * [PR-1] Task ledger: work as DATA, not narrative (pattern: CrewAI Task).
 *
 * The tasks table existed since the early schema but nothing ever wrote to
 * it ("write-never", diagnosis D4): the only record of work was prose in
 * logs. This module is the single write path. planExecutor records every
 * PlanStep as a row (pending -> running -> completed/failed, with verified
 * artifacts), so missions and chat plans are observable by query, not by
 * reading logs.
 *
 * Recording is best-effort: a ledger failure must never break execution.
 */
import { sqliteService } from '../sqliteService';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ExecutionPlan, PlanStep } from '../planGenerator';

export interface StepOutcomeLike {
    stepOrder: number;
    success: boolean;
    output?: string;
    error?: string;
    artifacts?: string[];
    tokensUsed?: number;
    executionTimeMs?: number;
}

export function taskIdFor(planId: string, order: number): string {
    return `task_${planId}_${order}`;
}

/** One row per step at plan start, all pending. */
export function recordPlanTasks(plan: ExecutionPlan): void {
    for (const step of plan.steps) {
        try {
            sqliteService.upsertTask({
                id: taskIdFor(plan.id, step.order),
                description: step.taskDescription,
                assigned_to: step.agentId,
                status: 'pending',
                data: {
                    planId: plan.id,
                    stepOrder: step.order,
                    agentRole: step.agentRole,
                    dependsOn: step.dependsOn,
                    priority: step.priority,
                    requiredCapabilities: step.requiredCapabilities,
                    originalRequest: plan.originalRequest?.substring(0, 500)
                }
            });
        } catch (e: any) {
            console.warn(`[TASK_LEDGER] record failed for step ${step.order} (non-blocking): ${e?.message}`);
        }
    }
}

export function markTaskRunning(planId: string, step: PlanStep): void {
    try {
        sqliteService.upsertTask({
            id: taskIdFor(planId, step.order),
            description: step.taskDescription,
            assigned_to: step.agentId,
            status: 'running',
            data: { planId, stepOrder: step.order, agentRole: step.agentRole, startedAt: Date.now() }
        });
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] mark running failed (non-blocking): ${e?.message}`);
    }
}

/** Outputs are NEVER omitted by size. Small outputs persist inline in the
 *  ledger row; large ones spill to a durable file (tmp+fsync+rename) and
 *  the row carries a clearly marked preview plus a recoverable reference
 *  (path/bytes/sha256). The per-call LLM token cap does NOT bound
 *  aggregates or file content, so no maximum is assumed: if the durable
 *  spill itself fails, the full output stays inline rather than lose a
 *  single character. */
const OUTPUT_INLINE_LIMIT_CHARS = 256_000;
const OUTPUT_PREVIEW_CHARS = 4_000;

function taskOutputDir(): string {
    return process.env.SILHOUETTE_TASK_OUTPUT_DIR ?? path.resolve(process.cwd(), 'data', 'task-outputs');
}

function persistOutputForLedger(taskId: string, output: string): { output: string; outputChars: number; extra: Record<string, any> } {
    const outputChars = output.length;
    if (outputChars <= OUTPUT_INLINE_LIMIT_CHARS) {
        return { output, outputChars, extra: {} };
    }
    try {
        const dir = taskOutputDir();
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${taskId}.txt`);
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, output, 'utf8');
        const fd = fs.openSync(tmp, 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
        const sha256 = crypto.createHash('sha256').update(output, 'utf8').digest('hex');
        return {
            output: output.substring(0, OUTPUT_PREVIEW_CHARS) + `\n[PREVIEW ONLY - full output (${outputChars} chars) persisted at ${file} ; sha256:${sha256}]`,
            outputChars,
            extra: { outputPreview: true, outputRef: { path: file, bytes: Buffer.byteLength(output, 'utf8'), sha256 } }
        };
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] output spill failed for ${taskId}; keeping FULL output inline (${outputChars} chars): ${e?.message}`);
        return { output, outputChars, extra: { outputSpillFailed: true } };
    }
}

export function markTaskDone(planId: string, step: PlanStep, result: StepOutcomeLike): void {
    try {
        const output = result.output ?? '';
        const artifacts = result.artifacts ?? [];
        // [LEDGER-INTEGRITY] A completion with no persisted evidence (no
        // output text, no artifacts) is un-auditable - the historical
        // "hollow completion" (prod 2026-10-16: a cotizador step marked
        // completed with artifacts:[] and its output never recorded).
        // Valid no-artifact TEXT outputs stay 'completed' with their output
        // persisted; only evidence-free completions get flagged, loudly.
        const noEvidence = result.success === true && output.length === 0 && artifacts.length === 0 && !result.error;
        if (noEvidence) {
            console.warn(`[TASK_LEDGER] WARNING: step ${step.order} of ${planId} completed with NO persisted evidence (no output, no artifacts)`);
        }
        const persisted = persistOutputForLedger(taskIdFor(planId, step.order), output);
        sqliteService.upsertTask({
            id: taskIdFor(planId, step.order),
            description: step.taskDescription,
            assigned_to: step.agentId,
            status: result.success ? 'completed' : 'failed',
            data: {
                planId,
                stepOrder: step.order,
                agentRole: step.agentRole,
                finishedAt: Date.now(),
                error: result.error,
                output: persisted.output,
                outputChars: persisted.outputChars,
                ...persisted.extra,
                artifacts,
                tokensUsed: result.tokensUsed ?? 0,
                executionTimeMs: result.executionTimeMs ?? 0,
                ...(noEvidence ? { evidence: 'none' } : {})
            }
        });
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] mark done failed (non-blocking): ${e?.message}`);
    }
}

/**
 * [LEDGER-INTEGRITY] Reap ledger rows whose executor is gone. Rows still
 * pending/running with updated_at older than `beforeMs` belong to a
 * dead executor (process restart) or an abandoned step (LLM chain hung
 * before the abort path could close them; prod 2026-10-16..22 left 8 rows
 * eternal-running). They are marked failed with an honest reason -
 * never deleted, never silently completed; the mission can be re-run.
 * Returns the number of reaped rows.
 */
export function reapStaleTasks(beforeMs: number, reason: string, statuses: Array<'pending' | 'running'> = ['pending', 'running']): number {
    let reaped = 0;
    try {
        const rows = sqliteService.getOpenTasksBefore(beforeMs, statuses);
        for (const row of rows) {
            try {
                let data: any = {};
                try { data = row?.data ? JSON.parse(row.data) : {}; } catch { data = {}; }
                sqliteService.upsertTask({
                    id: row.id,
                    description: row.description,
                    assigned_to: row.assigned_to,
                    status: 'failed',
                    data: { ...data, finishedAt: Date.now(), error: `reaped: ${reason}`.substring(0, 500) }
                });
                reaped++;
            } catch (e: any) {
                console.warn(`[TASK_LEDGER] reap failed for ${row?.id} (non-blocking): ${e?.message}`);
            }
        }
        if (reaped > 0) console.log(`[TASK_LEDGER] Reaped ${reaped} stale ledger rows (${reason})`);
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] stale sweep failed (non-blocking): ${e?.message}`);
    }
    return reaped;
}

/**
 * [LEDGER-INTEGRITY] Reconcile a TIMED-OUT step that settled late. The
 * timeout verdict stands (status stays as recorded); the late outcome is
 * appended as evidence so no effect of the abandoned work vanishes: late
 * artifacts/output become visible for audit and for de-duplicating a
 * re-run. A step has no abort handle, so reconciliation - not
 * cancellation - is the honest containment. Step side effects are
 * confined to the audited jailed write roots and the memory pipeline;
 * world-exiting actions (PR, deploy, publish) are gated elsewhere and
 * unreachable from a step.
 */
export function recordLateSettlement(planId: string, stepOrder: number, late: StepOutcomeLike): void {
    try {
        const id = taskIdFor(planId, stepOrder);
        const row = sqliteService.getTasksByPlan(planId).find((t: any) => t.id === id);
        if (!row) return;
        let data: any = {};
        try { data = row.data ? JSON.parse(row.data) : {}; } catch { data = {}; }
        const persisted = persistOutputForLedger(id, late.output ?? '');
        data.lateSettlement = {
            finishedAt: Date.now(),
            success: late.success === true,
            outputChars: persisted.outputChars,
            output: persisted.output,
            ...persisted.extra,
            error: late.error,
            artifacts: late.artifacts ?? []
        };
        sqliteService.upsertTask({ id, description: row.description, assigned_to: row.assigned_to, status: row.status, data });
        console.log(`[TASK_LEDGER] Late settlement reconciled for step ${stepOrder} of ${planId} (success=${late.success === true})`);
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] late settlement record failed (non-blocking): ${e?.message}`);
    }
}

/**
 * [PR-4c] Close ledger rows a plan abort leaves open. Any step that never
 * reached execution (still 'pending') or was left mid-flight ('running') is
 * marked 'failed' with the abort reason - the ledger must never show eternal
 * "running" for work the executor already abandoned (prod 2026-10-16:
 * task_plan_d3c00a3e_2 sat "running" after the LLM chain gave up).
 */
export function closeOpenTasks(planId: string, executedOrders: Set<number>, reason: string): void {
    try {
        const rows = sqliteService.getTasksByPlan(planId);
        for (const row of rows) {
            let data: any = {};
            try { data = row?.data ? JSON.parse(row.data) : {}; } catch { data = {}; }
            const order = typeof data.stepOrder === 'number' ? data.stepOrder : NaN;
            if (executedOrders.has(order)) continue;
            if (row.status !== 'pending' && row.status !== 'running') continue;
            sqliteService.upsertTask({
                id: row.id,
                description: row.description,
                assigned_to: row.assigned_to,
                status: 'failed',
                data: { ...data, finishedAt: Date.now(), error: `aborted: ${reason}`.substring(0, 500) }
            });
        }
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] close open tasks failed (non-blocking): ${e?.message}`);
    }
}
