/**
 * Single-use approval grants bound to a specific action.
 *
 * A human approval is only valid for the exact action it was given for:
 * same type, destination, amount and currency, before it expires, and only
 * once. Reusing a grant, changing the amount/destination, or presenting it
 * after expiry is rejected.
 */
import crypto from 'crypto';

export interface ApprovalBinding {
    type: string;
    /** Merchant, URL host, phone number, account... whatever the effect targets. */
    destination?: string;
    amountCents?: number;
    currency?: string;
}

export interface ApprovalGrant {
    token: string;
    expiresAt: number;
}

export type GrantCheck = { ok: true } | { ok: false; reason: 'UNKNOWN' | 'EXPIRED' | 'MISMATCH' | 'ALREADY_USED' | 'INVALID' };

export const DEFAULT_GRANT_TTL_MS = 2 * 60 * 1000;

export function bindingDigest(b: ApprovalBinding): string {
    const canonical = JSON.stringify({
        type: String(b.type),
        destination: (b.destination ?? '').trim().toLowerCase(),
        amountCents: b.amountCents ?? null,
        currency: (b.currency ?? '').toUpperCase(),
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

interface GrantRecord { digest: string; expiresAt: number; used: boolean }

export class ApprovalGrantStore {
    private grants = new Map<string, GrantRecord>();
    constructor(private now: () => number = Date.now) {}

    issue(binding: ApprovalBinding, ttlMs: number = DEFAULT_GRANT_TTL_MS): ApprovalGrant {
        this.sweep();
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = this.now() + ttlMs;
        this.grants.set(token, { digest: bindingDigest(binding), expiresAt, used: false });
        return { token, expiresAt };
    }

    /** Verify and consume in one step. A valid grant works exactly once. */
    consume(token: unknown, binding: ApprovalBinding): GrantCheck {
        if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'INVALID' };
        const rec = this.grants.get(token);
        if (!rec) return { ok: false, reason: 'UNKNOWN' };
        if (rec.used) return { ok: false, reason: 'ALREADY_USED' };
        if (this.now() > rec.expiresAt) { this.grants.delete(token); return { ok: false, reason: 'EXPIRED' }; }
        const a = Buffer.from(rec.digest);
        const b = Buffer.from(bindingDigest(binding));
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'MISMATCH' };
        rec.used = true;
        return { ok: true };
    }

    private sweep() {
        const t = this.now();
        for (const [k, v] of this.grants) if (v.used || t > v.expiresAt) this.grants.delete(k);
    }
}

export const approvalGrants = new ApprovalGrantStore();
