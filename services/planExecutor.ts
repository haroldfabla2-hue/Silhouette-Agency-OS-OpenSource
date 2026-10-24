/**
 * PLAN EXECUTOR SERVICE
 * 
 * Executes multi-step plans while respecting:
 * - Resource limits (RAM/CPU/VRAM via ResourceArbiter)
 * - RPM limits (via ProviderHealthManager)
 * - System congestion (via CongestionManager)
 * - Agent lifecycle (hydration/dehydration)
 * 
 * This is the "homeostatic" execution engine that maintains
 * system stability while orchestrating agent work.
 */

import { ExecutionPlan, PlanStep } from './planGenerator';
import { promptCompiler } from './promptCompiler';
import { resourceArbiter } from './resourceArbiter';
import { providerHealth } from './providerHealthManager';
import { congestionManager } from './congestionManager';
import { orchestrator } from './orchestrator';
import { geminiService } from './geminiService';
import { systemBus } from './systemBus';
import { SystemProtocol, CommunicationLevel, AgentStatus, AgentRoleType, AgentTier, AgentCapability } from '../types';
import { stepDeclaresFileWork, durableFileGrant } from './tools/toolSelection'; // [W3]
import { evaluatePlanHonesty } from './execution/stepHonesty'; // [W3]
import { collectWrittenArtifacts } from './execution/artifactLedger'; // [W3]
import { recordPlanTasks, markTaskRunning, markTaskPhase, markTaskDone, closeOpenTasks, recordLateSettlement, getUnresolvedAbandonedTaskRows, type TaskAttemptContext, type StepOutcomeLike } from './execution/taskLedger'; // [PR-1] [PR-4c: closeOpenTasks] [LEDGER-INTEGRITY]
import { extractExecuteMarkers, normalizeToolName } from './tools/execMarker'; // [PR-I]

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface StepResult {
    stepOrder: number;
    agentId: string;
    output: string;
    success: boolean;
    tokensUsed: number;
    executionTimeMs: number;
    error?: string;
    /** [W3] Verified files this step wrote through the fs jail. */
    artifacts?: string[];
}

// [LEDGER-INTEGRITY] Timed-out steps whose background promise may still
// be alive. While ANY entry exists, execute() refuses to start a new
// plan: a retry running concurrently with the abandoned work could
// write the same jailed files or duplicate memories. There is NO
// time-based unblock - elapsed time proves nothing about a live promise.
// Exactly two exits, both confirmed terminations:
//   1. The abandoned promise SETTLES: it is reconciled into the ledger
//      (recordLateSettlement, verdict preserved) and the entry clears.
//   2. The PROCESS DIES: an in-process promise cannot outlive its
//      process, so a restart is confirmed termination of the writer.
//      The ledger row keeps a durable abandonedInFlight flag (no
//      lateSettlement) meaning "partial effects may exist" - auditable
//      before any re-run. Explicit verifiable recovery for a never-
//      settling step is therefore: restart the service, inspect the
//      flagged row, re-run.
interface AbandonedStep { attemptId?: string; planId: string; order: number; agentId: string; taskDescription: string; timedOutAt: number; }
const abandonedInFlight = new Map<string, AbandonedStep>();
const abandonedKey = (planId: string, order: number, attemptId?: string) => `${planId}:${order}:${attemptId ?? 'legacy'}`;

export function noteStepTimedOut(planId: string, step: PlanStep, attemptId?: string): void {
    abandonedInFlight.set(abandonedKey(planId, step.order, attemptId), {
        attemptId, planId, order: step.order, agentId: step.agentId,
        taskDescription: step.taskDescription ?? '', timedOutAt: Date.now()
    });
}

export function clearAbandonedStep(planId: string, order: number, attemptId?: string): void {
    abandonedInFlight.delete(abandonedKey(planId, order, attemptId));
}

/** Abandoned steps of THIS process still awaiting settlement. */
export function getAbandonedStepsInFlight(): AbandonedStep[] {
    return Array.from(abandonedInFlight.values());
}

