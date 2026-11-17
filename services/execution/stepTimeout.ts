import type { PlanStep } from '../planGenerator';
import type { StepResult } from '../planExecutor';
import type { createTaskEvidence } from './taskEvidence';
import { recordLateSettlement } from './taskLedger';

interface AbandonedStep { planId: string; order: number; agentId: string; taskDescription: string; timedOutAt: number; }
const abandonedInFlight = new Map<string, AbandonedStep>();
const abandonedKey = (planId: string, order: number) => `${planId}:${order}`;

export function noteStepTimedOut(planId: string, step: PlanStep): void {
    abandonedInFlight.set(abandonedKey(planId, step.order), {
        planId, order: step.order, agentId: step.agentId,
        taskDescription: step.taskDescription ?? '', timedOutAt: Date.now()
    });
}

export function clearAbandonedStep(planId: string, order: number): void {
    abandonedInFlight.delete(abandonedKey(planId, order));
}

/** Abandoned steps of THIS process still awaiting settlement. */
export function getAbandonedStepsInFlight(): AbandonedStep[] {
    return Array.from(abandonedInFlight.values());
}

export function withStepTimeout(planId: string, step: PlanStep, work: Promise<StepResult>, evidence?: ReturnType<typeof createTaskEvidence>): Promise<StepResult> {
        const timeoutMs = Number(process.env.SILHOUETTE_STEP_TIMEOUT_MS ?? 30 * 60 * 1000);
        let timer: NodeJS.Timeout | undefined;
        let timedOut = false;
        const timeout = new Promise<StepResult>((resolve) => {
            timer = setTimeout(() => {
                timedOut = true;
                noteStepTimedOut(planId, step);
                console.error(`[PLAN_EXECUTOR] Step ${step.order} timed out after ${timeoutMs}ms - failing honestly`);
                resolve({
                    stepOrder: step.order,
                    agentId: step.agentId,
                    output: '',
                    success: false,
                    tokensUsed: 0,
                    executionTimeMs: timeoutMs,
                    error: `step timeout after ${timeoutMs}ms`,
                    abandonedInFlight: Date.now()
                } as StepResult);
            }, timeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
        });
        // [LEDGER-INTEGRITY] Containment is reconciliation, not cancellation:
        // the step chain holds no abort handle, so when the abandoned work
        // eventually settles, its outcome is RECORDED on the ledger row
        // (lateSettlement) - late artifacts/writes stay visible for audit
        // and for de-duplicating a re-run. Step side effects are confined
        // to the audited jailed write roots and the memory pipeline;
        // world-exiting actions are unreachable from a step.
        work.then(late => {
            if (!timedOut) return;
            clearAbandonedStep(planId, step.order);
            console.warn(`[PLAN_EXECUTOR] Timed-out step ${step.order} of ${planId} settled late (success=${late?.success}) - reconciling ledger row`);
            recordLateSettlement(planId, step.order, { ...late, executionEvidence: evidence?.snapshot() });
        }).catch((e: any) => {
            if (!timedOut) return;
            clearAbandonedStep(planId, step.order);
            console.warn(`[PLAN_EXECUTOR] Timed-out step ${step.order} of ${planId} rejected late: ${e?.message}`);
            recordLateSettlement(planId, step.order, { stepOrder: step.order, success: false, error: `late rejection: ${e?.message}`, executionEvidence: evidence?.snapshot() });
        });
        return Promise.race([work, timeout]).finally(() => { if (timer) clearTimeout(timer); });
    }
