const record = (value) => typeof value === 'object' && value !== null;
const nullableString = (value) => value === null || typeof value === 'string';
const nonNegativeInt = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
export function readProducerSafetyReceipts(value) {
    if (!record(value) || Object.keys(value).some(key => !['narrative', 'arbiter', 'power', 'continuum'].includes(key)))
        throw new Error('PRODUCER_RECEIPTS_INVALID');
    const out = {};
    if ('narrative' in value) {
        const n = value.narrative;
        if (!record(n))
            throw new Error('NARRATIVE_RECEIPT_INVALID');
        if (n.stopFailed === true)
            out.narrative = { stopFailed: true, error: 'stop-failed', remainingItems: 0, workStillOwned: true };
        else {
            // Type predicates narrow here; the same compound inline guard does
            // not narrow indexed unknown access under this tsconfig (TS2322).
            const error = n.error;
            const remainingItems = n.remainingItems;
            if (!nullableString(error) || !nonNegativeInt(remainingItems)
                || ('workStillOwned' in n && typeof n.workStillOwned !== 'boolean'))
                throw new Error('NARRATIVE_RECEIPT_INVALID');
            out.narrative = { stopFailed: false, error, remainingItems, workStillOwned: n.workStillOwned === true };
        }
    }
    if ('arbiter' in value) {
        const a = value.arbiter;
        if (!record(a) || (a.stopFailed !== true && typeof a.boundExhausted !== 'boolean'))
            throw new Error('ARBITER_RECEIPT_INVALID');
        out.arbiter = { stopFailed: a.stopFailed === true, boundExhausted: a.boundExhausted === true };
    }
    if ('power' in value) {
        const p = value.power;
        if (!record(p))
            throw new Error('POWER_RECEIPT_INVALID');
        // Present but mistyped is rejected; only genuine absence may omit.
        if ('intervalWasArmed' in p && typeof p.intervalWasArmed !== 'boolean')
            throw new Error('POWER_RECEIPT_INVALID');
        if (p.stopFailed === true) {
            out.power = typeof p.intervalWasArmed === 'boolean'
                ? { stopFailed: true, intervalWasArmed: p.intervalWasArmed }
                : { stopFailed: true };
        }
        else {
            // stopFailed present but not boolean is invalid; absence is the
            // documented healthy shape (stopThrottleTimer returns only
            // intervalWasArmed), so the normalized false is contract-grounded.
            if (('stopFailed' in p && p.stopFailed !== false) || typeof p.intervalWasArmed !== 'boolean')
                throw new Error('POWER_RECEIPT_INVALID');
            out.power = { stopFailed: false, intervalWasArmed: p.intervalWasArmed };
        }
    }
    if ('continuum' in value) {
        const c = value.continuum;
        if (!record(c))
            throw new Error('CONTINUUM_RECEIPT_INVALID');
        if (c.status === 'saved' && c.stopFailed === false && c.error === null) {
            out.continuum = { status: 'saved', stopFailed: false, error: null };
        }
        else if (c.status === 'failed' && c.stopFailed === true && typeof c.error === 'string' && c.error.length > 0) {
            out.continuum = { status: 'failed', stopFailed: true, error: c.error };
        }
        else
            throw new Error('CONTINUUM_RECEIPT_INVALID');
    }
    return out;
}