export interface PlanExecutionResult {
    planId: string;
    success: boolean;
    /** [W3] Verified files written through the fs jail during this plan. */
    artifactsProduced?: string[];
    steps: StepResult[];
    finalOutput: string;
    totalTokens: number;
    totalTimeMs: number;
    errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAN EXECUTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class PlanExecutor {
    private readonly MAX_WAIT_TIME_MS = 30000; // 30 seconds max wait for resources
    private readonly CONGESTION_PAUSE_MS = 2000; // 2 second pause when congested

    /**
     * Execute a plan respecting all homeostatic constraints
     */
    public async execute(plan: ExecutionPlan): Promise<PlanExecutionResult> {
        console.log(`[PLAN_EXECUTOR] 🚀 Executing plan: ${plan.id} (${plan.steps.length} steps)`);

        const startTime = Date.now();
        const results: Map<number, StepResult> = new Map();
        const errors: string[] = [];

        // [LEDGER-INTEGRITY] Retry gate, fail-closed on TWO uncertainty
        // classes. (a) LIVE: a timed-out step of THIS process may still be
        // running - blocks until it settles (auto-reconciled). (b) DURABLE:
        // a row flagged abandonedInFlight with no settlement and no
        // explicit reconciliation - the writer may be dead (restart), but
        // dead writers do not roll back partial effects, and an auditable
        // row alone does not make a re-run safe. Blocks until an
        // attributed human/operator reconciliation reviews the effects
        // (POST /v1/orchestrator/tasks/reconcile-abandoned). A restart is
        // therefore NOT presented as safe recovery by itself.
        const blocking = getAbandonedStepsInFlight();
        const durableBlocking = getUnresolvedAbandonedTaskRows();
        if (blocking.length > 0 || durableBlocking.length > 0) {
            const liveDetail = blocking.map(b => `step ${b.order} of ${b.planId} ("${(b.taskDescription || '').substring(0, 80)}", timed out ${new Date(b.timedOutAt).toISOString()}, LIVE - blocks until it settles)`);
            const durableDetail = durableBlocking.map((r: any) => {
                let d: any = {};
                try { d = r?.data ? JSON.parse(r.data) : {}; } catch { d = {}; }
                return `${r.id} ("${(r.description || '').substring(0, 80)}", timed out ${d?.abandonedInFlight?.timedOutAt ? new Date(d.abandonedInFlight.timedOutAt).toISOString() : 'unknown'}, DURABLE - needs explicit reconciliation after reviewing its partial effects)`;
            });
            const detail = [...liveDetail, ...durableDetail].join('; ');
            console.error(`[PLAN_EXECUTOR] Refusing to start plan ${plan.id}: ${blocking.length + durableBlocking.length} unresolved abandoned step(s): ${detail}`);
            return {
                planId: plan.id,
                success: false,
                steps: [],
                finalOutput: `Blocked: ${blocking.length + durableBlocking.length} timed-out step(s) from earlier work are unresolved. Live ones unblock automatically when the abandoned work settles (reconciled into the task ledger). Durable ones (writer gone, partial effects uncertain) require an explicit attributed review of those effects first: POST /v1/orchestrator/tasks/reconcile-abandoned {planId, stepOrder, reconciledBy, note}. A restart alone does not make a re-run safe. Detail: ${detail}`,
                totalTokens: 0,
                totalTimeMs: 0,
                errors: [`unresolved abandoned steps: ${detail}`]
            };
        }

        // Emit plan start
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            planId: plan.id,
            status: 'STARTED',
            totalSteps: plan.steps.length
        }, 'PLAN_EXECUTOR');

        // [PR-1] Work as data: one task row per step (observable by query,
        // not by reading logs). Best-effort; never blocks execution.
        const attemptContexts = recordPlanTasks(plan);

