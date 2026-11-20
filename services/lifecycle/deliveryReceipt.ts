// Transport receipt only. A rejection cannot establish non-delivery. No retry,
// no model/provider dependency, no principal or permission inference.
export type DeliveryAttempt =
    | { kind: 'accepted'; id: string }
    | { kind: 'unknown'; reason: 'no-receipt'; error?: never }
    | { kind: 'unknown'; reason: 'transport-threw'; error: unknown };
export async function attemptDelivery(send: () => Promise<string | null>): Promise<DeliveryAttempt> {
    try {
        const id = await send();
        return id ? { kind: 'accepted', id } : { kind: 'unknown', reason: 'no-receipt' };
    } catch (error) {
        return { kind: 'unknown', reason: 'transport-threw', error };
    }
}
