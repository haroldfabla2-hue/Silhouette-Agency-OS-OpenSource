import { describe, it, expect, vi } from 'vitest';
import { PaymentGateway, bindingFor, validateMoneyRequest } from '../../services/payments/paymentGateway';
import { StripeIssuingProvider } from '../../services/payments/cardIssuerStub';
import { PayPalProvider, toPayPalValue, fromPayPalValue } from '../../services/payments/paypalProvider';
import { ApprovalGrantStore } from '../../services/security/approvalGrants';
import type { MoneyRequest, PaymentProvider } from '../../services/payments/types';

const PP_ENV = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', PAYPAL_MODE: 'sandbox' };
const REQ: MoneyRequest = { amountCents: 1050, currency: 'usd', destination: 'ana@example.com', purpose: 'Invoice 7' };

/** Scripted HTTP: records calls and answers by "METHOD path". Tests only. */
function http(script: Record<string, { status?: number; body: any }>) {
    const calls: { url: string; method: string; headers: any; body?: any }[] = [];
    const fn = async (url: string, init: any = {}) => {
        const path = url.replace(/^https:\/\/[^/]+/, '');
        const method = init.method || 'GET';
        calls.push({ url, method, headers: init.headers, body: init.body });
        const key = `${method} ${path}`;
        const hit = script[key] ?? script[Object.keys(script).find(k => key.startsWith(k)) || ''];
        if (!hit) return { ok: false, status: 404, json: async () => ({ message: `unscripted ${key}` }), text: async () => '' };
        const status = hit.status ?? 200;
        return { ok: status < 400, status, json: async () => hit.body, text: async () => JSON.stringify(hit.body) };
    };
    return { fn, calls };
}
const TOKEN = { 'POST /v1/oauth2/token': { body: { access_token: 'tok', expires_in: 300 } } };

