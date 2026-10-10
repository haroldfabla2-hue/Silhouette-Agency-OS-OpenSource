import { describe, it, expect, afterEach } from 'vitest';
import { isDemoModeEnabled, demoOrUnavailable } from '../../services/security/capabilityState';
import { financialVault } from '../../services/vault/financialVault';

describe('capability states', () => {
    const prev = process.env.SILHOUETTE_DEMO_MODE;
    afterEach(() => { if (prev === undefined) delete process.env.SILHOUETTE_DEMO_MODE; else process.env.SILHOUETTE_DEMO_MODE = prev; });

    it('demo mode is OFF by default', () => {
        expect(isDemoModeEnabled({} as any)).toBe(false);
        expect(isDemoModeEnabled({ SILHOUETTE_DEMO_MODE: '0' } as any)).toBe(false);
        expect(isDemoModeEnabled({ SILHOUETTE_DEMO_MODE: '1' } as any)).toBe(true);
        expect(demoOrUnavailable('x', {} as any).state).toBe('UNAVAILABLE');
    });

    it('REGRESSION: without demo mode the vault does NOT mint a fake card', async () => {
        delete process.env.SILHOUETTE_DEMO_MODE;
        const r = await financialVault.requestVirtualCard({ merchant: 'shop.test', maxAmountCents: 1000, purpose: 'x', requireHumanApproval: false });
        expect(r.card).toBeUndefined();
        expect(r.capabilityState).toBe('UNAVAILABLE');
        expect(r.error).toMatch(/no real provider/i);
    });

    it('in explicit demo mode the card is labelled DEMO', async () => {
        process.env.SILHOUETTE_DEMO_MODE = '1';
        const r = await financialVault.requestVirtualCard({ merchant: 'shop.test', maxAmountCents: 1000, purpose: 'x', requireHumanApproval: false });
        expect(r.card?.capabilityState).toBe('DEMO');
        expect(r.capabilityState).toBe('DEMO');
    });
});