        // Execute steps in order, respecting dependencies
        for (const step of plan.steps) {
            // 1. Check dependencies are complete
            const depsReady = step.dependsOn.every(dep => results.has(dep));
            if (!depsReady) {
                console.warn(`[PLAN_EXECUTOR] ⏳ Step ${step.order} waiting on dependencies: ${step.dependsOn}`);
                // In a real async system, we'd queue this. For now, we assume ordered execution.
            }

            // 2. Execute the step with all homeostatic checks
            try {
                markTaskRunning(plan.id, step, attemptContexts.get(step.order)); // [PR-1]
                const result = await this.withStepTimeout(plan.id, step, this.executeStep(step, plan, results, attemptContexts.get(step.order)), attemptContexts.get(step.order));
                const doneAck = markTaskDone(plan.id, step, result, attemptContexts.get(step.order));
                if (doneAck?.persisted && doneAck.releaseReady && !doneAck.conflict) clearAbandonedStep(plan.id, step.order, attemptContexts.get(step.order)?.attemptId);
                results.set(step.order, result);

                if (!result.success) {
                    errors.push(`Step ${step.order} failed: ${result.error}`);

                    // Decide whether to continue or abort
                    if (step.priority === 'CRITICAL') {
                        console.error(`[PLAN_EXECUTOR] ❌ CRITICAL step failed. Aborting plan.`);
                        break;
                    }
                }
            } catch (e: any) {
                errors.push(`Step ${step.order} exception: ${e.message}`);
                const failure = {
                    stepOrder: step.order,
                    agentId: step.agentId,
                    output: '',
                    success: false,
                    tokensUsed: 0,
                    executionTimeMs: 0,
                    error: e.message
                };
                markTaskDone(plan.id, step, failure, attemptContexts.get(step.order)); // [PR-1]
                results.set(step.order, failure);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // [W3] ANTI-THEATER GATE: a plan that declared file-producing work
        // but recorded ZERO verified writes is an honest FAILURE, never a
        // simulated COMPLETE.
        // ═══════════════════════════════════════════════════════════════
        const allArtifacts = Array.from(results.values()).flatMap(r => r.artifacts ?? []);
        const declaredFileWork = plan.steps.some(s => stepDeclaresFileWork(s));
        const verdict = evaluatePlanHonesty(declaredFileWork, allArtifacts.length);
        if (!verdict.pass) {
            errors.push(verdict.error!);
            console.error(`[PLAN_EXECUTOR] 🎭🚫 ${verdict.error}`);
        }

        // Compile final output from all successful steps
        const successfulResults = Array.from(results.values())
            .filter(r => r.success)
            .map(r => r.output);

        // CRITICAL FIX: Synthesize final output in USER_FACING language
        // This prevents JSON from technical agents leaking into chat
        // [PR-4c] Close ledger rows left open by an abort: steps never
        // executed (or abandoned mid-flight) become 'failed' with the reason,
        // never a silent eternal "running"/"pending".
        closeOpenTasks(plan.id, new Set(results.keys()), errors.join('; ') || 'plan aborted', attemptContexts);

        let finalOutput = 'Plan execution failed';
        if (successfulResults.length > 0) {
            finalOutput = await this.synthesizeFinalOutput(
                plan.originalRequest,
                successfulResults
            );
        }

        const totalTokens = Array.from(results.values())
            .reduce((sum, r) => sum + r.tokensUsed, 0);

        const executionResult: PlanExecutionResult = {
            planId: plan.id,
            // PR-J: zero successful steps is a FAILED plan even when nothing threw.
            // Live incident 2026-10-16: success:true reached chat with finalOutput
            // 'Plan execution failed' - a lying success that also poisoned the
            // experience buffer. Success requires no errors AND real output.
            success: errors.length === 0 && (plan.steps.length === 0 || successfulResults.length > 0),
            artifactsProduced: allArtifacts,
            steps: Array.from(results.values()),
            finalOutput,
            totalTokens,
            totalTimeMs: Date.now() - startTime,
            errors
        };

        // Emit plan completion
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            planId: plan.id,
            status: executionResult.success ? 'COMPLETED' : 'FAILED',
            totalSteps: plan.steps.length,
            completedSteps: results.size,
            errors: errors.length
        }, 'PLAN_EXECUTOR');