describe('providers without credentials are UNAVAILABLE and never attempt anything', () => {
    it('PayPal lists exactly what is missing; explicit mode is required (no silent live)', () => {
        const p = new PayPalProvider(() => ({}), vi.fn() as any);
        const s = p.providerStatus();
        expect(s.state).toBe('UNAVAILABLE');
        expect(s.missing).toEqual(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE (sandbox|live)']);
        expect(new PayPalProvider(() => ({ ...PP_ENV, PAYPAL_MODE: 'prod' }), vi.fn() as any).providerStatus().state).toBe('UNAVAILABLE');
    });
    it('Stripe Issuing stays UNAVAILABLE even with a key (adapter not implemented) and never simulates', async () => {
        const noKey = new StripeIssuingProvider(() => ({}));
        expect(noKey.providerStatus().missing).toEqual(['STRIPE_ISSUING_API_KEY']);
        const withKey = new StripeIssuingProvider(() => ({ STRIPE_ISSUING_API_KEY: 'sk_x' }));
        expect(withKey.providerStatus().state).toBe('UNAVAILABLE');
        expect((await withKey.payout(REQ)).state).toBe('UNAVAILABLE');
    });
    it('gateway does not even ask a human to approve an UNAVAILABLE provider', async () => {
        const approve = vi.fn(async () => true);
        const gw = new PaymentGateway(approve, () => ({}));
        const r = await gw.payout('paypal', REQ);
        expect(r.state).toBe('UNAVAILABLE');
        expect(approve).not.toHaveBeenCalled();
    });
});

describe('approval gate (EXECUTE_PAYMENT bound to provider, direction, destination, amount, currency)', () => {
    const gwWith = (approve: any, h: ReturnType<typeof http>) => new PaymentGateway(approve, () => PP_ENV, [new PayPalProvider(() => PP_ENV, h.fn as any)]);

    it('NEGATIVE: payout is NOT sent without approval (no HTTP call at all)', async () => {
        const h = http({ ...TOKEN });
        const r = await gwWith(async () => false, h).payout('paypal', REQ);
        expect(r.securityGated).toBe(true);
        expect(h.calls).toEqual([]);
    });
    it('NEGATIVE: approver that throws blocks (fail closed)', async () => {
        const h = http({ ...TOKEN });
        const r = await gwWith(async () => { throw new Error('boom'); }, h).initiate('paypal', REQ);
        expect(r.securityGated).toBe(true);
        expect(h.calls).toEqual([]);
    });
    it('approved payout goes to PayPal with the exact amount/receiver and an idempotency key', async () => {
        const h = http({ ...TOKEN, 'POST /v1/payments/payouts': { body: { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } } } });
        const approve = vi.fn(async () => true);
        const r = await gwWith(approve, h).payout('paypal', REQ);
        expect(approve).toHaveBeenCalledOnce();
        expect((approve.mock.calls[0] as any)[0].binding).toEqual({ type: 'EXECUTE_PAYMENT', destination: 'paypal:payout:ana@example.com', amountCents: 1050, currency: 'USD' });
        expect(r).toMatchObject({ state: 'REAL', mode: 'sandbox', id: 'payout:B1', status: 'PROCESSING' });
        const sent = JSON.parse(h.calls.find(c => c.url.endsWith('/v1/payments/payouts'))!.body);
        expect(sent.items[0]).toMatchObject({ receiver: 'ana@example.com', amount: { value: '10.50', currency: 'USD' } });
        expect(h.calls[0].url).toContain('api-m.sandbox.paypal.com');
    });
    it('live mode uses the live host only when configured', async () => {
        const env = { ...PP_ENV, PAYPAL_MODE: 'live' };
        const h = http({ ...TOKEN, 'POST /v1/payments/payouts': { body: { batch_header: { payout_batch_id: 'B2', batch_status: 'SUCCESS' } } } });
        const gw = new PaymentGateway(async () => true, () => env, [new PayPalProvider(() => env, h.fn as any)]);
        const r = await gw.payout('paypal', REQ);
        expect(r.mode).toBe('live');
        expect(h.calls[0].url).toContain('https://api-m.paypal.com');
    });
    it('grants are bound: different amount or destination does not verify, and a grant works once', () => {
        const store = new ApprovalGrantStore();
        const g = store.issue(bindingFor('paypal', 'payout', REQ));
        expect(store.consume(g.token, bindingFor('paypal', 'payout', { ...REQ, amountCents: 9999 })).ok).toBe(false);
        expect(store.consume(g.token, bindingFor('paypal', 'payout', { ...REQ, destination: 'evil@example.com' })).ok).toBe(false);
        expect(store.consume(g.token, bindingFor('paypal', 'collect', REQ)).ok).toBe(false);
        expect(store.consume(g.token, bindingFor('paypal', 'payout', REQ)).ok).toBe(true);
        expect(store.consume(g.token, bindingFor('paypal', 'payout', REQ)).ok).toBe(false);
    });
    it('invalid requests are rejected before any approval or HTTP', async () => {
        const approve = vi.fn(async () => true);
        const h = http({ ...TOKEN });
        const gw = gwWith(approve, h);
        for (const bad of [{ ...REQ, amountCents: 0 }, { ...REQ, amountCents: 10.5 }, { ...REQ, currency: 'US' }, { ...REQ, destination: ' ' }]) {
            expect((await gw.payout('paypal', bad as any)).state).toBe('FAILED');
        }
        expect(approve).not.toHaveBeenCalled();
        expect(h.calls).toEqual([]);
        expect(validateMoneyRequest(REQ, { PAYMENTS_MAX_AMOUNT_CENTS: '1000' })).toContain('PAYMENTS_MAX_AMOUNT_CENTS');
    });
    it('unknown or unselected provider fails with the list of known ones', async () => {
        const gw = new PaymentGateway(async () => true, () => ({}), []);
        expect((await gw.payout(undefined, REQ)).error).toContain('No provider selected');
        expect((await gw.payout('nope', REQ)).error).toContain('Unknown payment provider');
    });
    it('PAYMENT_PROVIDER selects the provider when none is passed; new providers plug in via register()', async () => {
        const fake: PaymentProvider = {
            id: 'acme',
            providerStatus: () => ({ id: 'acme', label: 'Acme', state: 'REAL', missing: [], capabilities: { initiate: true, confirm: true, status: true, payout: true } }),
            initiate: async () => ({ provider: 'acme', state: 'REAL', operation: 'initiate', id: 'x', status: 'CREATED' }),
            confirm: async () => ({ provider: 'acme', state: 'REAL', operation: 'confirm' }),
            status: async () => ({ provider: 'acme', state: 'REAL', operation: 'status' }),
            payout: async () => ({ provider: 'acme', state: 'REAL', operation: 'payout' }),
        };
        const gw = new PaymentGateway(async () => true, () => ({ PAYMENT_PROVIDER: 'acme' }), []);
        gw.register(fake);
        expect((await gw.initiate(undefined, REQ)).id).toBe('x');
    });
});

