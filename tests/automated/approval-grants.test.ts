import { describe, it, expect } from 'vitest';
import { ApprovalGrantStore } from '../../services/security/approvalGrants';

const pay = { type: 'EXECUTE_PAYMENT', destination: 'Shop.com', amountCents: 1000, currency: 'USD' };

describe('Approval grants bound to the action', () => {
    it('accepts the exact action once', () => {
        const s = new ApprovalGrantStore();
        const g = s.issue(pay);
        expect(s.consume(g.token, pay)).toEqual({ ok: true });
    });
    it('is single use (replay rejected)', () => {
        const s = new ApprovalGrantStore();
        const g = s.issue(pay);
        s.consume(g.token, pay);
        expect(s.consume(g.token, pay)).toEqual({ ok: false, reason: 'ALREADY_USED' });
    });
    it.each([
        ['higher amount', { ...pay, amountCents: 1001 }],
        ['other destination', { ...pay, destination: 'evil.com' }],
        ['other currency', { ...pay, currency: 'EUR' }],
        ['other type', { ...pay, type: 'TRANSFER_FUNDS' }],
    ])('rejects %s', (_n, b) => {
        const s = new ApprovalGrantStore();
        const g = s.issue(pay);
        expect(s.consume(g.token, b)).toEqual({ ok: false, reason: 'MISMATCH' });
    });
    it('a mismatch does not burn the grant, the correct action can still use it', () => {
        const s = new ApprovalGrantStore();
        const g = s.issue(pay);
        s.consume(g.token, { ...pay, amountCents: 5 });
        expect(s.consume(g.token, pay)).toEqual({ ok: true });
    });
    it('rejects expired grants', () => {
        let t = 1000;
        const s = new ApprovalGrantStore(() => t);
        const g = s.issue(pay, 100);
        t += 101;
        expect(s.consume(g.token, pay)).toEqual({ ok: false, reason: 'EXPIRED' });
    });
    it('rejects missing, forged and malformed tokens', () => {
        const s = new ApprovalGrantStore();
        for (const t of [undefined, null, '', 'abc', 123, {}]) {
            expect(s.consume(t, pay).ok).toBe(false);
        }
    });
});
