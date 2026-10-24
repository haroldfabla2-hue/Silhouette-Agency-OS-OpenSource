/**
 * Effect grant context (AsyncLocalStorage).
 *
 * Carries a SINGLE-USE approval grant for one exact effect invocation
 * (effect + canonical args) across the layers of one execution: the point
 * where a human (or an authenticated request containing the exact args, which
 * IS that principal's explicit approval of those args) approved, and the
 * provider boundary that consumes the grant.
 *
 * A context is NOT a general permission:
 *  - the grant is consumed on first use (ApprovalGrantStore, timing-safe);
 *  - it binds effect + exact args (sha256 over canonical args): different
 *    args mismatch, replay reports ALREADY_USED, expiry denies;
 *  - one grant never covers a campaign's children: each piece needs its own.
 *
 * Absence of a context means the effect must acquire human approval through
 * actionExecutor (/v1/autonomy/confirmations) or be denied.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApprovalBinding } from './approvalGrants';

export interface EffectContext {
    grant: { token: string; binding: ApprovalBinding };
    /** Digests (effect+args, defaults-normalized) already EXECUTED at a
     *  provider boundary in this chain: exactly one provider invocation per
     *  grant. Wrapper layers pass without mutating; the boundary adds the
     *  digest on consume and denies any second invocation as a retry. */
    validated: Set<string>;
    /** Where the grant was issued (audit trail). */
    issuedBy: string;
}

const als = new AsyncLocalStorage<EffectContext>();

export function runWithEffectContext<T>(ctx: EffectContext, fn: () => Promise<T>): Promise<T> {
    return als.run(ctx, fn);
}

export function getEffectContext(): EffectContext | undefined {
    return als.getStore();
}
