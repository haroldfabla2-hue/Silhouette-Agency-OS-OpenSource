// Shared safety view over actual registered-owner receipts. No producer imports.
export type ProducerSafetyReceipts = {
    narrative?: { stopFailed: boolean; error: string | null; remainingItems: number; workStillOwned: boolean };
    arbiter?: { stopFailed: boolean; boundExhausted: boolean };
    // Discriminated union: a clean stop MUST carry the validated timer fact; a
    // failed stop MAY omit it. Absence stays absence, never a fabricated false.
    power?:
        | { stopFailed: false; intervalWasArmed: boolean }
        | { stopFailed: true; intervalWasArmed?: boolean };
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export function readProducerSafetyReceipts(value: unknown): ProducerSafetyReceipts {
    if (!record(value) || Object.keys(value).some(key => !['narrative', 'arbiter', 'power'].includes(key))) throw new Error('PRODUCER_RECEIPTS_INVALID');
    const out: ProducerSafetyReceipts = {};
    if ('narrative' in value) {
        const n = value.narrative;
        if (!record(n)) throw new Error('NARRATIVE_RECEIPT_INVALID');
        if (n.stopFailed === true) out.narrative = { stopFailed: true, error: 'stop-failed', remainingItems: 0, workStillOwned: true };
        else {
            // Narrow through locals: indexed access on Record<string, unknown>
            // does not narrow across the compound guard for object literals.
            const error = n.error;
            const remainingItems = n.remainingItems;
            if (!(error === null || typeof error === 'string') || typeof remainingItems !== 'number'
                || !Number.isInteger(remainingItems) || remainingItems < 0
                || ('workStillOwned' in n && typeof n.workStillOwned !== 'boolean')) throw new Error('NARRATIVE_RECEIPT_INVALID');
            out.narrative = { stopFailed: false, error, remainingItems, workStillOwned: n.workStillOwned === true };
        }
    }
    if ('arbiter' in value) {
        const a = value.arbiter;
        if (!record(a) || (a.stopFailed !== true && typeof a.boundExhausted !== 'boolean')) throw new Error('ARBITER_RECEIPT_INVALID');
        out.arbiter = { stopFailed: a.stopFailed === true, boundExhausted: a.boundExhausted === true };
    }
    if ('power' in value) {
        const p = value.power;
        if (!record(p)) throw new Error('POWER_RECEIPT_INVALID');
        // Present but mistyped is rejected; only genuine absence may omit.
        if ('intervalWasArmed' in p && typeof p.intervalWasArmed !== 'boolean') throw new Error('POWER_RECEIPT_INVALID');
        if (p.stopFailed === true) {
            out.power = typeof p.intervalWasArmed === 'boolean'
                ? { stopFailed: true, intervalWasArmed: p.intervalWasArmed }
                : { stopFailed: true };
        } else {
            // stopFailed present but not boolean is invalid; absence is the
            // documented healthy shape (stopThrottleTimer returns only
            // intervalWasArmed), so the normalized false is contract-grounded.
            if (('stopFailed' in p && p.stopFailed !== false) || typeof p.intervalWasArmed !== 'boolean') throw new Error('POWER_RECEIPT_INVALID');
            out.power = { stopFailed: false, intervalWasArmed: p.intervalWasArmed };
        }
    }
    return out;
}
