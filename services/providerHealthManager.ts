import { continuum, type MemoryEffectReceipt } from "./continuumMemory";
import { ProviderState } from "../types"; // Import shared type

export interface ProviderPersistenceOutcome {
    operationId: string;
    providerId: string;
    state: 'NOT_ADMITTED' | 'CANONICAL_FAILED_PARTIAL_POSSIBLE' | 'STORE_RETURNED_UNCONFIRMED' | 'EFFECTS_COMPLETE' | 'EFFECTS_FAILED' | 'OBSERVATION_FAILED';
    canonical: 'NOT_ATTEMPTED' | 'UNKNOWN_PARTIAL_POSSIBLE' | 'RETURNED_NOT_A_RECEIPT';
    error?: string;
    effects?: MemoryEffectReceipt;
}
export interface ProviderPersistenceOperation {
    readonly operationId: string;
    readonly admitted: boolean;
    readonly completion: Promise<ProviderPersistenceOutcome>;
}
interface PersistenceRecord {
    providerId: string;
    operation: ProviderPersistenceOperation;
    observer?: string;
    outcome?: ProviderPersistenceOutcome;
}

const TIER_1_BACKOFF = 15 * 60 * 1000; // 15 mins
const TIER_2_BACKOFF = 6 * 60 * 60 * 1000; // 6 hours
const TIER_3_BACKOFF = 24 * 60 * 60 * 1000; // 24 hours

export class ProviderHealthManager {
    private static instance: ProviderHealthManager;
    private states: Map<string, ProviderState> = new Map();

    // Manager owns accepted persistence independently of the LLM/fallback stack.
    // Pending and terminal non-success records share one bounded admission budget.
    private readonly persistenceLimit = 128;
    private readonly persistence = new Map<string, PersistenceRecord>();
    private readonly issuedOperations = new WeakSet<ProviderPersistenceOperation>();
    private notAdmittedCount = 0;

    public getPersistenceStatus() {
        return { limit: this.persistenceLimit, notAdmittedCount: this.notAdmittedCount,
            operations: Array.from(this.persistence, ([operationId, record]) => ({
                operationId, providerId: record.providerId, observer: record.observer,
                state: record.outcome?.state ?? 'PENDING',
                outcome: record.outcome ? structuredClone(record.outcome) : undefined
            })) };
    }

    /** Snapshot of currently accepted operations only, not a global/future-admission drain. */
    public settlePersistence(): Promise<ProviderPersistenceOutcome[]> {
        return Promise.all(Array.from(this.persistence.values(), record => record.operation.completion));
    }

    /** Synchronous handoff to this bounded owner, never await memory from an LLM fallback.
     * A failed/unconfirmed outcome remains retained for a real diagnostic consumer.
     * This records observation responsibility, not successful persistence or acknowledgement. */
    public observePersistence(operation: ProviderPersistenceOperation, observer: string): boolean {
        if (!this.issuedOperations.has(operation) || !observer || observer.length > 128) return false;
        if (!operation.admitted) return true; // NOT_ADMITTED counted, no canonical attempt.
        const record = this.persistence.get(operation.operationId);
        if (!record || record.operation !== operation || (record.observer && record.observer !== observer)) return false;
        record.observer = observer;
        if (record.outcome?.state === 'EFFECTS_COMPLETE') this.persistence.delete(operation.operationId);
        return true;
    }

    /** Acknowledges this retained diagnostic only. No retry, repair or Continuum ack.
     * Separate Continuum effect failures stay retained until their own exact ack.
     * Call only after the consumer has handled that partial/unconfirmed outcome. */
    public acknowledgePersistenceFailure(operationId: string, expected: ProviderPersistenceOutcome): boolean {
        const record = this.persistence.get(operationId);
        if (!record?.outcome || record.outcome.state === 'EFFECTS_COMPLETE'
            || JSON.stringify(record.outcome) !== JSON.stringify(expected)) return false;
        this.persistence.delete(operationId);
        return true;
    }

