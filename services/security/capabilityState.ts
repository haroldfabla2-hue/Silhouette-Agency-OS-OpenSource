/**
 * Explicit capability states. Nothing that is not backed by a real provider may
 * report success as if it were real.
 *
 *  REAL        backed by a real provider/effect, verified
 *  DEMO        explicit demo mode (SILHOUETTE_DEMO_MODE=1), output is labelled and not real
 *  UNAVAILABLE no real provider configured, nothing was attempted
 *  FAILED      attempted against a provider and it failed
 */
export type CapabilityState = 'REAL' | 'DEMO' | 'UNAVAILABLE' | 'FAILED';

/** Demo mode must be turned on explicitly. Default is OFF. */
export function isDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const v = (env.SILHOUETTE_DEMO_MODE || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

export interface CapabilityReport {
    state: CapabilityState;
    reason?: string;
}

export function demoOrUnavailable(capability: string, env: NodeJS.ProcessEnv = process.env): CapabilityReport {
    return isDemoModeEnabled(env)
        ? { state: 'DEMO', reason: `${capability} is running in explicit DEMO mode: output is NOT real` }
        : { state: 'UNAVAILABLE', reason: `${capability} has no real provider configured. Set one up, or enable SILHOUETTE_DEMO_MODE=1 for a clearly labelled demo.` };
}
