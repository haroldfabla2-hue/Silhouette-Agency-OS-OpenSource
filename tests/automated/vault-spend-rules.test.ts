import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { financialVault } from '../../services/vault/financialVault';
import { sqliteService } from '../../services/sqliteService';

const mint = async (merchant: string, cents: number, currency = 'USD') => {
    const r = await financialVault.requestVirtualCard({ merchant, maxAmountCents: cents, purpose: 't', currency, requireHumanApproval: false });
    expect(r.card).toBeDefined();
    return r.card!.id;
};

describe('Financial vault: atomic spend rules (regressions from review)', () => {
    beforeAll(() => {
        process.env.FINANCIAL_VAULT_KEY = 'test-only-key-not-a-secret';
        process.env.SILHOUETTE_DEMO_MODE = '1';
        try { sqliteService.db.exec('DELETE FROM financial_transactions; DELETE FROM financial_cards;'); } catch { /* */ }
    });

    it('no hardcoded fallback key in source', () => {
        expect(fs.readFileSync('services/vault/financialVault.ts', 'utf8')).not.toMatch(/silhouette-vault-anchor/);
    });

    it('without a key the vault is UNAVAILABLE, not guessable', async () => {
        const k = process.env.FINANCIAL_VAULT_KEY, s = process.env.SYSTEM_SECRET;
        delete process.env.FINANCIAL_VAULT_KEY; delete process.env.SYSTEM_SECRET;
        try {
            const r = await financialVault.requestVirtualCard({ merchant: 'a.test', maxAmountCents: 100, purpose: 'x', requireHumanApproval: false });
            expect(r.card).toBeUndefined();
            expect(r.capabilityState).toBe('UNAVAILABLE');
        } finally { process.env.FINANCIAL_VAULT_KEY = k; if (s) process.env.SYSTEM_SECRET = s; }
    });

    it('rejects a revoked card', async () => {
        const id = await mint('shop.test', 5000);
        financialVault.burnCard(id);
        expect(financialVault.recordTransaction(id, 'shop.test', 100)).toBe(false);
    });

    it('rejects the wrong merchant (merchantLock enforced), accepts www/URL forms of the right one', async () => {
        const id = await mint('shop.test', 5000);
        expect(financialVault.recordTransaction(id, 'evil.test', 100)).toBe(false);
        expect(financialVault.reserveSpend({ cardId: id, merchant: 'https://www.shop.test/checkout', amountCents: 100, idempotencyKey: 'k-www' }).ok).toBe(true);
    });

    it('rejects over-limit, non-integer and non-positive amounts, and currency mismatch', async () => {
        const id = await mint('limit.test', 1000);
        expect(financialVault.recordTransaction(id, 'limit.test', 1001)).toBe(false);
        for (const a of [0, -5, 1.5, NaN]) expect(financialVault.reserveSpend({ cardId: id, merchant: 'limit.test', amountCents: a as number, idempotencyKey: `bad${a}` }).ok).toBe(false);
        const r = financialVault.reserveSpend({ cardId: id, merchant: 'limit.test', amountCents: 100, currency: 'EUR', idempotencyKey: 'cur' });
        expect(r).toEqual({ ok: false, reason: 'CURRENCY_MISMATCH' });
    });

    it('pending reservations count against the card limit (no double spend), release frees it', async () => {
        const id = await mint('pend.test', 1000);
        const a = financialVault.reserveSpend({ cardId: id, merchant: 'pend.test', amountCents: 700, idempotencyKey: 'p1' });
        expect(a.ok).toBe(true);
        expect(financialVault.reserveSpend({ cardId: id, merchant: 'pend.test', amountCents: 700, idempotencyKey: 'p2' })).toEqual({ ok: false, reason: 'CARD_LIMIT_EXCEEDED' });
        if (a.ok) expect(financialVault.releaseSpend(a.txId)).toBe(true);
        expect(financialVault.reserveSpend({ cardId: id, merchant: 'pend.test', amountCents: 700, idempotencyKey: 'p3' }).ok).toBe(true);
    });

    it('is idempotent: same key returns the same reservation, different request with same key is rejected', async () => {
        const id = await mint('idem.test', 5000);
        const a = financialVault.reserveSpend({ cardId: id, merchant: 'idem.test', amountCents: 300, idempotencyKey: 'same' });
        const b = financialVault.reserveSpend({ cardId: id, merchant: 'idem.test', amountCents: 300, idempotencyKey: 'same' });
        expect(a.ok && b.ok && a.txId === b.txId).toBe(true);
        expect(financialVault.reserveSpend({ cardId: id, merchant: 'idem.test', amountCents: 400, idempotencyKey: 'same' }))
            .toEqual({ ok: false, reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' });
    });

    it('capture completes once and exhausts the card at its limit', async () => {
        const id = await mint('cap.test', 500);
        const a = financialVault.reserveSpend({ cardId: id, merchant: 'cap.test', amountCents: 500, idempotencyKey: `c1-${Date.now()}` });
        expect(a.ok).toBe(true);
        if (a.ok) { expect(financialVault.captureSpend(a.txId)).toBe(true); expect(financialVault.captureSpend(a.txId)).toBe(false); }
        expect(financialVault.listCards().find(c => c.id === id)?.status).toBe('EXHAUSTED');
    });

    it('daily ceiling is per currency and counts pending', async () => {
        const usd = financialVault.getSpendSummary('USD');
        const eur = financialVault.getSpendSummary('EUR');
        expect(eur.todaySpentCents).toBe(0);
        expect(usd.todaySpentCents).toBeGreaterThan(0);
    });
});
