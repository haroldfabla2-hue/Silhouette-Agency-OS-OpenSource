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
        if (!state) return true; // Assume healthy if unknown

        if (state.status === 'HEALTHY') return true;

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

        state.status = 'HEALTHY';
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
        if (!state || state.status === 'HEALTHY') return 0;
        return Math.max(0, state.suspendedUntil - Date.now());
    }

    private getOrInitState(providerId: string): ProviderState {
        if (!this.states.has(providerId)) {
            this.resetProvider(providerId);
        }
        return this.states.get(providerId)!;
    }

    private resetProvider(providerId: string) {
        this.states.set(providerId, {
            name: providerId,
            status: 'HEALTHY',
            consecutiveFailures: 0,
            suspendedUntil: 0
        });
    }

    /**
     * Returns a snapshot of all provider health states.
     * Includes dynamic check for Ollama.
     */
    public async getEnrichedHealthStats(): Promise<Record<string, ProviderState>> {
        const stats = Object.fromEntries(this.states);

        // Dynamic Check: Ollama
        try {
            const { ollamaService } = await import('./ollamaService');
            const isOllamaUp = await ollamaService.isAvailable();
            stats['ollama'] = {
                name: 'Ollama (Local)',
                status: isOllamaUp ? 'HEALTHY' : 'SUSPENDED',
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
