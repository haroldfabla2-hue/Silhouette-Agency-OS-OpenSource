/** Pure explicit bootstrap for the two original standalone telephony fixtures.
 * No Vitest realm, hidden fallback capacity, providers or application imports.
 */
import { installPreparationHost } from '../../services/lifecycle/bootstrapAuthority';
import { drainEvaluatedRuntimeProducers, closeEvaluatedRuntimeStorage } from '../../services/lifecycle/runtimeStopBindings';
import type { Capacity } from '../../services/lifecycle/host';

export function createStandaloneFixtureHost() {
    const required = (name: string): number => {
        const value = Number(process.env[name]);
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('Missing explicit fixture preparation capacity: ' + name);
        return value;
    };
    const capacity: Capacity = {
        scopes: required('SILHOUETTE_OWNER_SCOPES'), active: required('SILHOUETTE_OWNER_ACTIVE'),
        failures: required('SILHOUETTE_OWNER_FAILURES'), resources: required('SILHOUETTE_OWNER_RESOURCES')
    };
    const host = installPreparationHost(capacity);
    let producers: Promise<void> | undefined;
    let stopped: Promise<void> | undefined;
    const drainProducers = () => {
        if (!producers) {
            producers = drainEvaluatedRuntimeProducers();
            void producers.catch(() => undefined); // retain exact rejection
        }
        return producers;
    };
    const stop = () => {
        if (stopped) return stopped;
        stopped = (async () => {
            const errors: unknown[] = [];
            // Original producer join before fixture-owned storage close, with
            // independent storage/host cleanup still attempted on a failure.
            try { await drainProducers(); } catch (error) { errors.push(error); }
            try { await closeEvaluatedRuntimeStorage(); } catch (error) { errors.push(error); }
            const report = await host.stop();
            console.log('STANDALONE_PREPARATION_REPORT', JSON.stringify({
                state: report.state, pending: report.pending, coverage: report.coverage,
                capacity: report.capacity, highWater: report.highWater,
                lifetimeFailures: report.lifetimeFailures, ownerFailures: report.ownerFailures,
                taskOutcomeFailures: report.taskOutcomeFailures
            }));
            // INCOMPLETE global coverage is not converted to COMPLETE. Like
            // original Vitest setup, any recorded lifetime failure rejects.
            if (report.pending || report.lifetimeFailures) errors.push(new Error('Original standalone preparation work remained pending or failed'));
            if (errors.length) throw new AggregateError(errors, 'Original standalone preparation shutdown failed');
        })();
        void stopped.catch(() => undefined);
        return stopped;
    };
    return { drainProducers, stop };
}
