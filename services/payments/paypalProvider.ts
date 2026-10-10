/**
 * PayPal provider (REST v2 Orders for collections, v1 Payouts for payouts).
 * Real HTTP against PayPal. Mode is explicit: PAYPAL_MODE=sandbox|live (no default, so nothing
 * silently runs against live). Credentials: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET.
 */
import {
    MoneyRequest, PaymentProvider, PaymentResult, PaymentStatus, ProviderMode, ProviderStatus,
} from './types';

type Env = Record<string, string | undefined>;
type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

const BASES: Record<ProviderMode, string> = {
    sandbox: 'https://api-m.sandbox.paypal.com',
    live: 'https://api-m.paypal.com',
};

/** PayPal accepts no decimals for these currencies. Everything else uses 2. */
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

export function toPayPalValue(amountCents: number, currency: string): string {
    const cur = currency.toUpperCase();
    if (ZERO_DECIMAL.has(cur)) return String(amountCents);
    return (amountCents / 100).toFixed(2);
}
export function fromPayPalValue(value: string, currency: string): number {
    const cur = currency.toUpperCase();
    const n = Number(value);
    return ZERO_DECIMAL.has(cur) ? Math.round(n) : Math.round(n * 100);
}

function mapOrderStatus(s: string | undefined): PaymentStatus {
    switch (s) {
        case 'CREATED': return 'CREATED';
        case 'PAYER_ACTION_REQUIRED': return 'PENDING_APPROVAL';
        case 'APPROVED': return 'APPROVED';
        case 'COMPLETED': return 'COMPLETED';
        case 'VOIDED': return 'CANCELED';
        default: return 'UNKNOWN';
    }
}
function mapBatchStatus(s: string | undefined): PaymentStatus {
    switch (s) {
        case 'PENDING': case 'PROCESSING': return 'PROCESSING';
        case 'SUCCESS': return 'COMPLETED';
        case 'DENIED': return 'FAILED';
        case 'CANCELED': return 'CANCELED';
        default: return 'UNKNOWN';
    }
}

export class PayPalProvider implements PaymentProvider {
    readonly id = 'paypal';
    private token: { value: string; expiresAt: number } | null = null;

    constructor(
        private readonly env: () => Env = () => process.env,
        private readonly http: FetchFn = (u, i) => fetch(u, i) as any,
        private readonly now: () => number = Date.now,
    ) {}

    providerStatus(): ProviderStatus {
        const e = this.env();
        const missing: string[] = [];
        if (!(e.PAYPAL_CLIENT_ID || '').trim()) missing.push('PAYPAL_CLIENT_ID');
        if (!(e.PAYPAL_CLIENT_SECRET || '').trim()) missing.push('PAYPAL_CLIENT_SECRET');
        const mode = (e.PAYPAL_MODE || '').trim().toLowerCase();
        if (mode !== 'sandbox' && mode !== 'live') missing.push('PAYPAL_MODE (sandbox|live)');
        const capabilities = { initiate: true, confirm: true, status: true, payout: true };
        if (missing.length) {
            return { id: this.id, label: 'PayPal', state: 'UNAVAILABLE', missing, reason: `PayPal is not configured: missing ${missing.join(', ')}`, capabilities };
        }
        return { id: this.id, label: 'PayPal', state: 'REAL', mode: mode as ProviderMode, missing: [], capabilities };
    }

    private unavailable(operation: PaymentResult['operation']): PaymentResult {
        const s = this.providerStatus();
        return { provider: this.id, state: 'UNAVAILABLE', operation, error: s.reason, missing: s.missing };
    }

    private failed(operation: PaymentResult['operation'], mode: ProviderMode, error: string): PaymentResult {
        return { provider: this.id, state: 'FAILED', mode, operation, error };
    }