    private ownPersistence(providerId: string, content: string): ProviderPersistenceOperation {
        const operationId = crypto.randomUUID();
        if (this.persistence.size >= this.persistenceLimit) {
            this.notAdmittedCount = Math.min(Number.MAX_SAFE_INTEGER, this.notAdmittedCount + 1);
            const outcome: ProviderPersistenceOutcome = { operationId, providerId,
                state: 'NOT_ADMITTED', canonical: 'NOT_ATTEMPTED' };
            const operation = { operationId, admitted: false, completion: Promise.resolve(outcome) };
            this.issuedOperations.add(operation);
            console.error('[CIRCUIT BREAKER] Health persistence not admitted:', outcome);
            return operation;
        }
        // Promise.resolve().then defers the real store until after the record is reserved.
        // Immediate rejection handler belongs to the manager, not the fallback caller.
        const completion: Promise<ProviderPersistenceOutcome> = Promise.resolve().then(async (): Promise<ProviderPersistenceOutcome> => {
            let storeReturned = false;
            try {
                const stored = await continuum.storeWithEffectReceipt(content, undefined,
                    ['system-health', 'api-quota', providerId]);
                storeReturned = true;
                if (!stored.effects) return { operationId, providerId,
                    state: 'STORE_RETURNED_UNCONFIRMED', canonical: 'RETURNED_NOT_A_RECEIPT' };
                const effects = await stored.effects.completion;
                return { operationId, providerId,
                    state: effects.state === 'COMPLETE' ? 'EFFECTS_COMPLETE' : 'EFFECTS_FAILED',
                    canonical: 'RETURNED_NOT_A_RECEIPT', effects };
            } catch (error) {
                // A thrown canonical call may already have changed disk/RAM/other tiers.
                return { operationId, providerId, state: storeReturned ? 'OBSERVATION_FAILED' : 'CANONICAL_FAILED_PARTIAL_POSSIBLE',
                    canonical: storeReturned ? 'RETURNED_NOT_A_RECEIPT' : 'UNKNOWN_PARTIAL_POSSIBLE', error: error instanceof Error ? error.message : String(error) };
            }
        }).then(outcome => {
            const record = this.persistence.get(operationId);
            if (!record) throw new Error('Missing accepted provider persistence owner');
            record.outcome = structuredClone(outcome);
            if (outcome.state === 'EFFECTS_COMPLETE' && record.observer) this.persistence.delete(operationId);
            else if (outcome.state !== 'EFFECTS_COMPLETE') console.error('[CIRCUIT BREAKER] Health persistence unresolved:', outcome);
            return outcome;
        }).catch(error => {
            const outcome: ProviderPersistenceOutcome = { operationId, providerId,
                state: 'OBSERVATION_FAILED', canonical: 'UNKNOWN_PARTIAL_POSSIBLE',
                error: error instanceof Error ? error.message : String(error) };
            const record = this.persistence.get(operationId);
            if (record) record.outcome = structuredClone(outcome);
            return outcome;
        });
        const operation: ProviderPersistenceOperation = { operationId, admitted: true, completion };
        this.issuedOperations.add(operation);
        this.persistence.set(operationId, { providerId, operation });
        return operation;
    }

    private constructor() {
        // Initialize known providers (optional, logic handles new ones dynamically)
        this.resetProvider('gemini');
        this.resetProvider('openrouter');
        this.resetProvider('groq');

        // Initialize Local/Other Services
        this.resetProvider('elevenlabs');
        this.resetProvider('coqui_tts');
        this.resetProvider('local_video_queue');
    }

    public static getInstance(): ProviderHealthManager {
        if (!ProviderHealthManager.instance) {
            ProviderHealthManager.instance = new ProviderHealthManager();
        }
        return ProviderHealthManager.instance;
    }

    /**
     * Checks if a provider is healthy enough to be called.
     * Returns TRUE if available, FALSE if currently suspended.
     */
    public isAvailable(providerId: string): boolean {
        const state = this.states.get(providerId);
        if (!state) return true; // Closed circuit by default: unknown providers may be tried (status reports UNKNOWN, never HEALTHY)

        if (state.status !== 'SUSPENDED') return true;

        // If suspended, check if time has passed
        if (Date.now() >= state.suspendedUntil) {
            console.log(`[CIRCUIT BREAKER] 🟢 Probation: Re-enabling ${providerId} after suspension.`);
            // We don't reset failures yet; we verify strict success first.
            // But strict 'status' flips to healthy to allow ONE try.
            return true;
        }

        return false;
    }

    /**
     * Reports a successful API call.
     * Resets the failure counter and clears suspension.
     */
    public reportSuccess(providerId: string) {
        const state = this.getOrInitState(providerId);

        if (state.consecutiveFailures > 0) {
            console.log(`[CIRCUIT BREAKER] ✅ ${providerId} recovered! Resetting failure count (was ${state.consecutiveFailures}).`);
        }

        state.status = 'VERIFIED'; // a real call succeeded: measured, not assumed
        state.consecutiveFailures = 0;
        state.suspendedUntil = 0;
        state.lastError = undefined;
    }

    /**
     * Reports a failed API call (specifically for Quota/Capacity issues).
     * Calculates the new suspension time based on tiered logic.
     */
    public reportFailure(providerId: string, errorMsg: string): ProviderPersistenceOperation {
        const state = this.getOrInitState(providerId);
        state.consecutiveFailures++;
        state.lastError = errorMsg;
        state.status = 'SUSPENDED';

        let backoffDuration = 0;
        let tierLabel = "";

        // Tiered Logic
        if (state.consecutiveFailures <= 3) {
            backoffDuration = TIER_1_BACKOFF;
            tierLabel = "15 Minutes (Tier 1)";
        } else if (state.consecutiveFailures <= 6) {
            backoffDuration = TIER_2_BACKOFF;
            tierLabel = "6 Hours (Tier 2)";
        } else {
            backoffDuration = TIER_3_BACKOFF;
            tierLabel = "24 Hours (Tier 3)";
        }

        state.suspendedUntil = Date.now() + backoffDuration;

        const dateStr = new Date(state.suspendedUntil).toLocaleTimeString();
        console.warn(`[CIRCUIT BREAKER] ⛔ Suspending ${providerId} for ${tierLabel}. Next retry: ${dateStr}. Failures: ${state.consecutiveFailures}`);

        // Persist this vital health event to memory
        return this.ownPersistence(providerId,
            `[CIRCUIT BREAKER] ${providerId} suspended for ${tierLabel}. Reason: ${errorMsg}`);

    }

