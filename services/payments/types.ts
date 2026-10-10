/**
 * Common contract for payment / collection providers.
 *
 * Money rules (enforced by PaymentGateway, not by the providers):
 *  - every money-moving operation needs a single-use human approval grant bound to
 *    EXECUTE_PAYMENT + provider + direction + destination + amount + currency;
 *  - a provider without credentials reports UNAVAILABLE and is never asked to do anything;
 *  - nothing is simulated: a result is REAL (provider answered), FAILED (provider refused/errored)
 *    or UNAVAILABLE (nothing attempted).
 */

export type ProviderState = 'REAL' | 'UNAVAILABLE';
export type ProviderMode = 'sandbox' | 'live';
export type Direction = 'collect' | 'payout';

export interface MoneyRequest {
    /** Minor units (cents). Positive integer. */
    amountCents: number;
    /** ISO 4217 code. */
    currency: string;
    /**
     * Counterparty: payee email for a payout, payer/customer label for a collection.
     * Part of the approval binding, so a grant cannot be reused for a different counterparty.
     */
    destination: string;
    purpose?: string;
    reference?: string;
    /** Set by the gateway; providers pass it to the upstream API as an idempotency key. */
    idempotencyKey?: string;
}

export type PaymentStatus =
    | 'CREATED'            // order/batch created, nothing moved
    | 'PENDING_APPROVAL'   // waiting for the payer to approve on the provider
    | 'APPROVED'           // payer approved, ready to capture
    | 'PROCESSING'
    | 'COMPLETED'
    | 'CANCELED'
    | 'FAILED'
    | 'UNKNOWN';

export interface PaymentResult {
    provider: string;
    /** REAL = the provider answered; FAILED = attempted and failed; UNAVAILABLE = not attempted. */
    state: 'REAL' | 'FAILED' | 'UNAVAILABLE';
    mode?: ProviderMode;
    operation: 'initiate' | 'confirm' | 'status' | 'payout';
    id?: string;
    status?: PaymentStatus;
    /** Where the payer must go to approve (collections). */
    approvalUrl?: string;
    amountCents?: number;
    currency?: string;
    error?: string;
    missing?: string[];
    /** True when the human approval gate blocked the operation. */
    securityGated?: boolean;
}

export interface ProviderStatus {
    id: string;
    label: string;
    state: ProviderState;
    mode?: ProviderMode;
    /** Environment variables to set to reach REAL. */
    missing: string[];
    reason?: string;
    capabilities: { initiate: boolean; confirm: boolean; status: boolean; payout: boolean };
}

export interface PaymentProvider {
    readonly id: string;
    providerStatus(): ProviderStatus;
    /** Create a collection (cobro). Moves no money by itself. */
    initiate(req: MoneyRequest): Promise<PaymentResult>;
    /** Capture an approved collection. `expected` must match what the provider holds, or nothing is captured. */
    confirm(id: string, expected: MoneyRequest): Promise<PaymentResult>;
    status(id: string): Promise<PaymentResult>;
    /** Send money out to `destination`. */
    payout(req: MoneyRequest): Promise<PaymentResult>;
}
