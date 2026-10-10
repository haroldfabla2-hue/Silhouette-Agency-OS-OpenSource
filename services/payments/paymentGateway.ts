/**
 * PaymentGateway: the only entry point to payment providers.
 *
 * For every money-moving operation (initiate, confirm, payout) it:
 *   1. validates the request (positive integer minor units, ISO currency, destination, optional cap);
 *   2. checks the provider is REAL (an UNAVAILABLE provider never triggers an approval prompt);
 *   3. asks a human for approval, bound to EXECUTE_PAYMENT + provider + direction + destination + amount + currency;
 *   4. consumes the single-use grant with the same binding right before calling the provider.
 * Anything else (rejection, error, mismatch, reuse) blocks the operation. Read-only status needs no approval.
 */
import crypto from 'crypto';
import type { ApprovalBinding } from '../security/approvalGrants';
import { Direction, MoneyRequest, PaymentProvider, PaymentResult, ProviderStatus } from './types';
import { PayPalProvider } from './paypalProvider';
import { StripeIssuingProvider } from './cardIssuerStub';

export interface PaymentApprovalContext {
    provider: string;
    direction: Direction;
    operation: 'initiate' | 'confirm' | 'payout';
    request: MoneyRequest;
    binding: ApprovalBinding;
    summary: string;
}

/** Returns true only when a human approved this exact binding AND the single-use grant verified. */
export type PaymentApprover = (ctx: PaymentApprovalContext) => Promise<boolean>;

export const defaultPaymentApprover: PaymentApprover = async (ctx) => {
    const { actionExecutor } = await import('../actionExecutor');
    const grant = await actionExecutor.requestApproval({
        id: crypto.randomUUID(),
        agentId: 'payments-gateway',
        type: 'EXECUTE_PAYMENT' as any,
        payload: { provider: ctx.provider, direction: ctx.direction, destination: ctx.request.destination, amountCents: ctx.request.amountCents, currency: ctx.request.currency } as any,
        status: 'PENDING' as any,
        requiresApproval: true,
        timestamp: Date.now(),
    }, ctx.binding, ctx.summary);
    return !!grant && actionExecutor.verifyApproval(grant.token, ctx.binding).ok;
};

export function bindingFor(provider: string, direction: Direction, r: MoneyRequest): ApprovalBinding {
    return {
        type: 'EXECUTE_PAYMENT',
        destination: `${provider}:${direction}:${r.destination}`,
        amountCents: r.amountCents,
        currency: r.currency.toUpperCase(),
    };
}

export function validateMoneyRequest(r: Partial<MoneyRequest>, env: Record<string, string | undefined> = process.env): string | null {
    if (!r || typeof r !== 'object') return 'Request is required';
    if (!Number.isInteger(r.amountCents) || (r.amountCents as number) <= 0) return 'amountCents must be a positive integer (minor units)';
    if (typeof r.currency !== 'string' || !/^[A-Za-z]{3}$/.test(r.currency)) return 'currency must be a 3-letter ISO 4217 code';
    if (typeof r.destination !== 'string' || !r.destination.trim()) return 'destination is required';
    const cap = Number((env.PAYMENTS_MAX_AMOUNT_CENTS || '').trim());
    if (cap > 0 && (r.amountCents as number) > cap) return `amount exceeds PAYMENTS_MAX_AMOUNT_CENTS (${cap})`;
    return null;
}

export class PaymentGateway {
    private providers = new Map<string, PaymentProvider>();

    constructor(
        private readonly approve: PaymentApprover = defaultPaymentApprover,
        private readonly env: () => Record<string, string | undefined> = () => process.env,
        providers?: PaymentProvider[],
    ) {
        for (const p of providers ?? [new PayPalProvider(env), new StripeIssuingProvider(env)]) this.register(p);
    }

    /** Add a provider (new rails plug in here without touching callers). */
    public register(p: PaymentProvider): void { this.providers.set(p.id, p); }

