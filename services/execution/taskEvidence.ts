import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { observeUsage, observeProviderAttempts, installUsageContext, type ProviderAttempt, type UsageObservation } from '../usageObservation.ts';

export type DataLabel = 'SECRET' | 'PII' | 'USER_PRIVATE' | 'EXTERNAL';
export interface CallEvidence {
    id: string; parentId?: string; tool: string; startedAt: number; durationMs: number;
    outcome: 'ok' | 'error' | 'blocked'; inputBytes: number | null; outputBytes: number | null;
    labels: DataLabel[]; errorCode?: 'DATA_FLOW_DENIED' | 'TOOL_ERROR';
}
export interface TaskEvidenceSnapshot {
    version: 1; taskId: string; labels: DataLabel[]; calls: CallEvidence[];
    callsObserved: number; callsOmitted: number; activeCalls: number;
    usage: UsageObservation[]; usageOmitted: number; attempts: ProviderAttempt[]; attemptsOmitted: number;
    estimatedUsd: number | null; knownEstimatedUsd: number;
    unknownPriceCalls: number; detailExpiresAt: number; expired: boolean; capture: 'metadata-only';
}
const usageOrder = new WeakMap<UsageObservation, number>();
const attemptOrder = new WeakMap<ProviderAttempt, number>();
interface Scope {
    serial: number;
    joined: WeakMap<Scope, {usage: number; attempts: number; usageOmitted: number; attemptsOmitted: number}>;
    parent?: Scope;
    id: string; labels: Set<DataLabel>; calls: CallEvidence[]; observed: number;
    active: number; usage: UsageObservation[]; usageOmitted: number;
    attempts: Map<string, ProviderAttempt>; attemptsOmitted: number;
    knownCost: number; unknownCost: number; created: number;
}
interface Context { scope: Scope; parent?: string; invocationId?: string }
const context = new AsyncLocalStorage<Context>();
const MAX_CALLS = 128, MAX_USAGE = 128, DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const labels = new Set<DataLabel>(['SECRET', 'PII', 'USER_PRIVATE', 'EXTERNAL']);
const safeUsageName = (name?: string): string => name && /^[A-Za-z0-9_.:/-]{1,96}$/.test(name) &&
    !/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/i.test(name) ? name : 'unknown';

function summarizeCost(scope: Scope): { known: number; unknown: number; total: number | null } {
    // One accounting unit per invocation. Duplicate estimator callbacks cannot add
    // another charge; disagreement is unknown rather than silently choosing a price.
    const units = new Map<string, number | null>();
    for (const row of scope.usage) {
        const key = row.invocationId ?? row.observationId!;
        const previous = units.get(key);
        units.set(key, units.has(key) && previous !== row.estimatedUsd ? null : row.estimatedUsd);
    }
    for (const attempt of scope.attempts.values()) {
        if (!units.has(attempt.invocationId) || attempt.outcome !== 'completed') units.set(attempt.invocationId, null);
    }
    let known = 0, unknown = scope.attemptsOmitted + scope.usageOmitted;
    for (const cost of units.values()) { if (cost === null) unknown++; else known += cost; }
    return { known, unknown, total: unknown || units.size === 0 ? null : known };
}

