import { desktopWorkBound, desktopRun, desktopRoot, desktopOwnerSnapshot } from '../../services/lifecycle/desktopWork.js';
// Per-owner admission receipt over ONE shared Desktop graph. The gate does not
// own an AsyncLocalStorage and cannot invent lineage from a payload.
export function createWriterGate(label) {
    let accepting = true;
    const active = new Set();
    return Object.freeze({
        run(task) {
            if (desktopWorkBound()) return desktopRun(label, task);
            if (!accepting) return Promise.reject(new Error(label + '_ADMISSION_STOPPED'));
            let resolve, reject;
            const pending = new Promise((ok, fail) => { resolve = ok; reject = fail; });
            active.add(pending);
            void pending.then(() => active.delete(pending), () => active.delete(pending));
            try { resolve(task()); } catch (error) { reject(error); }
            return pending;
        },
        root(task) {
            return desktopWorkBound() ? desktopRoot(label, task) : this.run(task);
        },
        stopAdmission() { accepting = false; },
        async drain(_ms = 4000) {
            if (accepting) throw new Error(label + '_ADMISSION_OPEN');
            // This is certification AFTER the global graph barrier, not an
            // independent snapshot that can seal while another owner is live.
            const snapshot = desktopOwnerSnapshot(label);
            if ((snapshot?.active ?? active.size) !== 0) throw new Error(label + '_INFLIGHT_UNRESOLVED');
            return { accepting, ...(snapshot ?? { active: active.size }) };
        },
        snapshot() { return { accepting, ...(desktopOwnerSnapshot(label) ?? { active: active.size }) }; }
    });
}