describe('PayPal collection flow', () => {
    const order = (status: string, value = '10.50', cur = 'USD') => ({ id: 'O1', status, purchase_units: [{ amount: { value, currency_code: cur } }] });

    it('initiate returns the payer approval link and moves no money', async () => {
        const h = http({ ...TOKEN, 'POST /v2/checkout/orders': { body: { id: 'O1', status: 'CREATED', links: [{ rel: 'payer-action', href: 'https://paypal.example/approve/O1' }] } } });
        const p = new PayPalProvider(() => PP_ENV, h.fn as any);
        const r = await p.initiate(REQ);
        expect(r).toMatchObject({ state: 'REAL', id: 'O1', status: 'PENDING_APPROVAL', approvalUrl: 'https://paypal.example/approve/O1' });
        expect(h.calls.some(c => c.url.includes('/capture'))).toBe(false);
    });
    it('NEGATIVE: confirm refuses to capture when the order amount differs from what was approved', async () => {
        const h = http({ ...TOKEN, 'GET /v2/checkout/orders/O1': { body: order('APPROVED', '99.00') } });
        const r = await new PayPalProvider(() => PP_ENV, h.fn as any).confirm('O1', REQ);
        expect(r.state).toBe('FAILED');
        expect(r.error).toContain('does not match');
        expect(h.calls.some(c => c.url.includes('/capture'))).toBe(false);
    });
    it('NEGATIVE: confirm does not capture an order the payer has not approved', async () => {
        const h = http({ ...TOKEN, 'GET /v2/checkout/orders/O1': { body: order('CREATED') } });
        const r = await new PayPalProvider(() => PP_ENV, h.fn as any).confirm('O1', REQ);
        expect(r.state).toBe('FAILED');
        expect(h.calls.some(c => c.url.includes('/capture'))).toBe(false);
    });
    it('confirm captures an approved, matching order', async () => {
        const h = http({ ...TOKEN, 'GET /v2/checkout/orders/O1': { body: order('APPROVED') }, 'POST /v2/checkout/orders/O1/capture': { body: { status: 'COMPLETED' } } });
        const r = await new PayPalProvider(() => PP_ENV, h.fn as any).confirm('O1', { ...REQ, idempotencyKey: 'k1' });
        expect(r).toMatchObject({ state: 'REAL', status: 'COMPLETED', amountCents: 1050 });
        expect(h.calls.find(c => c.url.endsWith('/capture'))!.headers['PayPal-Request-Id']).toBe('k1');
    });
    it('provider errors surface as FAILED with the provider message, never as success', async () => {
        const h = http({ ...TOKEN, 'POST /v2/checkout/orders': { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', message: 'bad', details: [{ issue: 'CURRENCY_NOT_SUPPORTED', description: 'no' }] } } });
        const r = await new PayPalProvider(() => PP_ENV, h.fn as any).initiate(REQ);
        expect(r.state).toBe('FAILED');
        expect(r.error).toContain('CURRENCY_NOT_SUPPORTED');
        const bad = http({ 'POST /v1/oauth2/token': { status: 401, body: { error: 'invalid_client' } } });
        expect((await new PayPalProvider(() => PP_ENV, bad.fn as any).status('O1')).state).toBe('FAILED');
    });
    it('status reads orders and payout batches', async () => {
        const h = http({ ...TOKEN, 'GET /v2/checkout/orders/O1': { body: order('COMPLETED') }, 'GET /v1/payments/payouts/B1': { body: { batch_header: { batch_status: 'SUCCESS' } } } });
        const p = new PayPalProvider(() => PP_ENV, h.fn as any);
        expect((await p.status('O1')).status).toBe('COMPLETED');
        expect((await p.status('payout:B1')).status).toBe('COMPLETED');
    });
    it('amount conversion handles zero-decimal currencies', () => {
        expect(toPayPalValue(1050, 'usd')).toBe('10.50');
        expect(toPayPalValue(500, 'JPY')).toBe('500');
        expect(fromPayPalValue('10.50', 'USD')).toBe(1050);
        expect(fromPayPalValue('500', 'JPY')).toBe(500);
    });
});
