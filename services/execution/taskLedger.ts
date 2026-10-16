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

export function markTaskDone(planId: string, step: PlanStep, result: StepOutcomeLike): void {
    try {
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
                artifacts: result.artifacts ?? [],
                tokensUsed: result.tokensUsed ?? 0,
                executionTimeMs: result.executionTimeMs ?? 0
            }
        });
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] mark done failed (non-blocking): ${e?.message}`);
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
