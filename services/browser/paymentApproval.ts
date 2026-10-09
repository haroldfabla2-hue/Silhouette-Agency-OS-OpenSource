import crypto from 'crypto';
import type { ClickDescriptor } from './paymentGate';

/**
 * Default human-approval path for payment/commitment clicks, shared by every browser engine.
 * Routes through the ActionExecutor: a single-use grant bound to EXECUTE_PAYMENT + this destination.
 * Returning false (or throwing in the caller) blocks the click.
 */
export async function defaultPaymentApproval(d: ClickDescriptor): Promise<boolean> {
    const { actionExecutor } = await import('../actionExecutor');
    let host = '';
    try { host = new URL(d.url || '').host; } catch { /* unknown host */ }
    const binding = { type: 'EXECUTE_PAYMENT', destination: host };
    const grant = await actionExecutor.requestApproval({
        id: crypto.randomUUID(),
        agentId: 'visual-browser',
        type: 'EXECUTE_PAYMENT' as any,
        payload: { url: d.url, prompt: d.instruction || d.elementText } as any,
        status: 'PENDING' as any,
        requiresApproval: true,
        timestamp: Date.now()
    }, binding, `Browser click on a payment/commitment control at ${host || 'unknown site'}: "${d.instruction || d.elementText || 'unidentified element'}"`);
    return !!grant && actionExecutor.verifyApproval(grant.token, binding).ok;
}
