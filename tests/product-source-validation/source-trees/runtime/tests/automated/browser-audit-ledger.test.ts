import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { BrowserAuditLedger, verifySession, AuditSession } from '../../services/browser/browserAuditLedger';

async function sealedSession() {
    const ledger = new BrowserAuditLedger();
    const id = ledger.startSession('https://shop.test/');
    for (const [i, d] of ['open cart', 'enter address', 'review'].entries()) {
        await ledger.recordFrame({ actionType: 'act', targetDescription: d, url: `https://shop.test/${i}`, coordinates: { x: i, y: i }, screenshotBuffer: Buffer.from('s' + i), domContent: '<p>' + i + '</p>' });
    }
    const r = await ledger.sealSession(id);
    return { ledger, id, r, manifest: JSON.parse(fs.readFileSync(r.reportPath, 'utf8')) as AuditSession };
}

describe('Browser audit ledger: Ed25519, full verification', () => {
    it('honest session verifies and uses Ed25519 (not HMAC)', async () => {
        const { r, manifest } = await sealedSession();
        expect(r.isValid).toBe(true);
        expect(manifest.keySource).toBe('EPHEMERAL'); // no key configured in tests, labelled honestly
        expect(manifest.frames[0].signature).toBeDefined();
        expect(Buffer.from(manifest.frames[0].signature!, 'base64').length).toBe(64); // Ed25519 signature size
        expect(verifySession(manifest).valid).toBe(true);
    });

    const tamper = (name: string, fn: (m: AuditSession) => void) =>
        it(`REGRESSION: ${name} is detected (used to return isValid:true)`, async () => {
            const { manifest } = await sealedSession();
            const m = structuredClone(manifest);
            fn(m);
            expect(verifySession(m).valid).toBe(false);
        });

    tamper('altered signature', m => { const s = m.frames[1].signature!; m.frames[1].signature = (s[0] === 'A' ? 'B' : 'A') + s.slice(1); });
    tamper('altered timestamp', m => { m.frames[1].timestamp += 5; });
    tamper('altered description', m => { m.frames[1].targetDescription = 'something else'; });
    tamper('altered url', m => { m.frames[0].url = 'https://evil.test/'; });
    tamper('deleted last frame', m => { m.frames.pop(); });
    tamper('deleted first frame', m => { m.frames.shift(); });
    tamper('reordered frames', m => { m.frames.reverse(); });
    tamper('forged seal', m => { m.sealSignature = 'AAAA'; });
    tamper('swapped public key (attacker re-signing)', m => { m.publicKeyPem = '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'; });

    it('getSession returns a copy: mutating it cannot alter the ledger', async () => {
        const ledger = new BrowserAuditLedger();
        const id = ledger.startSession('https://x.test/');
        await ledger.recordFrame({ actionType: 'act', url: 'https://x.test/' });
        const copy = ledger.getSession(id)!;
        copy.frames[0].actionType = 'MALICIOUS';
        expect(ledger.getSession(id)!.frames[0].actionType).toBe('act');
        expect((await ledger.sealSession(id)).isValid).toBe(true);
    });

    it('cannot seal twice', async () => {
        const { ledger, id } = await sealedSession();
        await expect(ledger.sealSession(id)).rejects.toThrow(/already sealed/);
    });

    it('does not use any hardcoded signing key', () => {
        const src = fs.readFileSync('services/browser/browserAuditLedger.ts', 'utf8');
        expect(src).not.toMatch(/silhouette-audit-ledger-root/);
        expect(src).not.toMatch(/createHmac/);
    });
});
