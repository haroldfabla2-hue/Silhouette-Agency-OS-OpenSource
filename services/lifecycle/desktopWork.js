// Browser-safe binding. No Node imports, no payload-derived tickets. Only the
// dedicated Desktop owner binds a session before importing product modules.
// Lifecycle lineage is NOT authentication or permission for effects.
let session;
export function bindDesktopWork(value) {
    if (session) throw new Error('DESKTOP_WORK_ALREADY_BOUND');
    session = value;
}
export function desktopWorkBound() { return session !== undefined; }
export function desktopRootsOpen() { return !session || session.rootsOpen(); }
export function desktopRun(owner, task) { return session ? session.run(owner, task) : task(); }
export function desktopRoot(owner, task) { return session ? session.root(owner, task) : task(); }
export function desktopTick(owner, task) {
    return session ? session.tick(owner, task) : task();
}
export function desktopFault(owner, reason) { session?.fault(owner, reason); }
export function desktopOutcome(owner, result) { session?.outcome(owner, result); }
export function desktopOwnerSnapshot(owner) { return session?.ownerSnapshot(owner); }
export function desktopLineageLive() { return session?.lineageLive() ?? false; }
export function desktopContinuation(owner) {
    return session ? session.continuation(owner) : task => task();
}
