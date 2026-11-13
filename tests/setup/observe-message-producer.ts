import { getPublishedMessageProducer } from '../../services/messageProducerOwner';
export function captureStartedMessageProducer() { return getPublishedMessageProducer(); }
export type MessageProducerCapture = ReturnType<typeof captureStartedMessageProducer>;
export async function observeMessageProducer(owner: MessageProducerCapture): Promise<void> {
    if (!owner) {
        console.log('ACTUAL_MESSAGE_PRODUCER_INCOMPLETE_NOT_OBSERVED');
        throw new Error('Message producer not observed in actual path');
    }
    const before = owner.getUserMessageProducerStatus();
    const stop = owner.stopUserMessageAdmissions();
    const immediate = owner.getUserMessageProducerStatus();
    const sameStopOwner = stop === owner.stopUserMessageAdmissions();
    // Never log/inspect a rejected throw. Status carries safe copied summaries only.
    let rejected = false;
    let receipt: Awaited<ReturnType<typeof owner.stopUserMessageAdmissions>> | undefined;
    try { receipt = await stop; } catch { rejected = true; }
    const settled = owner.getUserMessageProducerStatus();
    console.log('ACTUAL_MESSAGE_PRODUCER_OWNER:', { before, immediate, settled, receipt,
        sameStopOwner, rejected,
        scope: 'actual instance message-body join only; no detached/Telegram/other-listener/WAL-global drain' });
    const complete = (value: typeof settled | undefined) => !!value &&
        value.admissionOpen === false && value.pendingOwners === 0 &&
        value.localJoin === 'LOCAL_MESSAGE_PRODUCERS_SETTLED' &&
        value.semanticStatus === 'NO_LOCAL_MESSAGE_FAILURE_RECORDED' && !value.overflow &&
        value.counts.failures === 0 && value.failureSampleSize === 0 &&
        Object.values(value.failureStageCounts).every(count => count === 0) &&
        value.counts.readOnlyPending === 0 && value.counts.otherPending === 0 &&
        value.counts.notStarted === 0 && value.counts.receiptMissing === 0 && value.counts.commitFailed === 0;
    if (rejected || !sameStopOwner || immediate.admissionOpen || !complete(receipt) || !complete(settled)) {
        throw new Error('Actual message producer failed or incomplete; pending WAL preserved');
    }
}
