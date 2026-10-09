/**
 * Stripe Issuing adapter slot (virtual card issuer).
 *
 * NOT IMPLEMENTED. This is a documented placeholder so the issuer can be configured later without
 * touching callers. It is always UNAVAILABLE and never attempts or simulates anything:
 *  - without STRIPE_ISSUING_API_KEY it reports the missing setting;
 *  - with the key present it still reports that the adapter is not implemented yet.
 * The existing FinancialVault remains the only card path until a real issuer adapter ships.
 */
import { MoneyRequest, PaymentProvider, PaymentResult, ProviderStatus } from './types';

type Env = Record<string, string | undefined>;

export class StripeIssuingProvider implements PaymentProvider {
    readonly id = 'stripe_issuing';
    constructor(private readonly env: () => Env = () => process.env) {}

    providerStatus(): ProviderStatus {
        const hasKey = !!(this.env().STRIPE_ISSUING_API_KEY || '').trim();
        return {
            id: this.id,
            label: 'Stripe Issuing (virtual cards)',
            state: 'UNAVAILABLE',
            missing: hasKey ? [] : ['STRIPE_ISSUING_API_KEY'],
            reason: hasKey
                ? 'Credentials detected, but the Stripe Issuing adapter is not implemented yet. Nothing was attempted.'
                : 'Stripe Issuing is not configured (missing STRIPE_ISSUING_API_KEY) and its adapter is not implemented yet.',
            capabilities: { initiate: false, confirm: false, status: false, payout: false },
        };
    }

    private no(operation: PaymentResult['operation']): PaymentResult {
        const s = this.providerStatus();
        return { provider: this.id, state: 'UNAVAILABLE', operation, error: s.reason, missing: s.missing };
    }
    async initiate(_req: MoneyRequest) { return this.no('initiate'); }
    async confirm(_id: string, _e: MoneyRequest) { return this.no('confirm'); }
    async status(_id: string) { return this.no('status'); }
    async payout(_req: MoneyRequest) { return this.no('payout'); }
}