/** Only serializable values. Never getters, toJSON, arbitrary object traversal or raw capture. */
export function inspectData(value: unknown): { labels: DataLabel[]; bytes: number | null } {
    const found = new Set<DataLabel>(), seen = new WeakSet<object>();
    let bytes = 0, nodes = 0, incomplete = false;
    const scan = (text: string) => {
        bytes += Buffer.byteLength(text);
        // Bounded scanning fails closed instead of silently missing a late secret.
        if (bytes > 1_048_576) { incomplete = true; return; }
        if (/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|\b(?:api[_-]?key|password|authorization|access[_-]?token)\s*[:=]\s*\S+|\bBearer\s+\S+)/i.test(text)) found.add('SECRET');
        if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+\d[\d .()-]{7,}\d)/i.test(text)) found.add('PII');
    };
    const visit = (item: unknown, depth: number) => {
        if (++nodes > 4096 || depth > 16) { incomplete = true; return; }
        if (typeof item === 'string') { scan(item); return; }
        if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') return;
        if (typeof item !== 'object' || seen.has(item)) { incomplete = true; return; }
        seen.add(item);
        if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) { incomplete = true; return; }
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
            if (key === 'length' && Array.isArray(item)) continue;
            if (!('value' in descriptor)) { incomplete = true; continue; }
            if (/^(?:password|secret|api_?key|access_?token|authorization|private_?key)$/i.test(key) && descriptor.value) found.add('SECRET');
            visit(descriptor.value, depth + 1);
            if (incomplete) break;
        }
    };
    try { visit(value, 0); } catch { incomplete = true; }
    if (incomplete) found.add('SECRET');
    return { labels: [...found].sort(), bytes: incomplete ? null : bytes };
}
export function addDataLabels(add: readonly DataLabel[]): void {
    let scope = context.getStore()?.scope;
    while (scope) { for (const label of add) if (labels.has(label)) scope.labels.add(label); scope = scope.parent; }
}
export function currentDataLabels(): DataLabel[] {
    const found = new Set<DataLabel>(); let scope = context.getStore()?.scope;
    while (scope) { for (const label of scope.labels) found.add(label); scope = scope.parent; }
    return [...found].sort();
}
export class DataFlowDeniedError extends Error {
    readonly code = 'DATA_FLOW_DENIED';
    constructor() { super('DATA_FLOW_DENIED: sensitive data requires an explicit supported disclosure boundary; no effect executed'); }
}
/** No content-supplied label or declassification parameter exists. Existing consent is additive, never bypassed. */
export function assertDataSink(sink: 'local' | 'external' | 'unconfined', input: unknown, exactDisclosureApproved = false): void {
    const detected = inspectData(input).labels;
    addDataLabels(detected);
    const current = new Set([...currentDataLabels(), ...detected]);
    if ((sink !== 'local' && (current.has('SECRET') || (!exactDisclosureApproved && (current.has('PII') || current.has('USER_PRIVATE'))))) ||
        (sink === 'unconfined' && current.has('EXTERNAL'))) throw new DataFlowDeniedError();
}
export function createTaskEvidence(taskId: string, inherited: readonly DataLabel[] = []) {
    const parentScope = context.getStore()?.scope;
    const scope: Scope = { serial: 0, joined: new WeakMap(), parent: parentScope, id: taskId, labels: new Set([...inherited, ...(parentScope?.labels ?? [])].filter(l => labels.has(l))), calls: [], observed: 0,
        active: 0, usage: [], usageOmitted: 0, attempts: new Map(), attemptsOmitted: 0, knownCost: 0, unknownCost: 0, created: Date.now() };
    return {
        run<T>(fn: () => T): T {
            const active = context.getStore();
            const parentScope = active?.scope !== scope ? active?.scope ?? scope.parent : scope.parent;
            scope.parent = parentScope;
            if (parentScope) for (const label of parentScope.labels) scope.labels.add(label);
            const join = () => {
                if (!parentScope) return;
                for (const label of scope.labels) parentScope.labels.add(label);
                const cursor = parentScope.joined.get(scope) ?? { usage: 0, attempts: 0, usageOmitted: 0, attemptsOmitted: 0 };
                parentScope.usageOmitted += Math.max(0, scope.usageOmitted - cursor.usageOmitted);
                parentScope.attemptsOmitted += Math.max(0, scope.attemptsOmitted - cursor.attemptsOmitted);
                for (const attempt of scope.attempts.values()) {
                    if ((attemptOrder.get(attempt) ?? 0) <= cursor.attempts) continue;
                    if (!parentScope.attempts.has(attempt.invocationId) && parentScope.attempts.size >= MAX_USAGE) {
                        parentScope.attempts.delete(parentScope.attempts.keys().next().value!); parentScope.attemptsOmitted++;
                    }
                    const row = { ...attempt }; attemptOrder.set(row, ++parentScope.serial);
                    parentScope.attempts.set(attempt.invocationId, row);
                }
                for (const usage of scope.usage) {
                    if ((usageOrder.get(usage) ?? 0) <= cursor.usage) continue;
                    if (parentScope.usage.length >= MAX_USAGE) { parentScope.usage.shift(); parentScope.usageOmitted++; }
                    const row = { ...usage }; usageOrder.set(row, ++parentScope.serial); parentScope.usage.push(row);
                    if (usage.estimatedUsd === null) parentScope.unknownCost++; else parentScope.knownCost += usage.estimatedUsd;
                }
                parentScope.joined.set(scope, { usage: scope.serial, attempts: scope.serial, usageOmitted: scope.usageOmitted, attemptsOmitted: scope.attemptsOmitted });
            };
            try {
                const result = context.run({ ...active, scope }, fn);
                if (result && typeof (result as any).then === 'function') return Promise.resolve(result).finally(join) as T;
                join(); return result;
            } catch (error) { join(); throw error; }
        },
        snapshot(now = Date.now()): TaskEvidenceSnapshot {
            const expired = now - scope.created >= DETAIL_TTL_MS;
            const cost = summarizeCost(scope);
            return { version: 1, taskId, labels: [...scope.labels].sort(), calls: expired ? [] : scope.calls.map(row => ({ ...row, labels: [...row.labels] })),
                callsObserved: scope.observed, callsOmitted: scope.observed - (expired ? 0 : scope.calls.length), activeCalls: scope.active,
                attempts: expired ? [] : [...scope.attempts.values()].map(row => ({ ...row })), attemptsOmitted: scope.attemptsOmitted + (expired ? scope.attempts.size : 0),
                usage: expired ? [] : scope.usage.map(row => ({ ...row })), usageOmitted: scope.usageOmitted + (expired ? scope.usage.length : 0),
                estimatedUsd: cost.total, knownEstimatedUsd: cost.known,
                unknownPriceCalls: cost.unknown, detailExpiresAt: scope.created + DETAIL_TTL_MS, expired, capture: 'metadata-only' };
        }
    };
}
/** An unscoped direct tool call gets an ephemeral scope; never a global cross-user lineage. */
export async function withToolEvidence<T>(tool: string, args: unknown, sink: 'local' | 'external' | 'unconfined', source: readonly DataLabel[], fn: () => Promise<T>, exactDisclosureApproved = false): Promise<T> {
    if (!context.getStore()) return createTaskEvidence(randomUUID()).run(() => withToolEvidence(tool, args, sink, source, fn, exactDisclosureApproved));
    const inherited = context.getStore()!, scope = inherited.scope, id = randomUUID(), startedAt = Date.now();
    const input = inspectData(args); addDataLabels(input.labels);
    scope.active++; scope.observed++;
    let outputBytes: number | null = null, outcome: CallEvidence['outcome'] = 'error', errorCode: CallEvidence['errorCode'];
    try {
        assertDataSink(sink, args, exactDisclosureApproved);
        return await context.run({ ...inherited, scope, parent: id }, async () => {
            addDataLabels(source); // Even a partially failed private read must not clear lineage.
            const result = await fn();
            const inspected = inspectData(result); outputBytes = inspected.bytes;
            addDataLabels([...source, ...inspected.labels]);
            // Returned tool errors are not success evidence.
            const own: Record<string, PropertyDescriptor> = result && typeof result === 'object' ? Object.getOwnPropertyDescriptors(result) : {};
            outcome = own.error?.value || own.success?.value === false ? 'error' : 'ok';
            return result;
        });
    } catch (error) { errorCode = error instanceof DataFlowDeniedError ? 'DATA_FLOW_DENIED' : 'TOOL_ERROR'; outcome = errorCode === 'DATA_FLOW_DENIED' ? 'blocked' : 'error'; throw error; }
    finally {
        scope.active--;
        const row: CallEvidence = { id, ...(inherited.parent ? { parentId: inherited.parent } : {}), tool: /^[A-Za-z0-9_.:-]{1,96}$/.test(tool) ? tool : 'unclassified',
            startedAt, durationMs: Date.now() - startedAt, outcome, inputBytes: input.bytes, outputBytes, labels: currentDataLabels(), ...(errorCode ? { errorCode } : {}) };
        if (scope.calls.length === MAX_CALLS) scope.calls.shift();
        scope.calls.push(row);
    }
}
observeUsage(usage => {
    const scope = context.getStore()?.scope;
    if (!scope) return; // Unattributed work is not assigned to the last active user/task.
    const nonnegative = (n: number | null) => n !== null && Number.isFinite(n) && n >= 0 ? n : null;
    // The provider attempt is authoritative for invocation count. Legacy estimator
    // callbacks inside the same attempt enrich one unit in summarizeCost, never add another charge.
    const cost = nonnegative(usage.estimatedUsd);
    const row: UsageObservation = { observationId: randomUUID(),
        ...(usage.invocationId && safeUsageName(usage.invocationId) !== 'unknown' ? { invocationId: usage.invocationId } : {}),
        source: usage.source === 'openai-compatible' ? 'openai-compatible' : 'legacy-estimator',
        model: safeUsageName(usage.model), ...(usage.provider ? { provider: safeUsageName(usage.provider) } : {}),
        inputTokens: nonnegative(usage.inputTokens), outputTokens: nonnegative(usage.outputTokens), estimatedUsd: cost,
        pricing: cost !== null && usage.pricing === 'configured-estimate' ? 'configured-estimate' : 'unknown' };
    if (cost === null) scope.unknownCost++; else scope.knownCost += cost;
    if (scope.usage.length === MAX_USAGE) { scope.usage.shift(); scope.usageOmitted++; }
    usageOrder.set(row, ++scope.serial); scope.usage.push(row);
});

