import { AdmissionClosed, CapacityExceeded, OwnershipConflict, type ChildReservation } from './host';
import { dreamerOwner } from './preparationBindings';

/** Pure source-fixed admission. Never imports/constructs Dreamer or stores content.
 * Tokens are exact original notification branches, not permission for new work.
 */
declare const notificationBrand: unique symbol;
export type ContinuumDreamerNotification = Readonly<{ [notificationBrand]: true }>;
declare const claimBrand: unique symbol;
export type ClaimedContinuumNotification = Readonly<{ [claimBrand]: true }>;
type Entry = { child: ChildReservation; phase: 'RESERVED' | 'CLAIMED' | 'RUNNING'; done: Promise<void>; finish: () => void; token: ContinuumDreamerNotification; claim?: ClaimedContinuumNotification };
const entries = new Map<ContinuumDreamerNotification, Entry>();
const claims = new Map<ClaimedContinuumNotification, Entry>();
const LIMIT = 128;
let cancelled = false;
function reserve(source: 'initial-concept-notification' | 'initial-identity-notification' | 'canonical-store-notification'): ContinuumDreamerNotification {
    if (cancelled) throw new AdmissionClosed('continuum-dreamer-notification-after-producer-cancel');
    if (entries.size >= LIMIT) throw new CapacityExceeded('continuum-dreamer-notification');
    const owner = dreamerOwner();
    const child = owner.invoke(source, operation => owner.reserveChild(operation, source + ':accepted-effect'));
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const token = Object.freeze({}) as ContinuumDreamerNotification;
    entries.set(token, { child, phase: 'RESERVED', done, finish, token });
    return token;
}
export function reserveInitialConceptNotification(): ContinuumDreamerNotification { return reserve('initial-concept-notification'); }
export function reserveInitialIdentityNotification(): ContinuumDreamerNotification { return reserve('initial-identity-notification'); }
export function reserveCanonicalStoreNotification(): ContinuumDreamerNotification { return reserve('canonical-store-notification'); }
function exact(token: ContinuumDreamerNotification, phase: Entry['phase']): Entry {
    const entry = entries.get(token);
    if (!entry || entry.phase !== phase) throw new OwnershipConflict('Foreign, replayed or wrong-phase continuum notification');
    return entry;
}
/** Acquire exact exclusive disposition authority before capacity/first await.
 * A replay of token T cannot acquire/dispose the first invocation's claim C.
 */
export function claimContinuumNotification(token: ContinuumDreamerNotification): ClaimedContinuumNotification {
    const entry = exact(token, 'RESERVED');
    const claim = Object.freeze({}) as ClaimedContinuumNotification;
    entry.phase = 'CLAIMED'; entry.claim = claim; claims.set(claim, entry); return claim;
}
function exactClaim(claim: ClaimedContinuumNotification, phase: Entry['phase']): Entry {
    const entry = claims.get(claim);
    if (!entry || entry.claim !== claim || entry.phase !== phase) throw new OwnershipConflict('Foreign, replayed or wrong-phase notification claim');
    return entry;
}
/** Receiver alone consumes the actual store invocation's exclusive claim. */
export function takeContinuumNotification(claim: ClaimedContinuumNotification): ChildReservation {
    const entry = exactClaim(claim, 'CLAIMED'); entry.phase = 'RUNNING'; return entry.child;
}
function retire(entry: Entry): void {
    entries.delete(entry.token); if (entry.claim) claims.delete(entry.claim); entry.finish();
}
export function finishContinuumNotification(claim: ClaimedContinuumNotification): void { retire(exactClaim(claim, 'RUNNING')); }
function disposable(owner: ContinuumDreamerNotification | ClaimedContinuumNotification): Entry {
    const reserved = entries.get(owner as ContinuumDreamerNotification);
    if (reserved?.phase === 'RESERVED') return reserved;
    return exactClaim(owner as ClaimedContinuumNotification, 'CLAIMED');
}
/** Real original guard only. Claimed token cannot dispose another invocation. */
export function skipContinuumNotification(owner: ContinuumDreamerNotification | ClaimedContinuumNotification): void {
    const entry = disposable(owner);
    dreamerOwner().skipChild(entry.child, 'ORIGINAL_GUARD_NOT_SELECTED'); retire(entry);
}
/** Failure requires exact exclusive claim or still-unhanded original reservation. */
export function abandonContinuumNotification(owner: ContinuumDreamerNotification | ClaimedContinuumNotification, original: unknown): void {
    const entry = disposable(owner);
    dreamerOwner().abandonChild(entry.child, original); retire(entry);
}
export function failUnconsumedContinuumNotification(claim: ClaimedContinuumNotification, original: unknown): void {
    const entry = claims.get(claim);
    if (entry?.phase === 'CLAIMED') abandonContinuumNotification(claim, original);
}
export function cancelNewContinuumNotifications(): void { cancelled = true; }
/** Admission is closed synchronously before snapshot. No polling-to-empty. */
export async function joinAcceptedContinuumNotifications(): Promise<void> {
    cancelNewContinuumNotifications();
    await Promise.all([...entries.values()].map(entry => entry.done));
}
