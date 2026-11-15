/** Source-fixed physical receipts only. No resource access, Host, IO or API
 * authority. The SAME AbortSignal object links a manager's pending original
 * to its actual native waiter. Missing owner is not global completion proof. */
const observers = new WeakMap<AbortSignal, (receipt: Promise<void>) => void>();
export function bindOriginalOAuthSignal(signal: AbortSignal, retain: (receipt: Promise<void>) => void): void {
    if (observers.has(signal)) throw new Error('Duplicate original OAuth signal owner');
    observers.set(signal, retain);
}
export function retainOriginalOAuthPhysical(signal: AbortSignal | undefined, receipt: Promise<void>): void {
    void receipt.catch(() => undefined); // retain rejected original unchanged
    if (signal) observers.get(signal)?.(receipt);
}
