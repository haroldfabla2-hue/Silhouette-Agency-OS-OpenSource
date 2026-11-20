import { desktopRefusal } from '../../services/lifecycle/desktopRefusal.js';
import { AsyncLocalStorage } from 'node:async_hooks';
// One process-local ownership graph. Tickets never leave this closure, are not
// accepted as arguments, and carry no identity, role or effect authority.
export function createWorkSession() {
    const context = new AsyncLocalStorage();
    const active = new Map(), owners = new Map(), debts = new Map();
    let stage = 'roots-open', next = 0, drainTask;
    const stats = owner => {
        if (!owners.has(owner)) owners.set(owner, { accepted: 0, settled: 0, rejected: 0, notStarted: 0, outcomes: {} });
        return owners.get(owner);
    };
    const admit = (owner, task, forceRoot, finalizer = false) => {
        const parent = forceRoot ? undefined : context.getStore();
        const descendant = parent && active.has(parent);
        if (stage !== 'roots-open' && !(stage === 'roots-closed' && (descendant || finalizer))) {
            stats(owner).notStarted++;
            return Promise.reject(desktopRefusal(owner, 'roots-or-lineage-closed'));
        }
        const token = Object.freeze({ id: ++next });
        let resolve, reject;
        const pending = new Promise((ok, fail) => { resolve = ok; reject = fail; });
        // Own before invoking, even synchronous fanout or reentrant stop.
        active.set(token, { owner, pending });
        stats(owner).accepted++;
        void pending.then(() => {
            stats(owner).settled++; active.delete(token);
        }, () => {
            // Rejection is a receipted result, NOT automatically uncertain
            // persistence. Durability/ownership debt is explicit via fault().
            stats(owner).settled++; stats(owner).rejected++; active.delete(token);
        });
        try { resolve(context.run(token, task)); } catch (error) { reject(error); }
        return pending;
    };
    return Object.freeze({
        rootsOpen() { return stage === 'roots-open'; },
        lineageLive() { const token = context.getStore(); return !!token && active.has(token); },
        continuation(owner) {
            const token = context.getStore();
            // Capture only internal context, never a string/token from payload.
            // Deferred queue processing remains descendant of a still-pending
            // admission promise even when invoked by a timer without context.
            return task => {
                if (!token || !active.has(token)) {
                    debts.set(owner + ':continuation-expired', { owner, reason: 'accepted-continuation-expired' });
                    return Promise.reject(new Error('DESKTOP_CONTINUATION_EXPIRED:' + owner));
                }
                return context.run(token, () => admit(owner, task, false));
            };
        },
        root(owner, task) { return admit(owner, task, true); },
        run(owner, task) { return admit(owner, task, false); },
        tick(owner, task) {
            if (stage !== 'roots-open') {
                stats(owner).notStarted++;
                return Promise.resolve({ started: false, reason: 'roots-closed' });
            }
            return admit(owner, task, true);
        },
        closeRoots() { if (stage === 'roots-open') stage = 'roots-closed'; },
        stopSources(task) {
            if (stage !== 'roots-closed') return Promise.reject(new Error('DESKTOP_ROOTS_NOT_CLOSED'));
            // Owner-issued stop notifications may themselves publish tracked
            // events. This is not a new external root or an accepted payload.
            return admit('stop-sources', task, true, true);
        },
        fault(owner, reason) { debts.set(owner + ':' + reason, { owner, reason }); },
        outcome(owner, result) {
            const values = stats(owner).outcomes;
            values[result] = (values[result] ?? 0) + 1;
        },
        drain(ms = 4000) {
            if (drainTask) return drainTask;
            drainTask = (async () => {
                if (stage !== 'roots-closed') throw new Error('DESKTOP_ROOTS_NOT_CLOSED');
                const until = Date.now() + ms;
                while (active.size) {
                    const remaining = until - Date.now();
                    if (remaining <= 0) throw new Error('DESKTOP_WORK_STILL_OWNED');
                    let timer;
                    try {
                        await Promise.race([
                            Promise.allSettled([...active.values()].map(entry => entry.pending)),
                            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DESKTOP_WORK_STILL_OWNED')), remaining); })
                        ]);
                    } finally { clearTimeout(timer); }
                }
                // No await between empty graph and seal. No outside root can
                // enter and no descendant exists without a live registered task.
                stage = 'all-settled';
                if (debts.size) throw new Error('DESKTOP_PERSISTENCE_OR_OWNERSHIP_UNRESOLVED');
            })();
            void drainTask.then(() => { drainTask = undefined; }, () => { drainTask = undefined; });
            return drainTask;
        },
        async runFinalPhase(task, ms = 4000) {
            if (stage !== 'all-settled' || active.size || debts.size) throw new Error('DESKTOP_WORK_NOT_SETTLED');
            // Owner-only finalization lane. External roots remain closed. Bus
            // fanout performed by final producers stays owned until exhausted.
            stage = 'roots-closed';
            const settled = Promise.allSettled([admit('final-phase', task, true, true)]);
            await this.drain(ms); // bounds the finalizer too, without abandoning it
            const result = await settled;
            if (result[0].status === 'rejected') {
                debts.set('final-phase:failed', { owner: 'final-phase', reason: 'release-or-producer-stop-failed' });
                throw result[0].reason;
            }
            return result[0].value;
        },
        producersPreserved() {
            if (stage !== 'all-settled' || active.size || debts.size) throw new Error('DESKTOP_WORK_NOT_SETTLED');
            stage = 'producers-preserved';
        },
        storesClosed() {
            if (stage !== 'producers-preserved') throw new Error('DESKTOP_PRODUCERS_NOT_PRESERVED');
            stage = 'stores-closed';
        },
        ownerSnapshot(owner) {
            return { ...stats(owner), active: [...active.values()].filter(entry => entry.owner === owner).length };
        },
        snapshot() { return { stage, active: active.size, debts: [...debts.values()], owners: [...owners.keys()] }; }
    });
}
