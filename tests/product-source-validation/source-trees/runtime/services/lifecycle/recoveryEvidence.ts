import type { Failure, ResourceEvidence } from './host';

/** Private retained side evidence. Not an aggregate policy or service-wide
 * recovery switch. The owning core supplies actual owned resource IDs.
 */
export type RecoveryObligation = Readonly<{ id: number }>;
export type AttemptRecord = Readonly<{
    id: number; failure: Readonly<Pick<Failure, 'id' | 'revision' | 'source'>>; acquiredResourceIds: readonly number[];
}>;
export type FulfillmentRecord = Readonly<{
    id: number; attemptIds: readonly number[]; originalResult: unknown;
    inputEquivalence: 'UNVERIFIED' | 'GRAPH_DRIVER_INPUTS_EQUAL';
}>;
export type RecoveryObservation = Readonly<{
    id: number; source: string; attempts: readonly AttemptRecord[];
    fulfillment?: FulfillmentRecord;
    resources: readonly ResourceEvidence[];
    verdict: 'NOT_CERTIFIED';
}>;
type RecordState = {
    source: string; operation: object; inputIdentity: object; live: boolean;
    attempts: AttemptRecord[]; fulfillment?: FulfillmentRecord;
};
export class RecoveryEvidence {
    private records = new Map<RecoveryObligation, RecordState>();
    private nextId = 0;
    private retainedAttempts = 0;
    constructor(private readonly capacity: number) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Explicit recovery evidence capacity required');
    }
    reserve(operation: object, source: string, inputIdentity: object): RecoveryObligation {
        if (this.records.size >= this.capacity) throw new Error('Recovery evidence capacity exhausted');
        const token = Object.freeze({ id: ++this.nextId });
        this.records.set(token, { source, operation, inputIdentity, live: true, attempts: [] });
        return token;
    }
    failed(token: RecoveryObligation, operation: object, inputIdentity: object,
        failure: Failure, acquiredResourceIds: readonly number[]): void {
        const state = this.exact(token, operation, inputIdentity);
        if (!state.live) throw new Error('Recovery obligation already finalized');
        if (this.retainedAttempts >= this.capacity) throw new Error('Recovery attempt capacity exhausted');
        this.retainedAttempts++;
        // Keep immutable history links, not an extra original-Error reference
        // that would survive the host's exact acknowledgement/capacity release.
        state.attempts.push(Object.freeze({ id: ++this.nextId,
            failure: Object.freeze({ id: failure.id, revision: failure.revision, source: failure.source }),
            acquiredResourceIds: Object.freeze([...acquiredResourceIds]) }));
    }
    fulfilled(token: RecoveryObligation, operation: object, inputIdentity: object, originalResult: unknown,
        inputEquivalence: 'UNVERIFIED' | 'GRAPH_DRIVER_INPUTS_EQUAL'): void {
        const state = this.exact(token, operation, inputIdentity);
        if (!state.live) throw new Error('Recovery obligation already finalized');
        state.live = false;
        // Identity alone does NOT certify credential/environment equivalence.
        // The exact per-callsite input comparison remains a required source step.
        state.fulfillment = Object.freeze({ id: ++this.nextId,
            attemptIds: Object.freeze(state.attempts.map(attempt => attempt.id)),
            originalResult, inputEquivalence });
    }
    failedTerminal(token: RecoveryObligation, operation: object, inputIdentity: object): void {
        const state = this.exact(token, operation, inputIdentity);
        if (!state.live) throw new Error('Recovery obligation already finalized');
        state.live = false;
    }
    observe(releases: readonly ResourceEvidence[]): readonly RecoveryObservation[] {
        return Object.freeze([...this.records].map(([token, state]) => {
            const ownedIds = new Set(state.attempts.flatMap(attempt => [...attempt.acquiredResourceIds]));
            return Object.freeze({ id: token.id, source: state.source,
                attempts: Object.freeze([...state.attempts]), fulfillment: state.fulfillment,
                resources: Object.freeze(releases.filter(release => release.resourceId !== undefined && ownedIds.has(release.resourceId))),
                verdict: 'NOT_CERTIFIED' as const });
        }));
    }
    private exact(token: RecoveryObligation, operation: object, inputIdentity: object): RecordState {
        const state = this.records.get(token);
        if (!state || state.operation !== operation || state.inputIdentity !== inputIdentity) throw new Error('Foreign recovery obligation/operation/inputs');
        return state;
    }
}
