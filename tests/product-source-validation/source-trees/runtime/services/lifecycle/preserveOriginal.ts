import type { Scope } from './host';

/** A bookkeeping failure is additional evidence, never a replacement for an
 * original body/construction error already selected for throw/fallback.
 * This does NOT settle a reservation whose cleanup failed. Such outstanding
 * work keeps stop pending and must fail its external supervisor honestly.
 */
export function preserveOriginal(scope: Scope, source: string, bookkeeping: () => void): void {
    try { bookkeeping(); }
    catch (additional) {
        scope.failure(source + ':BOOKKEEPING_FAILED', additional);
        scope.unknown(source + ':DISPOSITION_UNVERIFIED', true);
    }
}