    private async accessToken(mode: ProviderMode): Promise<string> {
        if (this.token && this.token.expiresAt > this.now() + 30_000) return this.token.value;
        const e = this.env();
        const basic = Buffer.from(`${e.PAYPAL_CLIENT_ID}:${e.PAYPAL_CLIENT_SECRET}`).toString('base64');
        const res = await this.http(`${BASES[mode]}/v1/oauth2/token`, {
            method: 'POST',
            headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials',
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || !body.access_token) {
            throw new Error(`PayPal authentication failed (HTTP ${res.status}): ${body.error_description || body.error || 'no access_token'}`);
        }
        this.token = { value: body.access_token, expiresAt: this.now() + Number(body.expires_in || 300) * 1000 };
        return this.token.value;
    }

    private async call(mode: ProviderMode, method: string, path: string, body?: any, requestId?: string): Promise<{ status: number; ok: boolean; body: any }> {
        const token = await this.accessToken(mode);
        const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        if (requestId) headers['PayPal-Request-Id'] = requestId;
        const res = await this.http(`${BASES[mode]}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const parsed: any = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok, body: parsed };
    }

    private errText(r: { status: number; body: any }): string {
        const b = r.body || {};
        const detail = Array.isArray(b.details) && b.details[0] ? `${b.details[0].issue || ''} ${b.details[0].description || ''}`.trim() : '';
        return `PayPal HTTP ${r.status}: ${b.message || b.name || 'error'}${detail ? ` (${detail})` : ''}`;
    }

    async initiate(req: MoneyRequest): Promise<PaymentResult> {
        const st = this.providerStatus();
        if (st.state !== 'REAL') return this.unavailable('initiate');
        const mode = st.mode!;
        try {
            const r = await this.call(mode, 'POST', '/v2/checkout/orders', {
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: { currency_code: req.currency.toUpperCase(), value: toPayPalValue(req.amountCents, req.currency) },
                    description: req.purpose?.slice(0, 127),
                    custom_id: req.reference?.slice(0, 127),
                }],
            }, req.idempotencyKey);
            if (!r.ok) return this.failed('initiate', mode, this.errText(r));
            const approve = (r.body.links || []).find((l: any) => l.rel === 'payer-action' || l.rel === 'approve');
            return {
                provider: this.id, state: 'REAL', mode, operation: 'initiate', id: r.body.id,
                status: approve ? 'PENDING_APPROVAL' : mapOrderStatus(r.body.status),
                approvalUrl: approve?.href, amountCents: req.amountCents, currency: req.currency.toUpperCase(),
            };
        } catch (e: any) {
            return this.failed('initiate', mode, String(e?.message || e));
        }
    }

    async status(id: string): Promise<PaymentResult> {
        const st = this.providerStatus();
        if (st.state !== 'REAL') return this.unavailable('status');
        const mode = st.mode!;
        try {
            // Payout batches are "PAYOUTS-..." style ids from our own payout(); orders are plain ids.
            const isPayout = id.startsWith('payout:');
            const r = isPayout
                ? await this.call(mode, 'GET', `/v1/payments/payouts/${encodeURIComponent(id.slice(7))}`)
                : await this.call(mode, 'GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);
            if (!r.ok) return this.failed('status', mode, this.errText(r));
            if (isPayout) {
                const h = r.body.batch_header || {};
                return { provider: this.id, state: 'REAL', mode, operation: 'status', id, status: mapBatchStatus(h.batch_status) };
            }
            const unit = (r.body.purchase_units || [])[0]?.amount;
            return {
                provider: this.id, state: 'REAL', mode, operation: 'status', id, status: mapOrderStatus(r.body.status),
                amountCents: unit ? fromPayPalValue(unit.value, unit.currency_code) : undefined, currency: unit?.currency_code,
            };
        } catch (e: any) {
            return this.failed('status', mode, String(e?.message || e));
        }
    }

    async confirm(id: string, expected: MoneyRequest): Promise<PaymentResult> {
        const st = this.providerStatus();
        if (st.state !== 'REAL') return this.unavailable('confirm');
        const mode = st.mode!;
        try {
            // Re-read the order and refuse to capture anything that differs from what was approved.
            const cur = await this.call(mode, 'GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);
            if (!cur.ok) return this.failed('confirm', mode, this.errText(cur));
            const unit = (cur.body.purchase_units || [])[0]?.amount;
            if (!unit || fromPayPalValue(unit.value, unit.currency_code) !== expected.amountCents
                || String(unit.currency_code).toUpperCase() !== expected.currency.toUpperCase()) {
                return this.failed('confirm', mode, 'Refused: the order amount/currency does not match what was approved. Nothing was captured.');
            }
            if (cur.body.status === 'COMPLETED') {
                return { provider: this.id, state: 'REAL', mode, operation: 'confirm', id, status: 'COMPLETED', amountCents: expected.amountCents, currency: expected.currency.toUpperCase() };
            }
            if (cur.body.status !== 'APPROVED') {
                return this.failed('confirm', mode, `Order is ${cur.body.status}; the payer has not approved it yet. Nothing was captured.`);
            }
            const cap = await this.call(mode, 'POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, undefined, expected.idempotencyKey);
            if (!cap.ok) return this.failed('confirm', mode, this.errText(cap));
            const done = cap.body.status === 'COMPLETED';
            return {
                provider: this.id, state: done ? 'REAL' : 'FAILED', mode, operation: 'confirm', id, status: mapOrderStatus(cap.body.status),
                amountCents: expected.amountCents, currency: expected.currency.toUpperCase(),
                error: done ? undefined : `Capture finished with status ${cap.body.status}`,
            };
        } catch (e: any) {
            return this.failed('confirm', mode, String(e?.message || e));
        }
    }

    async payout(req: MoneyRequest): Promise<PaymentResult> {
        const st = this.providerStatus();
        if (st.state !== 'REAL') return this.unavailable('payout');
        const mode = st.mode!;
        try {
            const batchId = (req.idempotencyKey || `b-${this.now()}`).slice(0, 30);
            const r = await this.call(mode, 'POST', '/v1/payments/payouts', {
                sender_batch_header: { sender_batch_id: batchId, email_subject: (req.purpose || 'Payment').slice(0, 100) },
                items: [{
                    recipient_type: 'EMAIL',
                    receiver: req.destination,
                    amount: { value: toPayPalValue(req.amountCents, req.currency), currency: req.currency.toUpperCase() },
                    note: req.purpose?.slice(0, 160),
                    sender_item_id: (req.reference || batchId).slice(0, 63),
                }],
            });
            if (!r.ok) return this.failed('payout', mode, this.errText(r));
            const h = r.body.batch_header || {};
            return {
                provider: this.id, state: 'REAL', mode, operation: 'payout', id: `payout:${h.payout_batch_id}`,
                status: mapBatchStatus(h.batch_status), amountCents: req.amountCents, currency: req.currency.toUpperCase(),
            };
        } catch (e: any) {
            return this.failed('payout', mode, String(e?.message || e));
        }
    }
}
