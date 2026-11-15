import { getPublishedNarrative } from '../../services/narrativeInstanceOwner';
export function captureStartedNarrative() { return getPublishedNarrative(); }
export type NarrativeCapture = ReturnType<typeof captureStartedNarrative>;
export async function observeNarrative(owner: NarrativeCapture): Promise<void> {
    if (!owner) {
        console.log('ACTUAL_NARRATIVE_INCOMPLETE_NOT_OBSERVED');
        throw new Error('Narrative not observed in actual path');
    }
    const before = owner.getLifecycleStatus();
    const stop = owner.stopAdmissions();
    const immediate = owner.getLifecycleStatus();
    const sameStopOwner = stop === owner.stopAdmissions();
    let failure: { error: unknown } | undefined;
    try { await stop; } catch (error) { failure = { error }; }
    const settled = owner.getLifecycleStatus();
    console.log('ACTUAL_NARRATIVE_OWNER:', { before, immediate, settled, sameStopOwner,
        stopOutcome: failure ? 'FAILED_OR_INCOMPLETE' : 'LOCAL_ACCEPTED_WORK_SETTLED',
        scope: 'local instance only; queued RAM not delivered/durable, no upstream/WAL/global drain' });
    if (failure) throw failure.error;
    if (!sameStopOwner || immediate.admissionOpen || immediate.timerPresent || immediate.subscriptions
        || settled.pendingOwners || settled.queuedPresentation || settled.admissionOpen || settled.timerPresent
        || settled.subscriptions || settled.historicalFailures || settled.countOverflow || settled.failureOverflow) {
        throw new Error('Retained Narrative stop invariant failed');
    }
}
