import type { Scope, Operation } from './host';
import { preserveOriginal } from './preserveOriginal';
import type { ProtocolEvent } from '../../types';
import { SystemProtocol } from '../../types';

type Handler = (event: ProtocolEvent) => void;
const admitted = new WeakMap<Handler, { requestId: string; deliver: Handler }>();

/** One fixed HELP_RESPONSE branch of a request already admitted while OPEN.
 * This is not an entitlement for new subscriptions, event types, or requests.
 * Scope/operation/source topology are internal trusted source, not caller auth.
 */
export function reserveCorrelatedHelpResponse(scope: Scope, operation: Operation,
    requestId: string, originalHandler: Handler): { handler: Handler; cancel: () => void } {
    const reservation = scope.reserveChild(operation, 'original-correlated-help-response');
    let taken = false;
    const handler: Handler = event => {
        if (taken || event.type !== SystemProtocol.HELP_RESPONSE || event.payload?.requestId !== requestId) return;
        taken = true; admitted.delete(handler);
        return scope.invokeChild(reservation, () => originalHandler(event));
    };
    admitted.set(handler, { requestId, deliver: handler });
    return { handler, cancel: () => {
        if (taken) return;
        // The original timeout or explicit unsubscribe selected no response.
        // Never skip an invoked callback or fabricate an answer.
        preserveOriginal(scope, 'help-response-original-no-delivery', () => {
            scope.skipChild(reservation, 'ORIGINAL_GUARD_NOT_SELECTED');
            taken = true; admitted.delete(handler);
        });
    } };
}

/** Adapters may pass only their actual original handler+incoming event. No new
 * root operation is created while sealed. The original handler is invoked
 * inline exactly when the already-admitted correlated event matches.
 */
export function deliverReservedHelpResponse(handler: Handler, event: ProtocolEvent): boolean {
    const record = admitted.get(handler);
    if (!record || event.type !== SystemProtocol.HELP_RESPONSE || event.payload?.requestId !== record.requestId) return false;
    record.deliver(event); return true;
}
