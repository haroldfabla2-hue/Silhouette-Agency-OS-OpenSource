/**
 * Payment / irreversible-commitment detection for browser clicks.
 * Pure functions, no I/O. Used as a hard gate in front of every click path.
 */

export interface ClickDescriptor {
    /** Natural-language instruction, when the click came from act(). */
    instruction?: string;
    /** Visible text, aria-label, value or placeholder of the element being clicked. */
    elementText?: string;
    /** input type / button type, when known. */
    elementType?: string;
    url?: string;
    /** True when the element could not be identified (fail-closed signal). */
    elementUnknown?: boolean;
}

// Word-boundary matched, English and Spanish.
const COMMIT_PATTERNS: RegExp[] = [
    /\bpay(?:ment)?\b/i, /\bpay\s*now\b/i, /\bbuy\b/i, /\bpurchase\b/i, /\bcheckout\b/i, /\bcheck\s*out\b/i,
    /\bplace\s+(?:your\s+)?order\b/i, /\bcomplete\s+(?:order|purchase)\b/i, /\bconfirm\s+(?:order|payment|purchase)\b/i,
    /\bsubscribe\b/i, /\bdonate\b/i, /\bsend\s+money\b/i, /\btransfer\b/i, /\bwithdraw\b/i,
    /\bdelete\s+(?:my\s+)?account\b/i, /\bsubmit\s+(?:order|payment)\b/i, /\bcredit\s+card\b/i,
    /\bpagar\b/i, /\bpago\b/i, /\bcomprar\b/i, /\bcompra\b/i, /\bfinalizar\s+(?:compra|pedido)\b/i,
    /\bconfirmar\s+(?:pedido|pago|compra)\b/i, /\btransferir\b/i, /\bretirar\b/i, /\bsuscribir/i, /\bdonar\b/i,
];

const CHECKOUT_URL = /(checkout|payment|\bpay\b|billing|purchase|\/cart|pago|compra|pedido|order[-_/]?(?:review|confirm))/i;

export function textLooksLikeCommitment(text: string | undefined): boolean {
    if (!text) return false;
    return COMMIT_PATTERNS.some(r => r.test(text));
}

export function isCheckoutUrl(url: string | undefined): boolean {
    return !!url && CHECKOUT_URL.test(url);
}

/**
 * Fail-closed decision. True means: do NOT click without a human approval grant.
 * - commitment wording in the instruction or the element
 * - submit-type element on a checkout/payment URL
 * - unidentifiable element on a checkout/payment URL
 */
export function requiresPaymentApproval(d: ClickDescriptor): boolean {
    if (textLooksLikeCommitment(d.instruction) || textLooksLikeCommitment(d.elementText)) return true;
    if (isCheckoutUrl(d.url)) {
        if (d.elementUnknown) return true;
        if ((d.elementType || '').toLowerCase() === 'submit') return true;
    }
    return false;
}
