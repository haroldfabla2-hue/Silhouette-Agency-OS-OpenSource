import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { visualBrowserEngine } from '../../services/browser/visualBrowserEngine';
import { browserAuditLedger, verifySession } from '../../services/browser/browserAuditLedger';
import { browserService } from '../../services/browserService';

const HTML = `<html><body>
<input id="t" style="position:absolute;left:20px;top:200px;width:200px" value="SECRET-VALUE-123"/>
<button id="b" style="position:absolute;left:20px;top:20px;width:160px;height:50px">Continue</button></body></html>`;

describe('every browser action is recorded in the ledger (regression: only act was)', () => {
    afterAll(async () => { await visualBrowserEngine.close(); });
    beforeAll(() => { visualBrowserEngine.setApprovalProvider(async () => false); });

    it('records goto, CSS click, coordinate click and CSS type; typed text never appears', async () => {
        const page = await visualBrowserEngine.init();
        await page.goto('about:blank');
        const id = await browserService.startAuditSession();
        await visualBrowserEngine.goto('about:blank');
        await page.setContent(HTML);
        await visualBrowserEngine.clickSelector('#b');
        await visualBrowserEngine.clickCoordinate(100, 45);
        await browserService.type('#t', 'my-typed-password');
        const sealed = await browserAuditLedger.sealSession(id);
        const types = sealed.session.frames.map(f => f.actionType);
        expect(types).toEqual(['goto', 'clickSelector', 'clickCoordinate', 'typeSelector']);
        expect(sealed.isValid).toBe(true);
        expect(verifySession(sealed.session).valid).toBe(true);
        const dump = JSON.stringify(sealed.session);
        expect(dump).not.toContain('my-typed-password');
        expect(dump).not.toContain('SECRET-VALUE-123');
        for (const f of sealed.session.frames.filter(f => f.actionType !== 'typeSelector')) {
            expect(f.domHash).not.toBe('0'.repeat(64)); // DOM is hashed for replay
        }
        const typed = sealed.session.frames.find(f => f.actionType === 'typeSelector')!;
        expect(typed.screenshotHash).toBe('0'.repeat(64)); // no screenshot for text entry
    });

    it('blocked payment clicks are not recorded as performed (gate runs before)', async () => {
        const page = await visualBrowserEngine.init();
        await page.setContent('<button id="p" style="position:absolute;left:20px;top:20px;width:160px;height:50px">Pay now</button>');
        const id = await browserService.startAuditSession();
        const r = await visualBrowserEngine.clickSelector('#p');
        expect(r.securityGated).toBe(true);
        const sealed = await browserAuditLedger.sealSession(id);
        expect(sealed.session.frames.length).toBe(0);
    });
});
