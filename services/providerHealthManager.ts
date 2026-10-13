import { continuum } from "./continuumMemory";
import { ProviderState } from "../types"; // Import shared type

const TIER_1_BACKOFF = 15 * 60 * 1000; // 15 mins
const TIER_2_BACKOFF = 6 * 60 * 60 * 1000; // 6 hours
const TIER_3_BACKOFF = 24 * 60 * 60 * 1000; // 24 hours

export class ProviderHealthManager {
    private static instance: ProviderHealthManager;
    private states: Map<string, ProviderState> = new Map();

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
    public reportFailure(providerId: string, errorMsg: string) {
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
        continuum.store(
            `[CIRCUIT BREAKER] ${providerId} suspended for ${tierLabel}. Reason: ${errorMsg}`,
            undefined,
            ['system-health', 'api-quota', providerId]
        );

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
