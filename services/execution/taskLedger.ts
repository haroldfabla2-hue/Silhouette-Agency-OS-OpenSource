import type { TaskPhase } from './taskLoad';
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
import { sqliteService, validateTaskEvidence } from '../sqliteService';
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
    /** [LEDGER-INTEGRITY] Set when this outcome is a TIMEOUT verdict: the
     *  step's background promise may still be alive. Persisted durably so
     *  the uncertainty survives restarts; cleared by recordLateSettlement. */
    abandonedInFlight?: number;
}

export function taskIdFor(planId: string, order: number): string {
    return `task_${planId}_${order}`;
}

/** Exact attempt context is captured once at admission, including on write failure.
 * Event slots: verdict / late / reap / close. UUID event ID is stable per slot.
 * ACK requires same registered task+attempt+event ID+digest after COMMIT.
 * Conflict retains both tuples and NEVER releases the live RAM uncertainty.
 */
export interface TaskAttemptContext {
    attemptId: string;
    admittedAt: number;
    eventIds: { verdict: string; late: string; reap: string; close: string };
}
type EvidenceKind = keyof TaskAttemptContext['eventIds'];
export interface EvidenceAck { persisted: boolean; releaseReady?: boolean; conflict?: boolean; eventId: string; digest: string }
const localContexts = new WeakMap<object, TaskAttemptContext>();
// Compatibility registry records exact admissions in THIS process, not a guess
// from current row. More than one admission is ambiguous and never selects last.
const localAdmissions = new Map<string, TaskAttemptContext[]>();
function knownAdmission(planId: string, order: number): TaskAttemptContext | undefined {
    const known = localAdmissions.get(taskIdFor(planId, order));
    return known?.length === 1 ? known[0] : undefined;
}
const own = (value: any, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const managed = ['startedAt', 'finishedAt', 'output', 'outputChars', 'outputPreview', 'outputRef', 'outputSpillFailed', 'artifacts', 'error', 'tokensUsed', 'executionTimeMs', 'abandonedInFlight', 'lateSettlement', 'reconciledAt', 'effectsReviewed', 'evidence', 'loadPhase', 'loadPhaseAt'];
function namespace(data: any): any {
    if (own(data, 'taskEvidenceV1')) {
        const n = data.taskEvidenceV1;
        if (!n || typeof n !== 'object' || Array.isArray(n) || !n.attempts || typeof n.attempts !== 'object' || Array.isArray(n.attempts) || (n.unattributed !== undefined && (!n.unattributed || typeof n.unattributed !== 'object' || Array.isArray(n.unattributed)))) throw new Error('TASK_EVIDENCE_INVALID');
        return n;
    }
    throw new Error('TASK_ATTEMPT_NOT_REGISTERED');
}
function attemptAt(n: any, id: string): any {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !own(n.attempts, id)) throw new Error('TASK_ATTEMPT_NOT_REGISTERED');
    validateTaskEvidence({ taskEvidenceV1: n });
    const a = n.attempts[id];
    if (!a || typeof a !== 'object' || !a.events || typeof a.events !== 'object' || Array.isArray(a.events) || !a.eventIds || typeof a.eventIds !== 'object' || Array.isArray(a.eventIds)) throw new Error('TASK_ATTEMPT_INVALID');
    for (const [kind, slot] of Object.entries(a.events) as [string, any][]) {
        if (!['verdict', 'late', 'reap', 'close'].includes(kind) || !slot || typeof slot !== 'object' || Array.isArray(slot) || typeof slot.eventId !== 'string' || !slot.primary || typeof slot.primary.digest !== 'string' || !slot.primary.payload || !slot.conflicts || typeof slot.conflicts !== 'object' || Array.isArray(slot.conflicts)) throw new Error('TASK_EVENT_INVALID');
    }
    return a;
}
function canonical(value: any): string {
    if (Array.isArray(value)) return '[' + value.map(v => canonical(v ?? null)).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
function unresolvedConflict(slot: any): boolean {
    const variants = Object.keys(slot.conflicts);
    if (!variants.length) return false;
    const reviewed = slot.resolution?.reviewedDigests;
    return !Array.isArray(reviewed) || [slot.primary.digest, ...variants].some(d => !reviewed.includes(d));
}
function project(data: any, n: any, id: string, rowStatus: string): string {
    if (n.currentAttemptId !== id) return rowStatus;
    const a = attemptAt(n, id);
    const verdict = a.events.verdict?.primary.payload;
    const closed = a.events.close?.primary.payload ?? a.events.reap?.primary.payload;
    const late = a.events.late?.primary.payload;
    for (const key of managed.filter(k => !['loadPhase', 'loadPhaseAt', 'startedAt'].includes(k))) delete data[key];
    const result = verdict ?? closed;
    if (result) Object.assign(data, result);
    if (late) { data.lateSettlement = late; data.reconciledAt = late.finishedAt; }
    if (a.effectsReviewed) data.effectsReviewed = a.effectsReviewed;
    if ((late || a.effectsReviewed) && !Object.values(a.events).some((e: any) => unresolvedConflict(e))) delete data.abandonedInFlight;
    return verdict ? (verdict.success && !verdict.abandonedInFlight ? 'completed' : 'failed') : closed ? 'failed' : rowStatus;
}

/** New admission retains the full previous row inside baselineLegacy on first
 * versioning. Only admission changes currentAttemptId. No history is truncated. */
export function recordPlanTasks(plan: ExecutionPlan): Map<number, TaskAttemptContext> {
    const contexts = new Map<number, TaskAttemptContext>();
    for (const step of plan.steps) {
        const context: TaskAttemptContext = { attemptId: crypto.randomUUID(), admittedAt: Date.now(), eventIds: { verdict: crypto.randomUUID(), late: crypto.randomUUID(), reap: crypto.randomUUID(), close: crypto.randomUUID() } };
        contexts.set(step.order, context); localContexts.set(step, context);
        const admissionKey = taskIdFor(plan.id, step.order);
        localAdmissions.set(admissionKey, [...(localAdmissions.get(admissionKey) ?? []), context]);
        const id = taskIdFor(plan.id, step.order);
        try {
            sqliteService.admitTaskAttempt({ id, description: step.taskDescription, assigned_to: step.agentId, status: 'pending', data: {
                planId: plan.id, stepOrder: step.order, agentRole: step.agentRole, dependsOn: step.dependsOn,
                priority: step.priority, requiredCapabilities: step.requiredCapabilities, originalRequest: plan.originalRequest?.substring(0, 500)
            } }, (row: any, data: any) => {
                const n = own(data, 'taskEvidenceV1') ? namespace(data) : { currentAttemptId: context.attemptId, attempts: {}, baselineLegacy: row ? { status: row.status, data: structuredClone(data) } : undefined };
                const admissionSnapshot = structuredClone(data); delete admissionSnapshot.taskEvidenceV1;
                n.attempts[context.attemptId] = { admittedAt: context.admittedAt, eventIds: context.eventIds, events: {},
                    admission: { ...admissionSnapshot, description: step.taskDescription, assigned_to: step.agentId, planId: plan.id, stepOrder: step.order, agentRole: step.agentRole,
                        dependsOn: structuredClone(step.dependsOn), priority: step.priority, requiredCapabilities: structuredClone(step.requiredCapabilities), originalRequest: plan.originalRequest, loadPhase: 'admitted' } };
                n.currentAttemptId = context.attemptId;
                for (const key of managed) delete data[key];
                Object.assign(data, { planId: plan.id, stepOrder: step.order, agentRole: step.agentRole, dependsOn: step.dependsOn, priority: step.priority, requiredCapabilities: step.requiredCapabilities, loadPhase: 'admitted', loadPhaseAt: Date.now(), taskEvidenceV1: n });
                return data;
            });
        } catch (e: any) { console.warn(`[TASK_LEDGER] admission failed ${id} attempt=${context.attemptId}: ${e?.message}`); }
    }
    return contexts;
}
export function markTaskRunning(planId: string, step: PlanStep, context?: TaskAttemptContext): void {
    try {
        context ??= localContexts.get(step) ?? knownAdmission(planId, step.order);
        if (!context) { legacyObservation(planId, step, 'running'); return; }
        sqliteService.mutateTaskEvidence(taskIdFor(planId, step.order), (row, data) => {
            const n = namespace(data); const a = attemptAt(n, context.attemptId);
            if (n.currentAttemptId !== context.attemptId || a.events.verdict || a.events.reap || a.events.close) return null;
            data.startedAt = Date.now();
            return { data, status: 'running', value: true };
        });
    } catch (e: any) { console.warn(`[TASK_LEDGER] mark running failed: ${e?.message}`); }
}

/** Outputs are NEVER omitted by size. Small outputs persist inline in the
 *  ledger row; large ones spill to an immutable file (exclusive tmp+fsync+link) and
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

function persistOutputForLedger(eventIdentity: string, output: string): { output: string; outputChars: number; extra: Record<string, any> } {
    const outputChars = output.length;
    if (outputChars <= OUTPUT_INLINE_LIMIT_CHARS) {
        return { output, outputChars, extra: {} };
    }
    try {
        const dir = taskOutputDir();
        fs.mkdirSync(dir, { recursive: true });
        // Immutable publication: a late result must never replace earlier bytes.
        // Names contain no caller-controlled path fragments. DB commit can fail
        // after this publication, leaving a recoverable orphan, never an overwrite.
        const sha256 = crypto.createHash('sha256').update(output, 'utf8').digest('hex');
        const eventKey = crypto.createHash('sha256').update(eventIdentity, 'utf8').digest('hex');
        const file = path.join(dir, `${eventKey}-${sha256}.txt`);
        const tmp = path.join(dir, `.pending-${crypto.randomUUID()}`);
        let fd: number | undefined;
        try {
            fd = fs.openSync(tmp, 'wx', 0o600);
            fs.writeFileSync(fd, output, 'utf8');
            fs.fsyncSync(fd);
            fs.closeSync(fd); fd = undefined;
            try { fs.linkSync(tmp, file); }
            catch (error: any) {
                if (error?.code !== 'EEXIST') throw error;
                const existing = fs.readFileSync(file);
                if (existing.length !== Buffer.byteLength(output, 'utf8') ||
                    crypto.createHash('sha256').update(existing).digest('hex') !== sha256) {
                    throw new Error('TASK_OUTPUT_IMMUTABLE_CONFLICT');
                }
            }
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
        const directoryFd = fs.openSync(dir, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
        return {
            output: output.substring(0, OUTPUT_PREVIEW_CHARS) + `\n[PREVIEW ONLY - full output (${outputChars} chars) persisted at ${file} ; sha256:${sha256}]`,
            outputChars,
            extra: { outputPreview: true, outputRef: { path: file, bytes: Buffer.byteLength(output, 'utf8'), sha256 } }
        };
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] output spill failed for ${eventIdentity}; keeping FULL output inline (${outputChars} chars): ${e?.message}`);
        return { output, outputChars, extra: { outputSpillFailed: true } };
    }
}

/** Legacy entry points remain usable. No last-attempt inference: ambiguous
 * versioned outcomes are conserved as unattributed evidence and block review. */
function legacyObservation(planId: string, step: PlanStep, status?: string, phase?: TaskPhase): void {
    if (status) sqliteService.ensureLegacyTask({ id: taskIdFor(planId, step.order), description: step.taskDescription, assigned_to: step.agentId, status: 'pending', data: { planId, stepOrder: step.order, agentRole: step.agentRole } });
    sqliteService.mutateTaskEvidence(taskIdFor(planId, step.order), (row, data) => {
        if (own(data, 'taskEvidenceV1')) throw new Error('TASK_CONTEXT_REQUIRED_FOR_VERSIONED_OBSERVATION');
        if (!['pending', 'running'].includes(row.status)) return null;
        if (phase) { data.loadPhase = phase; data.loadPhaseAt = Date.now(); }
        if (status) data.startedAt = Date.now();
        return { data, status: status ?? row.status, value: true };
    });
}
function legacyOutcome(planId: string, order: number, kind: 'verdict' | 'late', result: StepOutcomeLike, step?: PlanStep): EvidenceAck {
    const id = taskIdFor(planId, order);
    const eventId = crypto.randomUUID(); // Unknown caller attempt: never claim historical identity/dedup.
    const digest = crypto.createHash('sha256').update(canonical(result)).digest('hex');
    if (kind === 'verdict') sqliteService.ensureLegacyTask({ id, description: step?.taskDescription ?? '', assigned_to: step?.agentId ?? '', status: 'pending', data: { planId, stepOrder: order } });
    const ack = sqliteService.mutateTaskEvidence(id, (row, data) => {
        const persisted = persistOutputForLedger(`${id}:legacy-unattributed:${eventId}:${digest}`, result.output ?? '');
        const payload = { ...result, output: persisted.output, outputChars: persisted.outputChars, ...persisted.extra, finishedAt: Date.now(), artifacts: result.artifacts ?? [] };
        if (own(data, 'taskEvidenceV1')) {
            const n = namespace(data);
            n.unattributed ??= {};
            n.unattributed[eventId] = { kind, digest, payload, provenance: 'CALLER_CONTEXT_MISSING' };
            console.error(`[TASK_LEDGER] unattributed result preserved task=${id} event=${eventId}`);
            return { data, value: { persisted: false, releaseReady: false, conflict: true, eventId, digest } };
        }
        // Canonical legacy evidence retains the original tuple before projection.
        if (!own(data, 'legacyEvidenceBaseline')) data.legacyEvidenceBaseline = { status: row.status, data: structuredClone(data) };
        data.legacyTaskEvidence ??= [];
        if (!Array.isArray(data.legacyTaskEvidence)) throw new Error('TASK_LEGACY_EVIDENCE_INVALID');
        data.legacyTaskEvidence.push({ eventId, digest, kind, payload, provenance: 'LEGACY_ATTEMPT_UNKNOWN' });
        if (kind === 'late') { data.lateSettlement = payload; data.reconciledAt = payload.finishedAt; delete data.abandonedInFlight; }
        else {
            for (const key of ['output', 'outputChars', 'outputPreview', 'outputRef', 'outputSpillFailed', 'artifacts', 'error', 'tokensUsed', 'executionTimeMs']) delete data[key];
            const priorLate = data.lateSettlement; const priorReview = data.effectsReviewed; const priorUncertainty = data.abandonedInFlight;
            Object.assign(data, payload);
            if (priorLate) data.lateSettlement = priorLate;
            if (priorReview) data.effectsReviewed = priorReview;
            if (priorUncertainty && !priorLate && !priorReview) data.abandonedInFlight = priorUncertainty;
            if (result.abandonedInFlight && !priorLate && !priorReview) data.abandonedInFlight = { timedOutAt: result.abandonedInFlight };
            if (priorLate || priorReview) delete data.abandonedInFlight;
            if (result.success && !(result.output ?? '').length && !(result.artifacts ?? []).length && !result.error) data.evidence = 'none';
        }
        return { data, status: kind === 'late' ? row.status : result.success ? 'completed' : 'failed', value: { persisted: true, releaseReady: false, eventId, digest } };
    });
    if (!ack) throw new Error('TASK_LEGACY_NO_ACK');
    return ack;
}
function appendControlEvent(a: any, kind: 'reap' | 'close', payload: any): boolean {
    const digest = crypto.createHash('sha256').update(canonical({ success: false, error: payload.error })).digest('hex');
    const slot = a.events[kind];
    if (!slot) { a.events[kind] = { eventId: a.eventIds[kind], primary: { digest, payload }, conflicts: {} }; return true; }
    if (slot.primary.digest !== digest && !own(slot.conflicts, digest)) { slot.conflicts[digest] = payload; return true; }
    return false;
}

function writeOutcome(planId: string, order: number, context: TaskAttemptContext, kind: EvidenceKind, result: StepOutcomeLike): EvidenceAck {
    const id = taskIdFor(planId, order);
    const eventId = context.eventIds[kind];
    const raw = { success: result.success, output: result.output ?? '', error: result.error, artifacts: result.artifacts ?? [], tokensUsed: result.tokensUsed ?? 0, executionTimeMs: result.executionTimeMs ?? 0,
        ...(result.abandonedInFlight ? { abandonedInFlight: { timedOutAt: result.abandonedInFlight } } : {}) };
    const digest = crypto.createHash('sha256').update(canonical(raw)).digest('hex');
    try {
        const ack = sqliteService.mutateTaskEvidence(id, (row, data) => {
            const n = namespace(data); const a = attemptAt(n, context.attemptId);
            if (a.eventIds?.[kind] !== eventId) throw new Error('TASK_EVENT_ID_MISMATCH');
            const existing = a.events[kind];
            if (existing) {
                if (existing.eventId !== eventId) throw new Error('TASK_EVENT_ID_MISMATCH');
                if (existing.primary.digest === digest) {
                    const ref = existing.primary.payload.outputRef;
                    if (ref) {
                        const bytes = fs.readFileSync(ref.path);
                        if (bytes.length !== ref.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('TASK_OUTPUT_REFERENCE_INVALID');
                    }
                    const conflict = Object.values(a.events).some((e: any) => unresolvedConflict(e));
                    const releaseReady = !!a.events.verdict?.primary.payload.abandonedInFlight && !!a.events.late && !conflict;
                    return { data, readonly: true, value: { persisted: !conflict, releaseReady, conflict, eventId, digest } };
                }
                if (own(existing.conflicts, digest)) return { data, readonly: true, value: { persisted: false, releaseReady: false, conflict: true, eventId, digest } };
            }
            // Validation precedes immutable FS publication. A failed DB COMMIT
            // can leave an orphan identified by eventId/digest; never overwrite.
            const persisted = persistOutputForLedger(`${id}:${context.attemptId}:${kind}:${eventId}:${digest}`, raw.output);
            const noEvidence = raw.success && raw.output.length === 0 && raw.artifacts.length === 0 && !raw.error;
            if (noEvidence) console.warn(`[TASK_LEDGER] completed outcome has no persisted evidence task=${id} event=${eventId}`);
            const payload = { ...raw, output: persisted.output, outputChars: persisted.outputChars, ...persisted.extra, finishedAt: Date.now(), ...(noEvidence ? { evidence: 'none' } : {}) };
            if (existing) existing.conflicts[digest] = payload;
            else a.events[kind] = { eventId, primary: { digest, payload }, conflicts: {} };
            const status = project(data, n, context.attemptId, row.status);
            const conflict = Object.values(a.events).some((e: any) => unresolvedConflict(e));
            const releaseReady = !!a.events.verdict?.primary.payload.abandonedInFlight && !!a.events.late && !conflict;
            return { data, status, value: { persisted: !conflict, releaseReady, conflict, eventId, digest } };
        });
        if (!ack) throw new Error('TASK_EVIDENCE_NO_ACK');
        if (ack.conflict) console.error(`[TASK_LEDGER] evidence conflict task=${id} attempt=${context.attemptId} event=${eventId} digest=${digest}`);
        return ack;
    } catch (error: any) {
        console.error(`[TASK_LEDGER] evidence not committed task=${id} attempt=${context.attemptId} event=${eventId} digest=${digest}; immutable orphan may exist: ${error?.message}`);
        throw error;
    }
}
export function markTaskDone(planId: string, step: PlanStep, result: StepOutcomeLike, context?: TaskAttemptContext): EvidenceAck | undefined {
    try {
        if (!context) return legacyOutcome(planId, step.order, 'verdict', result, step);
        return writeOutcome(planId, step.order, context, 'verdict', result);
    } catch (e: any) { console.warn(`[TASK_LEDGER] mark done failed: ${e?.message}`); return undefined; }
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
                const changed = sqliteService.mutateTaskEvidence(row.id, (latest, data) => {
                    if (!statuses.includes(latest.status) || latest.updated_at >= beforeMs) return null;
                    const payload = { success: false, finishedAt: Date.now(), error: `reaped: ${reason}` };
                    if (own(data, 'taskEvidenceV1')) {
                        const n = namespace(data); const a = attemptAt(n, n.currentAttemptId);
                        if (!appendControlEvent(a, 'reap', payload)) return { data, readonly: true, value: false };
                        return { data, status: project(data, n, n.currentAttemptId, latest.status), value: true };
                    }
                    // Legacy provenance stays unknown; retain the whole metadata.
                    Object.assign(data, payload);
                    return { data, status: 'failed', value: true };
                });
                if (changed) reaped++;
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

/** Durable uncertainty: abandoned-in-flight rows with no settlement and
 *  no explicit reconciliation. Source of truth is SQLite, so the block
 *  survives restarts. */
export function getUnresolvedAbandonedTaskRows(): any[] {
    try {
        return sqliteService.getUnresolvedAbandonedTasks();
    } catch (e: any) {
        console.warn(`[TASK_LEDGER] unresolved-abandoned query failed (fail-closed: reporting one synthetic blocker): ${e?.message}`);
        return [{ id: 'unknown', description: 'abandoned-step query failed', data: '{}' }];
    }
}

/**
 * [LEDGER-INTEGRITY] Resolve the attribution for an explicit
 * reconciliation from the AUTHENTICATED PRINCIPAL (set by the existing
 * authMiddleware: session user, or the master-token system identity).
 * The attestation changes how the system treats uncertain state, so it
 * requires the same level the platform grants to "can modify Silhouette
 * itself": role CREATOR. The request body is never an identity source.
 */
export function reconcileAttributionFor(principal: { id?: string; role?: string } | undefined | null): string {
    if (!principal?.id || principal.role !== 'CREATOR') {
        throw Object.assign(new Error('CREATOR-level authenticated operator required for abandoned-step reconciliation'), { statusCode: 403 });
    }
    return `user:${principal.id}`;
}

/**
 * [LEDGER-INTEGRITY] Explicit, attributed reconciliation of an abandoned
 * step whose writer is gone but whose PARTIAL EFFECTS are uncertain. An
 * auditable row alone does not make a re-run safe; a human (or operator
 * process) must inspect the jailed write roots / memory effects and
 * attest the review. The attestation is durable (who/when/note). Until
 * then the retry gate keeps blocking. Throws honest errors when there is
 * nothing to reconcile or attestation fields are missing.
 */
export interface EvidenceSelector { attemptId?: string; legacy?: boolean; eventId?: string; digest?: string; decision?: 'reviewed_preserve_verdict' }
export function reconcileAbandonedStepEffects(planId: string, stepOrder: number, reconciledBy: string, note: string, selector: EvidenceSelector = {}): any {
    const by = (reconciledBy ?? '').trim(); const text = (note ?? '').trim();
    if (!by || !text) throw Object.assign(new Error('reconciledBy and note are required'), { statusCode: 400 });
    if (selector.attemptId && !/^[0-9a-f-]{36}$/i.test(selector.attemptId)) throw Object.assign(new Error('Invalid attempt selector'), { statusCode: 400 });
    if (selector.digest && !/^[0-9a-f]{64}$/.test(selector.digest)) throw Object.assign(new Error('Invalid evidence digest'), { statusCode: 400 });
    if (selector.attemptId && selector.legacy) throw Object.assign(new Error('Choose attempt or legacy, not both'), { statusCode: 400 });
    const id = taskIdFor(planId, stepOrder);
    return sqliteService.mutateTaskEvidence(id, (row, data) => {
        const candidates: { target: any; legacy?: boolean; attemptId?: string; eventId?: string; digest?: string; kind: string; slot?: any }[] = [];
        if (own(data, 'taskEvidenceV1')) {
            const n = namespace(data);
            for (const attemptId of Object.keys(n.attempts)) {
                const a = attemptAt(n, attemptId);
                if (a.events.verdict?.primary.payload.abandonedInFlight && !a.events.late && !a.effectsReviewed) candidates.push({ target: a, attemptId, kind: 'timeout' });
                for (const slot of Object.values(a.events) as any[]) {
                    if (unresolvedConflict(slot)) {
                        for (const digest of [slot.primary.digest, ...Object.keys(slot.conflicts)]) candidates.push({ target: a, attemptId, eventId: slot.eventId, digest, kind: 'conflict', slot });
                    }
                }
            }
            const base = n.baselineLegacy?.data;
            if (base?.abandonedInFlight && !base.lateSettlement && !base.effectsReviewed) candidates.push({ target: base, legacy: true, kind: 'timeout' });
            for (const [eventId, event] of Object.entries(n.unattributed ?? {}) as [string, any][]) if (!event.resolution) candidates.push({ target: event, eventId, digest: event.digest, kind: 'unattributed' });
        } else if (data.abandonedInFlight && !data.lateSettlement && !data.effectsReviewed) candidates.push({ target: data, legacy: true, kind: 'timeout' });
        const eligible = candidates.filter(c => (!selector.attemptId || c.attemptId === selector.attemptId) && (!selector.legacy || c.legacy) && (!selector.eventId || c.eventId === selector.eventId) && (!selector.digest || c.digest === selector.digest));
        if (eligible.length !== 1) throw Object.assign(new Error('Select exactly one eligible uncertainty'), { statusCode: 409, candidates: candidates.map(c => ({ attemptId: c.attemptId, legacy: c.legacy, eventId: c.eventId, digest: c.digest, kind: c.kind })) });
        const c = eligible[0]; const review = { by, at: Date.now(), note: text };
        if (c.kind !== 'timeout') {
            if (!selector.eventId || !selector.digest || selector.decision !== 'reviewed_preserve_verdict') throw Object.assign(new Error('Evidence selector and reviewed_preserve_verdict decision required'), { statusCode: 400 });
            if (c.kind === 'conflict') {
                if (c.slot.resolution) { c.slot.resolutionHistory ??= []; c.slot.resolutionHistory.push(structuredClone(c.slot.resolution)); }
                c.slot.resolution = { ...review, selectedDigest: c.digest, reviewedDigests: [c.slot.primary.digest, ...Object.keys(c.slot.conflicts)], decision: selector.decision };
            }
            else c.target.resolution = { ...review, decision: selector.decision };
            // Resolution acknowledges uncertainty, never erases variants or changes a verdict.
        } else { c.target.effectsReviewed = review; if (c.legacy) delete c.target.abandonedInFlight; }
        const status = own(data, 'taskEvidenceV1') ? project(data, namespace(data), namespace(data).currentAttemptId, row.status) : row.status;
        return { data, status, value: { id, status, data } };
    });
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
export function recordLateSettlement(planId: string, stepOrder: number, late: StepOutcomeLike, context?: TaskAttemptContext): EvidenceAck {
    // Three-argument results carry no causal attempt identity. Never infer it
    // from a unique local admission: a preexisting legacy writer may settle now.
    if (!context) return legacyOutcome(planId, stepOrder, 'late', late);
    return writeOutcome(planId, stepOrder, context, 'late', late);
}

/**
 * [PR-4c] Close ledger rows a plan abort leaves open. Any step that never
 * reached execution (still 'pending') or was left mid-flight ('running') is
 * marked 'failed' with the abort reason - the ledger must never show eternal
 * "running" for work the executor already abandoned (prod 2026-10-16:
 * task_plan_d3c00a3e_2 sat "running" after the LLM chain gave up).
 */
export function closeOpenTasks(planId: string, executedOrders: Set<number>, reason: string, contexts?: Map<number, TaskAttemptContext>): void {
    try {
        for (const row of sqliteService.getTasksByPlan(planId)) {
            sqliteService.mutateTaskEvidence(row.id, (latest, data) => {
                const order = data.stepOrder;
                if (executedOrders.has(order) || !['pending', 'running'].includes(latest.status)) return null;
                if (data.planId !== planId || taskIdFor(planId, order) !== row.id) return null;
                if (own(data, 'taskEvidenceV1')) {
                    const n = namespace(data); const ctx = contexts?.get(order) ?? knownAdmission(planId, order);
                    if (!ctx || ctx.attemptId !== n.currentAttemptId) throw new Error(`TASK_CLOSE_CONTEXT_AMBIGUOUS:${row.id}`);
                    const a = attemptAt(n, ctx.attemptId);
                    const payload = { success: false, finishedAt: Date.now(), error: `aborted: ${reason}` };
                    if (!appendControlEvent(a, 'close', payload)) return { data, readonly: true, value: false };
                    return { data, status: project(data, n, ctx.attemptId, latest.status), value: true };
                }
                Object.assign(data, { finishedAt: Date.now(), error: `aborted: ${reason}` });
                return { data, status: 'failed', value: true };
            });
        }
    } catch (e: any) { console.warn(`[TASK_LEDGER] close failed: ${e?.message}`); }
}

/** Observation only; a write failure never changes execution. */
export function markTaskPhase(planId: string, step: PlanStep, phase: TaskPhase, context?: TaskAttemptContext): void {
    try {
        context ??= localContexts.get(step) ?? knownAdmission(planId, step.order);
        if (!context) { legacyObservation(planId, step, undefined, phase); return; }
        sqliteService.mutateTaskEvidence(taskIdFor(planId, step.order), (row, data) => {
            const n = namespace(data); const a = attemptAt(n, context.attemptId);
            if (n.currentAttemptId !== context.attemptId || !['pending', 'running'].includes(row.status) || a.events.verdict || a.events.close || a.events.reap) return null;
            data.loadPhase = phase; data.loadPhaseAt = Date.now();
            return { data, value: true };
        });
    }
    catch (e: any) { console.warn(`[TASK_LEDGER] phase observation failed (non-blocking): ${e?.message}`); }
}
