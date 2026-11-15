import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { visualBrowserEngine } from '../../services/browser/visualBrowserEngine';
import { requiresPaymentApproval } from '../../services/browser/paymentGate';

const HTML = `<html><body>
<button id="pay" style="position:absolute;left:20px;top:20px;width:160px;height:50px"
  onclick="window.__clicked=(window.__clicked||0)+1">Pay now</button>
<button id="safe" style="position:absolute;left:20px;top:120px;width:160px;height:50px"
  onclick="window.__safe=(window.__safe||0)+1">Continue</button>
</body></html>`;

describe('paymentGate (pure)', () => {
    it('flags commitment wording, EN and ES', () => {
        for (const t of ['Pay now', 'Place your order', 'Comprar', 'Confirmar pago', 'Checkout'])
            expect(requiresPaymentApproval({ elementText: t })).toBe(true);
        expect(requiresPaymentApproval({ instruction: 'click pay now' })).toBe(true);
    });
    it('does not flag harmless controls', () => {
        expect(requiresPaymentApproval({ elementText: 'Continue', url: 'https://example.com/' })).toBe(false);
        expect(requiresPaymentApproval({ elementText: 'Next step' })).toBe(false);
    });
    it('fails closed on unknown element or submit on a checkout url', () => {
        expect(requiresPaymentApproval({ elementUnknown: true, url: 'https://shop.test/checkout' })).toBe(true);
        expect(requiresPaymentApproval({ elementType: 'submit', url: 'https://shop.test/payment' })).toBe(true);
    });
});

describe('visual browser: payment clicks are gated on EVERY path (regression)', () => {
    let asked = 0;
    let decision = false;
    beforeEach(async () => {
        asked = 0; decision = false;
        visualBrowserEngine.setApprovalProvider(async () => { asked++; return decision; });
        const page = await visualBrowserEngine.init();
        await page.setContent(HTML);
        await page.evaluate(() => { (window as any).__clicked = 0; (window as any).__safe = 0; });
    });
    afterAll(async () => { await visualBrowserEngine.close(); });

    const clicks = async () => (await (await visualBrowserEngine.init()).evaluate(() => (window as any).__clicked)) as number;

    it('act("click pay now") is blocked without approval and the button is NOT clicked', async () => {
        const r = await visualBrowserEngine.act('pay');
        expect(r.success).toBe(false);
        expect(r.securityGated).toBe(true);
        expect(asked).toBe(1);
        expect(await clicks()).toBe(0);
    });

    it('clickCoordinate on the Pay button is blocked', async () => {
        const r = await visualBrowserEngine.clickCoordinate(100, 45);
        expect(r.securityGated).toBe(true);
        expect(await clicks()).toBe(0);
    });

    it('CSS selector click on the Pay button is blocked', async () => {
        const r = await visualBrowserEngine.clickSelector('#pay');
        expect(r.securityGated).toBe(true);
        expect(await clicks()).toBe(0);
    });

    it('a throwing approval provider blocks (fail-closed)', async () => {
        visualBrowserEngine.setApprovalProvider(async () => { throw new Error('boom'); });
        const r = await visualBrowserEngine.clickSelector('#pay');
        expect(r.success).toBe(false);
        expect(await clicks()).toBe(0);
    });

    it('with explicit approval the click proceeds', async () => {
        decision = true;
        const r = await visualBrowserEngine.clickSelector('#pay');
        expect(r.success).toBe(true);
        expect(await clicks()).toBe(1);
    });

    it('harmless clicks are not gated (no capability lost)', async () => {
        const r = await visualBrowserEngine.clickSelector('#safe');
        expect(r.success).toBe(true);
        expect(asked).toBe(0);
        expect(await (await visualBrowserEngine.init()).evaluate(() => (window as any).__safe)).toBe(1);
    });
});
