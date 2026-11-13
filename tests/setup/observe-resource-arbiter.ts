import { getPublishedResourceArbiter } from '../../services/resourceArbiterOwner';
export function captureStartedResourceArbiter() { return getPublishedResourceArbiter(); }
export type ArbiterCapture = ReturnType<typeof captureStartedResourceArbiter>;
/** Retained actual reference only. NO imports/application startup from teardown. */
export async function observeResourceArbiter(owner: ArbiterCapture): Promise<void> {
    if (!owner) {
        console.log('ACTUAL_RESOURCE_ARBITER_INCOMPLETE_NOT_OBSERVED');
        throw new Error('Resource arbiter not observed in actual path');
    }
    const before = owner.getLifecycleStatus();
    const stop = owner.stopAdmissions();
    const immediate = owner.getLifecycleStatus();
    const sameStopOwner = stop === owner.stopAdmissions();
    let error: { value: unknown } | undefined;
    try { await stop; } catch (value) { error = { value }; }
    const settled = owner.getLifecycleStatus();
    console.log('ACTUAL_RESOURCE_ARBITER_OWNER:', { before, immediate, settled,
        sameStopOwner, stopOutcome: error ? 'REJECTED' : 'FULFILLED',
        scope: 'retained arbiter startup/admission/metric/queue checks only; not downstream tasks or Narrative/WAL drain' });
    if (error) throw error.value;
    if (!sameStopOwner || immediate.admissionOpen || immediate.timerPresent || immediate.queued
        || settled.admissionOpen || settled.timerPresent || settled.queued || settled.pendingChecks || settled.historicalFailures) {
        throw new Error('Actual retained resource arbiter stop invariant failed');
    }
}
