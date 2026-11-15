import { installPreparationHost } from '../../services/lifecycle/bootstrapAuthority';
import type { Capacity } from '../../services/lifecycle/host';

/** Explicit launcher handoff, not default capacities, inherited credentials or
 * provider authority. Read only the fixed reviewed non-secret process inputs.
 */
export function standaloneFixturePreparationInputs(): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const name of ['SILHOUETTE_OWNER_SCOPES', 'SILHOUETTE_OWNER_ACTIVE',
        'SILHOUETTE_OWNER_FAILURES', 'SILHOUETTE_OWNER_RESOURCES']) {
        const value = process.env[name];
        if (value === undefined || !/^[1-9][0-9]{0,15}$/.test(value)
            || !Number.isSafeInteger(Number(value))) throw new Error('Missing valid explicit fixture capacity: ' + name);
        inputs[name] = value;
    }
    for (const name of ['GOMAXPROCS', 'TOKIO_WORKER_THREADS', 'LANCE_CPU_THREADS', 'RAYON_NUM_THREADS']) {
        const value = process.env[name];
        if (value === undefined) continue;
        if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value)))
            throw new Error('Invalid explicit fixture preparation input: ' + name);
        inputs[name] = value;
    }
    return inputs;
}

/** Called by original child BEFORE dynamic application imports. Owns a real
 * host, not a Vitest mock/realm. Does not install app root or relax global unknown.
 * The original immediate-exit/restart probes stay abrupt and are NOT quiescence
 * acceptance. This bootstrap alone supplies no close/stop/PASS disposition.
 */
export function bootstrapStandaloneFixture() {
    const inputs = standaloneFixturePreparationInputs();
    const capacity: Capacity = { scopes: Number(inputs.SILHOUETTE_OWNER_SCOPES),
        active: Number(inputs.SILHOUETTE_OWNER_ACTIVE), failures: Number(inputs.SILHOUETTE_OWNER_FAILURES),
        resources: Number(inputs.SILHOUETTE_OWNER_RESOURCES) };
    return installPreparationHost(capacity);
}