/** Read-time minimization, no mutation/deletion of original memory/task evidence. */
export function minimizeExpiredEvidence(data: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
    const evidence = data.executionEvidence as TaskEvidenceSnapshot | undefined;
    if (!evidence || evidence.version !== 1 || !Number.isFinite(evidence.detailExpiresAt) || now < evidence.detailExpiresAt || evidence.expired) return data;
    return { ...data, executionEvidence: { ...evidence, calls: [], usage: [], attempts: [], attemptsOmitted: (evidence.attemptsOmitted ?? 0) + (evidence.attempts?.length ?? 0), expired: true,
        callsOmitted: evidence.callsObserved, usageOmitted: evidence.usageOmitted + evidence.usage.length } };
}

observeProviderAttempts(attempt => {
    const scope = context.getStore()?.scope;
    if (!scope) return;
    if (safeUsageName(attempt.invocationId) === 'unknown') { scope.attemptsOmitted++; return; }
    if (!scope.attempts.has(attempt.invocationId) && scope.attempts.size >= MAX_USAGE) {
        scope.attempts.delete(scope.attempts.keys().next().value!); scope.attemptsOmitted++;
    }
    // Stable per-invocation upsert, not started+terminal as two charges.
    const count = (n: number | null) => n !== null && Number.isFinite(n) && n >= 0 ? n : null;
    const row: ProviderAttempt = { invocationId: safeUsageName(attempt.invocationId), provider: safeUsageName(attempt.provider), model: safeUsageName(attempt.model),
        outcome: ['started','completed','failed','partial','cancelled'].includes(attempt.outcome) ? attempt.outcome : 'failed',
        inputTokens: count(attempt.inputTokens), outputTokens: count(attempt.outputTokens) };
    attemptOrder.set(row, ++scope.serial); scope.attempts.set(row.invocationId, row);
});

installUsageContext({
    current: () => context.getStore()?.invocationId,
    run: (id, fn) => {
        const active = context.getStore();
        return active ? context.run({ ...active, invocationId: id }, fn) : fn();
    },
    guard: payload => {
        // Configured model processing is expected for ordinary user prompts and private
        // tasks. Never send credentials/unknown opaque objects, regardless of consent.
        const inspected = inspectData(payload); addDataLabels(inspected.labels);
        if (inspected.labels.includes('SECRET') || currentDataLabels().includes('SECRET')) throw new DataFlowDeniedError();
    }
});