        console.log(`[PLAN_EXECUTOR] ${executionResult.success ? '✅' : '❌'} Plan ${plan.id} completed in ${executionResult.totalTimeMs}ms`);
        return executionResult;
    }

    /**
     * Execute a single step with all homeostatic checks
     */
    // [LEDGER-INTEGRITY] Hard ceiling per step: an LLM chain can hang
    // forever (prod 2026-10-16: a synthesize step hung for days and the
    // plan never aborted, stranding its ledger rows). The plan must fail
    // honestly instead. Env-overridable; the 30min default is ~5x the
    // slowest observed legitimate step (382s). A timed-out step's
    // background promise is recorded as late evidence when it settles.
    private withStepTimeout(planId: string, step: PlanStep, work: Promise<StepResult>, attempt?: TaskAttemptContext): Promise<StepResult> {
        const timeoutMs = Number(process.env.SILHOUETTE_STEP_TIMEOUT_MS ?? 30 * 60 * 1000);
        let timer: NodeJS.Timeout | undefined;
        let timedOut = false;
        const timeout = new Promise<StepResult>((resolve) => {
            timer = setTimeout(() => {
                timedOut = true;
                noteStepTimedOut(planId, step, attempt?.attemptId);
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
        const recordSettled = (late: StepOutcomeLike) => {
            try {
                const ack = recordLateSettlement(planId, step.order, late, attempt);
                if (ack.persisted && ack.releaseReady && !ack.conflict) clearAbandonedStep(planId, step.order, attempt?.attemptId);
                else console.error(`[PLAN_EXECUTOR] Late evidence conflict; retaining RAM hold for ${planId}:${step.order}`);
            } catch (error: any) {
                // No automatic retry or work replay. If the timeout itself was
                // not committed, RAM cannot survive a crash: this window remains.
                console.error(`[PLAN_EXECUTOR] Late evidence not committed; RAM hold retained for ${planId}:${step.order}: ${error?.message}`);
            }
        };
        work.then(late => { if (timedOut) recordSettled(late); },
            (e: any) => { if (timedOut) recordSettled({ stepOrder: step.order, success: false, error: `late rejection: ${e?.message}` }); });
        return Promise.race([work, timeout]).finally(() => { if (timer) clearTimeout(timer); });
    }

    private async executeStep(
        step: PlanStep,
        plan: ExecutionPlan,
        previousResults: Map<number, StepResult>,
        attempt?: TaskAttemptContext
    ): Promise<StepResult> {
        const stepStart = Date.now();
        console.log(`[PLAN_EXECUTOR] 📍 Step ${step.order}/${plan.steps.length}: ${step.agentRole}`);

        // ═══════════════════════════════════════════════════════════════════
        // HOMEOSTATIC CHECK 1: Resource Arbiter (RAM/CPU/VRAM)
        // ═══════════════════════════════════════════════════════════════════
        markTaskPhase(plan.id, step, 'waiting_resources', attempt);
        const arbiterApproved = await this.waitForResources(step);
        if (!arbiterApproved) {
            return {
                stepOrder: step.order,
                agentId: step.agentId,
                output: '',
                success: false,
                tokensUsed: 0,
                executionTimeMs: Date.now() - stepStart,
                error: 'Resource arbiter timeout'
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        // HOMEOSTATIC CHECK 2: Provider Health (RPM limits)
        // ═══════════════════════════════════════════════════════════════════
        if (!providerHealth.isAvailable('gemini')) {
            console.log(`[PLAN_EXECUTOR] ⚠️ Gemini unavailable, checking fallbacks...`);
            // In production, we'd try other providers here
        }

        // ═══════════════════════════════════════════════════════════════════
        // HOMEOSTATIC CHECK 3: Congestion Manager (Backpressure)
        // ═══════════════════════════════════════════════════════════════════
        if (congestionManager.isCongested()) {
            console.log(`[PLAN_EXECUTOR] 🚦 System congested. Pausing...`);
            markTaskPhase(plan.id, step, 'waiting_congestion', attempt);
            await this.pause(this.CONGESTION_PAUSE_MS);
        }

        // ═══════════════════════════════════════════════════════════════════
        // HYDRATE AGENT (Load into memory)
        // ═══════════════════════════════════════════════════════════════════
        markTaskPhase(plan.id, step, 'executing', attempt);
        try {
            await orchestrator.hydrateAgent(step.agentId);
        } catch (e) {
            console.warn(`[PLAN_EXECUTOR] Could not hydrate ${step.agentId}, using direct call`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // COMPILE CUSTOM PROMPT
        // ═══════════════════════════════════════════════════════════════════
        const previousOutputs = step.dependsOn
            .map(dep => previousResults.get(dep)?.output)
            .filter((o): o is string => !!o);

        const customPrompt = promptCompiler.compilePlanStep({
            agentRole: step.agentRole,
            agentId: step.agentId,
            stepNumber: step.order,
            totalSteps: plan.steps.length,
            taskDescription: step.taskDescription,
            previousStepResults: previousOutputs,
            originalUserRequest: plan.originalRequest,
            capabilities: step.requiredCapabilities
        });

        // ═══════════════════════════════════════════════════════════════════
        // EXECUTE STEP (LLM Call)
        // ═══════════════════════════════════════════════════════════════════
        congestionManager.updateQueueSize(1); // Increment queue

        try {
            // [W3] Real capabilities for the step: agent record + declared
            // step requirements; file-declaring work receives the minimal
            // JAILED fs tools. The executor grants — the jail confines.
            const agentCaps = orchestrator.getAgent(step.agentId)?.capabilities ?? [];
            // [Grant] Persist the FS grant durably for agents assigned
            // file-declaring work (idempotent; jail stays the enforcement).
            const durable = durableFileGrant(agentCaps, stepDeclaresFileWork(step));
            if (durable) {
                const rec = orchestrator.getAgent(step.agentId);
                if (rec) {
                    rec.capabilities = durable;
                    const { agentPersistence } = await import('./agentPersistence');
                    const { capabilityRegistry } = await import('./capabilityRegistry');
                    agentPersistence.saveAgent(rec);
                    capabilityRegistry.registerAgent(rec);
                    console.log(`[PLAN_EXECUTOR] 🔏 Durable FS grant persisted for ${step.agentId}`);
                }
            }
            const effectiveCapabilities: AgentCapability[] = Array.from(new Set([
                ...agentCaps,
                ...step.requiredCapabilities,
                ...(stepDeclaresFileWork(step)
                    ? [AgentCapability.ACTION_FILE_READ, AgentCapability.ACTION_FILE_WRITE]
                    : [])
            ]));

            const response = await geminiService.generateAgentResponse(
                step.agentRole,
                'PlanExecutor',
                'EXECUTION',
                step.taskDescription,
                previousOutputs.join('\n\n'),
                undefined,
                undefined,
                { useWebSearch: false, toolCaller: { requesterId: step.agentId, requesterRole: step.agentRole } },
                {},
                effectiveCapabilities,
                CommunicationLevel.TECHNICAL
            );

            // Report success to provider health
            providerHealth.reportSuccess('gemini');

            // ═══════════════════════════════════════════════════════════════
            // UNIFIED CAPABILITY EXECUTION: Process any tool calls in response
            // ═══════════════════════════════════════════════════════════════
            let finalOutput = response.output;
            const toolCalls = this.extractToolCalls(response.output);

            if (toolCalls.length > 0) {
                console.log(`[PLAN_EXECUTOR] 🔧 Found ${toolCalls.length} tool calls in step ${step.order}`);

                for (const toolCall of toolCalls) {
                    try {
                        const capResult = await orchestrator.executeCapability(
                            toolCall.name,
                            toolCall.args,
                            { requesterId: `plan_step_${step.order}`, priority: 'NORMAL' }
                        );

                        // PR-I: handlers sometimes report failure as an { error } payload
                        // instead of success:false - unwrap it so the plan sees the truth.
                        const innerError = capResult.success && capResult.data && typeof capResult.data === 'object'
                            && typeof (capResult.data as any).error === 'string'
                            ? String((capResult.data as any).error) : null;
                        if (innerError) { capResult.success = false; capResult.error = innerError; }

                        // Inject tool result into output
                        const resultSummary = capResult.success
                            ? `[Tool ${toolCall.name} completed: ${JSON.stringify(capResult.data).substring(0, 200)}]`
                            : `[Tool ${toolCall.name} failed: ${capResult.error}]`;

                        finalOutput = finalOutput.replace(toolCall.originalMatch, resultSummary);
                    } catch (toolError: any) {
                        console.warn(`[PLAN_EXECUTOR] Tool ${toolCall.name} failed:`, toolError.message);
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // FALLBACK: Auto-detect image generation intent when agent didn't use [TOOL:]
            // ═══════════════════════════════════════════════════════════════
            const hasImageToolCall = toolCalls.some(tc => tc.name === 'generate_image');
            const isImageRequest = this.detectImageGenerationIntent(plan.originalRequest);

            if (isImageRequest && !hasImageToolCall && step.agentRole === 'Creative_Director') {
                console.log(`[PLAN_EXECUTOR] 🎨 FALLBACK: Detected image request but no [TOOL:] tag. Auto-generating...`);

                // Extract the best image prompt from the agent's response
                const extractedPrompt = this.extractImagePromptFromText(response.output, plan.originalRequest);

                if (extractedPrompt) {
                    try {
                        const imgResult = await orchestrator.executeCapability(
                            'generate_image',
                            { prompt: extractedPrompt, style: 'PHOTOREALISTIC', aspectRatio: '16:9' },
                            { requesterId: `plan_step_${step.order}_fallback`, priority: 'NORMAL' }
                        );

                        if (imgResult.success) {
                            finalOutput += `\n\n[IMAGEN GENERADA AUTOMÁTICAMENTE]\n${JSON.stringify(imgResult.data)}`;
                            console.log(`[PLAN_EXECUTOR] ✅ Fallback image generation succeeded`);
                        }
                    } catch (e: any) {
                        console.warn(`[PLAN_EXECUTOR] Fallback image generation failed:`, e.message);
                    }
                }
            }

            // [W3] Verified artifacts written by this step's identities
            // (native tool loop + [TOOL:] text path + fallback).
            const stepActors = new Set([
                step.agentId,
                step.agentRole,
                `plan_step_${step.order}`,
                `plan_step_${step.order}_fallback`
            ]);
            const stepArtifacts = await collectWrittenArtifacts(stepActors, stepStart - 1000);

            // [PR-4b] Honest success: an empty or error-shaped LLM response is a
            // FAILURE, not a completed task. generateAgentResponse swallows provider
            // exhaustion into fixed strings ("An error occurred during agent
            // processing.", "Error: ...") instead of throwing, so success used to be
            // recorded for steps where the LLM never answered. Real verified tool
            // artifacts still count as success even with a thin text output.
            const trimmedOutput = (finalOutput ?? '').trim();
            const errorShaped = trimmedOutput.length === 0
                || /^Error:/.test(trimmedOutput)
                || /^An error occurred during agent processing\.?$/i.test(trimmedOutput)
                || /^\{\s*"error"/.test(trimmedOutput);
            if (errorShaped && stepArtifacts.length === 0) {
                providerHealth.reportFailure('gemini', 'empty or error-shaped LLM response');
                return {
                    stepOrder: step.order,
                    agentId: step.agentId,
                    output: finalOutput,
                    success: false,
                    tokensUsed: response.usage || 0,
                    executionTimeMs: Date.now() - stepStart,
                    error: 'LLM returned no usable content (empty or error-shaped response)'
                };
            }

            return {
                stepOrder: step.order,
                agentId: step.agentId,
                output: finalOutput,
                success: true,
                tokensUsed: response.usage || 0,
                executionTimeMs: Date.now() - stepStart,
                artifacts: stepArtifacts.map(a => a.path)
            };

        } catch (e: any) {
            // Report failure to provider health
            providerHealth.reportFailure('gemini', e.message);

            return {
                stepOrder: step.order,
                agentId: step.agentId,
                output: '',
                success: false,
                tokensUsed: 0,
                executionTimeMs: Date.now() - stepStart,
                error: e.message
            };

        } finally {
            congestionManager.updateQueueSize(-1); // Decrement queue
            resourceArbiter.release(); // Release resources

            // Dehydrate agent if not needed soon
            // (In production, we'd check if next steps need this agent)
            // orchestrator.dehydrateAgent(step.agentId);
        }
    }

    /**
     * Wait for resources to become available
     */
    private async waitForResources(step: PlanStep): Promise<boolean> {
        const mockAgent = {
            id: step.agentId,
            name: step.agentRole,
            role: step.agentRole,
            status: AgentStatus.IDLE,
            cpuUsage: 0,
            ramUsage: 0,
            memoryLocation: 'RAM' as const,
            lastActive: Date.now(),
            teamId: 'EXECUTION',
            category: 'OPS' as const,
            roleType: AgentRoleType.WORKER,
            enabled: true,
            tier: AgentTier.SPECIALIST,
            preferredMemory: 'RAM' as const
        };

        return resourceArbiter.requestAdmission(mockAgent, step.priority);
    }

    /**
     * Helper to pause execution
     */
    private pause(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Synthesize final output in USER_FACING natural language
     * This prevents JSON from technical agent responses from leaking into chat
     */
    private async synthesizeFinalOutput(
        originalRequest: string,
        stepResults: string[]
    ): Promise<string> {
        try {
            // Combine all step results for synthesis context
            const combinedResults = stepResults.join('\n\n---\n\n');

            const synthesisPrompt = `You are Silhouette, responding to the user's request.

ORIGINAL USER REQUEST:
"${originalRequest}"

COLLECTED INFORMATION FROM SPECIALISTS:
${combinedResults}

YOUR TASK:
Using the information above, provide a natural, conversational response to the user's request.
- Speak naturally in the user's language (Spanish if request was in Spanish)
- DO NOT output JSON, status objects, or technical artifacts
- DO NOT say "ejecutando", "procesando", or similar status messages
- Synthesize the key information into a helpful, direct answer
- Be concise but complete

RESPOND NOW:`;

            const response = await geminiService.generateAgentResponse(
                'Silhouette',
                'FinalSynthesis',
                'SYNTHESIS',
                synthesisPrompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.USER_FACING,
                'gemini-1.5-flash' // Fast model for synthesis
            );

            return response.output || combinedResults;

        } catch (e: any) {
            console.warn('[PLAN_EXECUTOR] Final synthesis failed, returning raw output:', e.message);
            // Fallback: return the last step result
            return stepResults[stepResults.length - 1] || 'Task completed.';
        }
    }

    /**
     * Handle help requests during plan execution
     */
    public async handleHelpRequest(
        requesterId: string,
        requesterRole: string,
        problem: string,
        context: any,
        requestId?: string
    ): Promise<string> {
        // Find best helper agent
        const helperRole = this.findBestHelper(problem);
        const helperId = this.mapRoleToAgentId(helperRole);

        console.log(`[PLAN_EXECUTOR] 🤝 Help request from ${requesterRole} → ${helperRole}`);

        // Compile help prompt
        const helpPrompt = promptCompiler.compileHelpRequest({
            requesterId,
            requesterRole,
            helperId,
            helperRole,
            problem,
            context
        });

        try {
            const response = await geminiService.generateAgentResponse(
                helperRole,
                'HelpHandler',
                'SUPPORT',
                problem,
                JSON.stringify(context),
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.EXECUTIVE
            );

            // Emit help response
            systemBus.emit(SystemProtocol.HELP_RESPONSE, {
                requestId,
                requesterId,
                helperId,
                success: !!response.output?.trim() && !response.output.startsWith("Error:"),
                solution: response.output
            }, helperId);

            return response.output;

        } catch (e: any) {
            console.error(`[PLAN_EXECUTOR] Help request failed:`, e);
            const solution = `Unable to provide help: ${e.message}`;
            systemBus.emit(SystemProtocol.HELP_RESPONSE, { requestId, requesterId, helperId, solution, success: false }, helperId);
            return solution;
        }
    }

    private findBestHelper(problem: string): string {
        const problemLower = problem.toLowerCase();

        if (problemLower.includes('research') || problemLower.includes('information')) {
            return 'Researcher_Pro';
        }
        if (problemLower.includes('code') || problemLower.includes('implement')) {
            return 'Code_Architect';
        }
        if (problemLower.includes('design') || problemLower.includes('creative')) {
            return 'Creative_Director';
        }
        if (problemLower.includes('quality') || problemLower.includes('test')) {
            return 'QA_Inquisitor';
        }

        return 'ManagerAgent';
    }

    private mapRoleToAgentId(role: string): string {
        const mapping: Record<string, string> = {
            'Researcher_Pro': 'sci-03',
            'Code_Architect': 'dev-01',
            'Creative_Director': 'mkt-lead',
            'QA_Inquisitor': 'qa-01',
            'ManagerAgent': 'manager'
        };
        return mapping[role] || 'manager';
    }

    /**
     * Extract tool calls from agent response text
     * Matches patterns like [TOOL: name(arg="value")] or [EXECUTE: name {...}]
     */
    private extractToolCalls(text: string): Array<{ name: string; args: Record<string, any>; originalMatch: string }> {
        const calls: Array<{ name: string; args: Record<string, any>; originalMatch: string }> = [];

        // Pattern 1: [TOOL: name(args)]
        const toolPattern = /\[TOOL:\s*([\w.]+)\((.*?)\)\]/gi;
        let match;
        while ((match = toolPattern.exec(text)) !== null) {
            calls.push({
                name: normalizeToolName(match[1]),
                args: this.parseToolArgs(match[2]),
                originalMatch: match[0]
            });
        }

        // Pattern 2: [EXECUTE: name {json}] - PR-I: delegate to the shared
        // balanced-brace scanner (services/tools/execMarker.ts). The old regex
        // (\w+)(\{.*?\}) truncated at the first inner '}' (corrupting nested
        // args) and rejected namespaced provider names like 'tool.write_file'.
        for (const marker of extractExecuteMarkers(text)) {
            calls.push({
                name: normalizeToolName(marker.name),
                args: marker.args,
                originalMatch: marker.originalMatch
            });
        }

        return calls;
    }

    /**
     * Parse tool arguments string into object
     */
    private parseToolArgs(argsString: string): Record<string, any> {
        const args: Record<string, any> = {};
        const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
        let match;

        while ((match = argPattern.exec(argsString)) !== null) {
            const [, name, quotedDouble, quotedSingle, unquoted] = match;
            const value = quotedDouble ?? quotedSingle ?? unquoted;
            try {
                args[name] = JSON.parse(value);
            } catch {
                args[name] = value;
            }
        }

        return args;
    }

    /**
     * Detect if the original request is asking for image generation
     */
    private detectImageGenerationIntent(request: string): boolean {
        const imageKeywords = [
            'genera una imagen', 'crea una imagen', 'generar imagen',
            'generate an image', 'create an image', 'make an image',
            'imagen de', 'image of', 'foto de', 'photo of',
            'ilustración', 'illustration', 'visual', 'picture',
            'diseña', 'design', 'dibuja', 'draw'
        ];

        const lowerRequest = request.toLowerCase();
        return imageKeywords.some(keyword => lowerRequest.includes(keyword));
    }

    /**
     * Extract the best image prompt from agent response text
     * When agent provides options or descriptions instead of using [TOOL:]
     */
    private extractImagePromptFromText(agentResponse: string, originalRequest: string): string | null {
        // Priority 1: Look for the agent's generated prompt (they often write good ones)
        // Pattern: text after "prompt:" or similar
        const promptPatterns = [
            /"prompt":\s*"([^"]{30,500})"/i,
            /prompt[:\s]+["']([^"']{30,500})["']/i,
            /genera(?:ndo|r)?.*?:\s*["']?([^"'\n]{30,300})/i,
        ];

        for (const pattern of promptPatterns) {
            const match = agentResponse.match(pattern);
            if (match && match[1]) {
                console.log(`[PLAN_EXECUTOR] 📝 Extracted prompt via pattern: "${match[1].substring(0, 80)}..."`);
                return match[1];
            }
        }

        // Priority 2: Look for substantial quoted text that looks like an image description
        const quotedMatches = agentResponse.match(/"([^"]{30,500})"/g);
        if (quotedMatches && quotedMatches.length > 0) {
            const bestMatch = quotedMatches
                .map(m => m.replace(/"/g, ''))
                .find(m =>
                    m.length > 50 &&
                    !m.includes('Option') &&
                    !m.includes('TOOL') &&
                    (m.includes('image') || m.includes('photo') || m.includes('drone') ||
                        m.includes('mountain') || m.includes('person') || m.includes('shot'))
                );

            if (bestMatch) {
                console.log(`[PLAN_EXECUTOR] 📝 Extracted prompt from quotes: "${bestMatch.substring(0, 80)}..."`);
                return bestMatch;
            }
        }

        // Priority 3: Clean the original request but preserve the core description
        // Match the actual content after common intro phrases
        const contentMatch = originalRequest.match(
            /(?:genera|crea|quiero|haz|make|create|generate).*?(?:imagen|image|foto|photo).*?(?:de|of|:)\s*(.+)/i
        );

        if (contentMatch && contentMatch[1]) {
            const cleanPrompt = contentMatch[1].trim();
            if (cleanPrompt.length > 20) {
                console.log(`[PLAN_EXECUTOR] 📝 Extracted core from request: "${cleanPrompt.substring(0, 80)}..."`);
                return cleanPrompt;
            }
        }

        // Priority 4: Just use the full original request as-is (better than broken text)
        if (originalRequest.length > 30) {
            console.log(`[PLAN_EXECUTOR] 📝 Using full original request as prompt`);
            return originalRequest;
        }

        return null;
    }
}

export const planExecutor = new PlanExecutor();