    public listProviders(): ProviderStatus[] { return [...this.providers.values()].map(p => p.providerStatus()); }

    private pick(id?: string): { provider?: PaymentProvider; error?: string } {
        const wanted = (id || this.env().PAYMENT_PROVIDER || '').trim();
        if (!wanted) return { error: `No provider selected. Pass "provider" or set PAYMENT_PROVIDER. Known: ${[...this.providers.keys()].join(', ')}` };
        const p = this.providers.get(wanted);
        return p ? { provider: p } : { error: `Unknown payment provider "${wanted}". Known: ${[...this.providers.keys()].join(', ')}` };
    }

    private fail(provider: string, operation: PaymentResult['operation'], error: string, extra: Partial<PaymentResult> = {}): PaymentResult {
        return { provider, state: 'FAILED', operation, error, ...extra };
    }

    private async gated(
        p: PaymentProvider, direction: Direction, operation: 'initiate' | 'confirm' | 'payout', req: MoneyRequest,
        run: (r: MoneyRequest) => Promise<PaymentResult>,
    ): Promise<PaymentResult> {
        const bad = validateMoneyRequest(req, this.env());
        if (bad) return this.fail(p.id, operation, bad);

        const st = p.providerStatus();
        if (st.state !== 'REAL') {
            return { provider: p.id, state: 'UNAVAILABLE', operation, error: st.reason, missing: st.missing };
        }

        const binding = bindingFor(p.id, direction, req);
        const summary = `${operation.toUpperCase()} via ${p.id}${st.mode ? ` (${st.mode})` : ''}: ${(req.amountCents / 100).toFixed(2)} ${req.currency.toUpperCase()} ${direction === 'payout' ? 'to' : 'from/for'} ${req.destination}${req.purpose ? ` - ${req.purpose}` : ''}`;
        let ok = false;
        try { ok = await this.approve({ provider: p.id, direction, operation, request: req, binding, summary }); } catch { ok = false; }
        if (!ok) {
            return { provider: p.id, state: 'FAILED', mode: st.mode, operation, securityGated: true, error: 'Blocked: this payment needs explicit human approval for this exact amount and destination.' };
        }
        return run({ ...req, currency: req.currency.toUpperCase(), idempotencyKey: crypto.randomUUID() });
    }

    public async initiate(provider: string | undefined, req: MoneyRequest): Promise<PaymentResult> {
        const { provider: p, error } = this.pick(provider);
        if (!p) return this.fail(provider || 'unknown', 'initiate', error!);
        return this.gated(p, 'collect', 'initiate', req, r => p.initiate(r));
    }

    /** `expected` is what the human approved; the provider refuses to capture anything that differs. */
    public async confirm(provider: string | undefined, id: string, expected: MoneyRequest): Promise<PaymentResult> {
        const { provider: p, error } = this.pick(provider);
        if (!p) return this.fail(provider || 'unknown', 'confirm', error!);
        if (!id || typeof id !== 'string') return this.fail(p.id, 'confirm', 'id is required');
        return this.gated(p, 'collect', 'confirm', expected, r => p.confirm(id, r));
    }

    public async payout(provider: string | undefined, req: MoneyRequest): Promise<PaymentResult> {
        const { provider: p, error } = this.pick(provider);
        if (!p) return this.fail(provider || 'unknown', 'payout', error!);
        return this.gated(p, 'payout', 'payout', req, r => p.payout(r));
    }

    /** Read-only: no money moves, no approval needed. */
    public async status(provider: string | undefined, id: string): Promise<PaymentResult> {
        const { provider: p, error } = this.pick(provider);
        if (!p) return this.fail(provider || 'unknown', 'status', error!);
        if (!id || typeof id !== 'string') return this.fail(p.id, 'status', 'id is required');
        return p.status(id);
    }
}

export const paymentGateway = new PaymentGateway();
