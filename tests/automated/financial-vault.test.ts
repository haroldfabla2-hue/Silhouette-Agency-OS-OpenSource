import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { financialVault } from '../../services/vault/financialVault';
import { visualBrowserEngine } from '../../services/browser/visualBrowserEngine';
import { browserService } from '../../services/browserService';
import { sqliteService } from '../../services/sqliteService';

describe('FinancialVault & Autonomous Checkout System (Phase 22)', () => {
    let testCardId: string;

    beforeAll(() => {
        process.env.FINANCIAL_VAULT_KEY = process.env.FINANCIAL_VAULT_KEY || 'test-only-key-not-a-secret';
        process.env.SILHOUETTE_DEMO_MODE = '1'; // cards are DEMO only when explicitly enabled
        try {
            sqliteService.db.exec(`
                DELETE FROM financial_transactions;
                DELETE FROM financial_cards;
            `);
        } catch { /* tables might not be created yet */ }
    });

    afterAll(async () => {
        await visualBrowserEngine.close();
    });

    it('initializes schema and returns accurate initial spend summary', () => {
        const summary = financialVault.getSpendSummary();
        expect(summary.dailyLimitCents).toBe(50000); // $500.00
        expect(summary.currency).toBe('USD');
        expect(typeof summary.todaySpentCents).toBe('number');
    });

    it('issues single-use virtual card with AES-256 encryption and spend ceiling', async () => {
        const result = await financialVault.requestVirtualCard({
            merchant: 'AmericanAirlines.com',
            maxAmountCents: 18500, // $185.00
            purpose: 'Economy ticket MIA to JFK',
            requireHumanApproval: false // bypass interactive prompt for automated test
        });

        expect(result.error).toBeUndefined();
        expect(result.card).toBeDefined();

        const card = result.card!;
        testCardId = card.id;

        expect(card.id.startsWith('vcard_')).toBe(true);
        expect(card.merchantLock).toBe('americanairlines.com');
        expect(card.spendLimitCents).toBe(18500);
        expect(card.spentCents).toBe(0);
        expect(card.status).toBe('ACTIVE');
        expect(card.last4.length).toBe(4);
    });

    it('enforces daily ceiling and blocks requests that exceed budget', async () => {
        const result = await financialVault.requestVirtualCard({
            merchant: 'LuxuryResort.com',
            maxAmountCents: 99999999, // $999,999.99 exceeds daily limit
            purpose: 'Unrealistic expense',
            requireHumanApproval: false
        });

        expect(result.card).toBeUndefined();
        expect(result.error).toContain('Spending limit exceeded');
    });

    it('retrieves decrypted card credentials securely in-memory for autofill', () => {
        const autofillData = financialVault.getCardForAutofill(testCardId);

        expect(autofillData).not.toBeNull();
        expect(autofillData?.cardNumber.length).toBeGreaterThanOrEqual(15);
        expect(autofillData?.cvv.length).toBe(3);
        expect(autofillData?.cardNumber.endsWith(autofillData.last4)).toBe(true);
    });

    it('records transaction and auto-exhausts single-use card when limit reached', () => {
        const success = financialVault.recordTransaction(
            testCardId,
            'americanairlines.com',
            18500,
            'Flight confirmation AA-492'
        );

        expect(success).toBe(true);

        // Verify card is now marked EXHAUSTED
        const cardAfter = financialVault.listCards().find(c => c.id === testCardId);
        expect(cardAfter?.status).toBe('EXHAUSTED');
        expect(cardAfter?.spentCents).toBe(18500);

        // Once exhausted, getCardForAutofill must return null to prevent double spending
        const reuseAttempt = financialVault.getCardForAutofill(testCardId);
        expect(reuseAttempt).toBeNull();
    });

    it('burns/revokes an active virtual card permanently', async () => {
        const newCardResult = await financialVault.requestVirtualCard({
            merchant: 'Uber.com',
            maxAmountCents: 2500,
            purpose: 'Airport ride',
            requireHumanApproval: false
        });

        const newCardId = newCardResult.card!.id;
        const burnSuccess = financialVault.burnCard(newCardId, 'REVOKED');
        expect(burnSuccess).toBe(true);

        const burnedCard = financialVault.listCards().find(c => c.id === newCardId);
        expect(burnedCard?.status).toBe('REVOKED');
    });

    it('refuses disabled card autofill before decrypting or typing and leaves payment state unchanged', async () => {
        // Mint a dedicated checkout card
        const cardRes = await financialVault.requestVirtualCard({
            merchant: 'AirlineCheckout.com',
            maxAmountCents: 12000,
            purpose: 'Flight booking checkout test',
            requireHumanApproval: false
        });
        const checkoutCardId = cardRes.card!.id;

        // Real browser fixture only. No merchant or real card/provider.
        const checkoutHtml = `
            <!DOCTYPE html>
            <html>
            <head><title>Checkout Page</title></head>
            <body>
                <h1>Airline Payment Checkout</h1>
                <form id="payment-form">
                    <input id="card-num" name="cardnumber" autocomplete="cc-number" placeholder="Card number" />
                    <input id="card-exp" name="exp" autocomplete="cc-exp" placeholder="MM/YY" />
                    <input id="card-cvv" name="cvv" autocomplete="cc-csc" placeholder="CVV" />
                    <input id="card-name" name="cardholder" autocomplete="cc-name" placeholder="Name on card" />
                    <button type="submit" id="pay-btn">Complete Purchase</button>
                </form>
            </body>
            </html>
        `;

        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(checkoutHtml)}`;
        await visualBrowserEngine.goto(dataUrl);

        const page = await visualBrowserEngine.init();
        const values = () => page.locator('input').evaluateAll(inputs =>
            inputs.map(input => (input as HTMLInputElement).value));
        expect(await values()).toEqual(['', '', '', '']);
        const cardBefore = sqliteService.db.prepare('SELECT * FROM financial_cards WHERE id=?').get(checkoutCardId) as any;
        const transactionsBefore = sqliteService.db.prepare('SELECT * FROM financial_transactions').all();

        // A real unreadable ciphertext proves the deny path does not decrypt:
        // opening this envelope with FinancialVault would throw. Restore it in
        // finally so this negative fault does not alter the fixture card state.
        sqliteService.db.prepare('UPDATE financial_cards SET encrypted_number=? WHERE id=?')
            .run('not-an-encrypted-card-envelope', checkoutCardId);
        try {
            expect(() => financialVault.getCardForAutofill(checkoutCardId)).toThrow();
            for (const id of [checkoutCardId, 'invalid-card-does-not-exist']) {
                const result = await browserService.autofillPayment(id);
                expect(result.success).toBe(false);
                expect(result.fieldsInjected).toEqual([]);
                expect(result.maskedLast4).toBeUndefined();
                expect(result.error).toContain('temporarily disabled for security');
                expect(result.error).toContain('No card data was retrieved, decrypted or typed');
                expect(await values()).toEqual(['', '', '', '']);
            }
            const whileBlocked = sqliteService.db.prepare('SELECT * FROM financial_cards WHERE id=?').get(checkoutCardId) as any;
            expect(whileBlocked).toEqual({ ...cardBefore, encrypted_number: 'not-an-encrypted-card-envelope' });
            expect(sqliteService.db.prepare('SELECT * FROM financial_transactions').all()).toEqual(transactionsBefore);
        } finally {
            sqliteService.db.prepare('UPDATE financial_cards SET encrypted_number=? WHERE id=?')
                .run(cardBefore.encrypted_number, checkoutCardId);
        }
        expect(sqliteService.db.prepare('SELECT * FROM financial_cards WHERE id=?').get(checkoutCardId)).toEqual(cardBefore);
        expect(await values()).toEqual(['', '', '', '']);

    });
});
