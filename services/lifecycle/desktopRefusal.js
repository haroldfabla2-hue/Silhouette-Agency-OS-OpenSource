// Non-admission is evidence that a callback never ran, not a failed write.
// Identity is module-private. External payloads/error strings cannot forge it.
const refusals = new WeakSet();
export function desktopRefusal(owner, reason) {
    const error = new Error('DESKTOP_NOT_ADMITTED:' + owner + ':' + reason);
    refusals.add(error);
    return error;
}
export function isDesktopRefusal(error) {
    return typeof error === 'object' && error !== null && refusals.has(error);
}