    /**
     * Explicitly suspends a provider for a specific duration (e.g., for 429 Rate Limits).
     */
    public suspendProvider(providerId: string, durationMs: number, reason: string) {
        const state = this.getOrInitState(providerId);
        state.status = 'SUSPENDED';
        state.lastError = reason;
        state.suspendedUntil = Date.now() + durationMs;
        // We do NOT increment consecutiveFailures here to avoid triggering higher tiers for a temporary rate limit

        const dateStr = new Date(state.suspendedUntil).toLocaleTimeString();
        console.warn(`[CIRCUIT BREAKER] ⏳ Rate Limit: Suspending ${providerId} for ${(durationMs / 60000).toFixed(0)} mins. Resumes at: ${dateStr}.`);
    }

    public getBackoffTime(providerId: string): number {
        const state = this.states.get(providerId);
        if (!state || state.status !== 'SUSPENDED') return 0;
        return Math.max(0, state.suspendedUntil - Date.now());
    }

    private getOrInitState(providerId: string): ProviderState {
        if (!this.states.has(providerId)) {
            this.resetProvider(providerId);
        }
        return this.states.get(providerId)!;
    }

    private resetProvider(providerId: string) {
        // [R9] never measured = UNKNOWN. HEALTHY-by-default was the lie.
        this.states.set(providerId, {
            name: providerId,
            status: 'UNKNOWN',
            consecutiveFailures: 0,
            suspendedUntil: 0
        });
    }

    /** Env vars that configure each legacy provider (verified against the services). */
    private static readonly LEGACY_KEY_ENVS: Record<string, string[]> = {
        gemini: ['GEMINI_API_KEY', 'API_KEY'],
        deepseek: ['DEEPSEEK_API_KEY'],
        minimax: ['MINIMAX_API_KEY'],
        zhipuai: ['ZHIPUAI_API_KEY', 'ZHIPU_API_KEY'],
        groq: ['GROQ_API_KEY'],
        openrouter: ['OPENROUTER_API_KEY'],
        nvidia: ['NVIDIA_API_KEY']
    };

    /**
     * Returns an honest snapshot of provider states, built from the gateway
     * catalog: NOT_CONFIGURED (no credentials), SUSPENDED (circuit open),
     * VERIFIED (a real call succeeded this process), REACHABLE (probe ok),
     * UNKNOWN (never measured). No provider is ever reported healthy by default.
     */
    public async getEnrichedHealthStats(): Promise<Record<string, ProviderState>> {
        const stats: Record<string, ProviderState> = Object.fromEntries(this.states);

        // Catalog from the gateway registry: every known provider appears,
        // each with its real configuration state.
        try {
            const { ProviderRegistry } = await import('./llm/providerRegistry');
            const registry = ProviderRegistry.fromEnvironment();
            for (const def of registry.list()) {
                const id = def.id.toLowerCase();
                const existing = this.states.get(id);
                if (existing?.status === 'SUSPENDED' || existing?.status === 'VERIFIED') {
                    stats[id] = existing; // measured states win
                    continue;
                }
                const keyEnvs = def.apiKeyEnv ? [def.apiKeyEnv] : ProviderHealthManager.LEGACY_KEY_ENVS[id] || [];
                const configured = keyEnvs.length === 0 /* local, no key needed */ || keyEnvs.some(e => !!process.env[e]);
                if (!configured) {
                    stats[id] = {
                        name: def.id, status: 'NOT_CONFIGURED',
                        consecutiveFailures: 0, suspendedUntil: 0,
                        lastError: `Missing credentials (${keyEnvs.join(' or ')})`
                    };
                } else if (!existing) {
                    stats[id] = { name: def.id, status: 'UNKNOWN', consecutiveFailures: 0, suspendedUntil: 0 };
                }
            }
        } catch (e) {
            console.warn('[CIRCUIT BREAKER] provider catalog unavailable:', (e as any)?.message);
        }

        // Dynamic Check: Ollama (local, probe = reachability, not a real inference)
        try {
            const { ollamaService } = await import('./ollamaService');
            const isOllamaUp = await ollamaService.isAvailable();
            const existing = this.states.get('ollama');
            stats['ollama'] = existing?.status === 'VERIFIED' ? existing : {
                name: 'Ollama (Local)',
                status: isOllamaUp ? 'REACHABLE' : 'SUSPENDED',
                consecutiveFailures: isOllamaUp ? 0 : 1,
                suspendedUntil: 0,
                lastError: isOllamaUp ? undefined : 'Service Unreachable'
            };
        } catch (e) {
            // Keep silent if ollama fails to import
        }

        return stats;
    }

    public getHealthStats(): Record<string, ProviderState> {
        return Object.fromEntries(this.states);
    }
}

export const providerHealth = ProviderHealthManager.getInstance();
