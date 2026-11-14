import type { Capacity } from '../services/lifecycle/host';

/** Explicit proposed browser-session limits, not measured safe high-water
 * values and never a backend capacity grant. A limit violation stays a failure.
 * No env secrets, server runtime import or implicit ownership fallback.
 */
export const browserOwnershipCapacity: Capacity = Object.freeze({
    scopes: 128,
    active: 512,
    failures: 64,
    resources: 256,
});
