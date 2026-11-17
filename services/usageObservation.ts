/** Browser-safe transport for observed usage. No prompts, completions or credentials. */
export interface UsageObservation {
    observationId?: string;
    invocationId?: string;
    source: 'legacy-estimator' | 'openai-compatible';
    model: string;
    provider?: string;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedUsd: number | null;
    pricing: 'configured-estimate' | 'unknown';
}
const observers = new Set<(usage: UsageObservation) => void>();
export function observeUsage(observer: (usage: UsageObservation) => void): () => void {
    observers.add(observer);
    return () => { observers.delete(observer); };
}
export function emitUsage(usage: UsageObservation): void {
    // Observability must not turn a completed provider call into an automatic retry.
    const observed = { ...usage, observationId: usage.observationId ?? crypto.randomUUID() };
    for (const observer of observers) { try { observer(observed); } catch { /* no payload logging */ } }
}

export interface ProviderAttempt {
    invocationId: string; provider: string; model: string;
    outcome: 'started' | 'completed' | 'failed' | 'partial' | 'cancelled';
    inputTokens: number | null; outputTokens: number | null;
}
const attemptObservers = new Set<(attempt: ProviderAttempt) => void>();
export function observeProviderAttempts(observer: (attempt: ProviderAttempt) => void): () => void {
    attemptObservers.add(observer); return () => { attemptObservers.delete(observer); };
}
export function emitProviderAttempt(attempt: ProviderAttempt): void {
    for (const observer of attemptObservers) { try { observer(attempt); } catch { /* no payload */ } }
}

// Dependency-neutral boundary hooks. Server task context installs them, browser use
// remains valid without importing node:async_hooks into frontend code.
let boundaryGuard: ((payload: unknown) => void) | undefined;
let invocationRunner: (<T>(id: string, fn: () => T) => T) | undefined;
let invocationReader: (() => string | undefined) | undefined;
export function installUsageContext(hooks: { guard: (payload: unknown) => void; run: <T>(id: string, fn: () => T) => T; current: () => string | undefined }): void {
    boundaryGuard = hooks.guard; invocationRunner = hooks.run; invocationReader = hooks.current;
}
/** Descriptor-only bounded JSON snapshot. Accessors/toJSON/functions/cycles and
 * opaque prototypes are unsupported, never serialized by caller-controlled code. */
export function safePayloadJson(payload: unknown): string {
    let nodes = 0, bytes = 0; const seen = new WeakSet<object>();
    const denied = (): never => { throw Object.assign(new Error('DATA_FLOW_DENIED: unsafe payload shape'), { code: 'DATA_FLOW_DENIED' }); };
    const copy = (value: unknown, depth: number): unknown => {
        if (++nodes > 4096 || depth > 16) return denied();
        if (typeof value === 'string') { bytes += value.length; if (bytes > 1_048_576) return denied(); return value; }
        if (value === undefined || value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') { if (!Number.isFinite(value)) return denied(); return value; }
        if (typeof value !== 'object' || seen.has(value)) return denied();
        if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return denied();
        seen.add(value);
        const output: any = Array.isArray(value) ? [] : Object.create(null);
        for (const key of Reflect.ownKeys(value)) {
            if (Array.isArray(value) && key === 'length') continue;
            if (typeof key !== 'string') return denied();
            bytes += key.length; if (bytes > 1_048_576) return denied();
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (!('value' in descriptor)) return denied();
            Object.defineProperty(output, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
        }
        seen.delete(value); return output;
    };
    return JSON.stringify(copy(payload, 0)) ?? denied();
}
export function assertSafePayloadShape(payload: unknown): void { safePayloadJson(payload); }
export function assertModelPayload(payload: unknown): void {
    const serialized = safePayloadJson(payload);
    boundaryGuard?.(payload);
    if (serialized.length > 1_048_576 ||
        /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|(?:api[_-]?key|password|authorization|access[_-]?token)[\s"']*[:=][\s"']*[^\s"',}]+|\bBearer\s+\S+)/i.test(serialized)) {
        throw Object.assign(new Error('DATA_FLOW_DENIED: credential-like model payload'), { code: 'DATA_FLOW_DENIED' });
    }
}
export function currentProviderInvocation(): string | undefined { return invocationReader?.(); }
export function runProviderInvocation<T>(id: string, fn: () => T): T { return invocationRunner ? invocationRunner(id, fn) : fn(); }
