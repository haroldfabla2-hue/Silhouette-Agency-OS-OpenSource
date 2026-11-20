import { desktopLineageLive, desktopRun } from '../../services/lifecycle/desktopWork.js';
// Optional dedicated-backend context. Registration carries actual already-
// initialized handles, never module names or dynamic cleanup import callbacks.
let registry;
export function bindStartedResources(value) {
    if (registry) throw new Error('STARTED_RESOURCES_ALREADY_BOUND');
    registry = value;
}
export function registerStarted(name, hooks) { if (registry) registry.add(name, hooks); }
export function startedResourcesBound() { return registry !== undefined; }
export function createStartedResources() {
    const entries = [], names = new Set();
    let stopping = false, registrationClosed = false, stopResult, ownershipFailed = false;
    const unresolvedHandles = [];
    return Object.freeze({
        add(name, hooks) {
            if ((stopping && (registrationClosed || !desktopLineageLive())) || typeof name !== 'string' || names.has(name) || !hooks || !['stopAdmission','settle','release','flush','close'].some(key => typeof hooks[key] === 'function')) {
                // Startup may ALREADY have created a live resource. Keep the
                // actual closure reachable, latch failure, do not call unknown
                // late stops/closes before the writer barrier. Owner termination
                // is required; throwing does NOT roll initialization back.
                ownershipFailed = true;
                unresolvedHandles.push({name,hooks});
                throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
            }
            names.add(name); entries.push({name,hooks});
            if (stopping && typeof hooks.stopAdmission === 'function') {
                // A legitimate accepted descendant may first acquire a store
                // or service after root closure. Retain it, close its ROOT
                // sources, and own that stop before returning registration.
                const lateStop = desktopRun('late-resource-stop:' + name, () => hooks.stopAdmission());
                stopResult = Promise.all([stopResult, lateStop]).then(() => undefined);
                void stopResult.catch(() => { ownershipFailed = true; });
            }
        },
        stopAdmission() {
            if (stopResult) return stopResult;
            stopping = true;
            const work = [];
            for (const entry of entries) {
                if (typeof entry.hooks.stopAdmission !== 'function') continue;
                try { work.push(Promise.resolve(entry.hooks.stopAdmission())); }
                catch { work.push(Promise.reject(new Error('RESOURCE_ADMISSION_FAILED'))); }
            }
            stopResult = Promise.allSettled(work).then(results => {
                if (results.some(r => r.status === 'rejected')) throw new Error('RESOURCE_ADMISSION_FAILED');
            });
            // Caller must await, but an ignored returned receipt isn't an
            // unhandled-rejection side effect while other work is draining.
            stopResult.catch(() => {}); return stopResult;
        },
        releasePhases() {
            registrationClosed = true;
            if (!stopping || ownershipFailed) throw new Error('RESOURCE_RELEASE_UNSAFE');
            // No invocation here. Caller runs ONE release then exhausts its
            // transferred fanout externally before starting the next release.
            const pending = entries.filter(entry => typeof entry.hooks.release === 'function');
            const phases = [];
            while (pending.length) {
                const ready = pending.findIndex(entry => (entry.hooks.releaseAfter ?? []).every(name => !pending.some(other => other.name === name)));
                if (ready < 0) throw new Error('RESOURCE_RELEASE_DEPENDENCY_CYCLE');
                const entry = pending.splice(ready, 1)[0];
                phases.push({ name: entry.name, release: entry.hooks.release });
            }
            return phases;
        },
        async finalize(barrier) {
            if (!stopping) throw new Error('RESOURCE_ADMISSION_NOT_STOPPED');
            await stopResult;
            if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
            await barrier(); // caller must prove global graph exhausted first
            // Certify all real accepted-work owners before any persistence/close.
            // One failure does not hide other still-owned work, and blocks ALL
            // later phases. Hooks must not close transports/backing stores.
            const settlements = [];
            for (const {name,hooks} of entries) {
                if (typeof hooks.settle !== 'function') continue;
                try { settlements.push({name, task: Promise.resolve(hooks.settle())}); }
                catch { settlements.push({name, task: Promise.reject(new Error('RESOURCE_SETTLE_FAILED'))}); }
            }
            const settled = await Promise.allSettled(settlements.map(entry => entry.task));
            if (settled.some(result => result.status === 'rejected')) throw new Error('RESOURCE_SETTLE_FAILED');
            if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
            // Build all dependencies before any flush/close. Missing optional
            // owner means it never registered; cycles block without closing.
            const pending = [...entries], closeOrder = [];
            while (pending.length) {
                const ready = pending.findIndex(entry => (entry.hooks.closeAfter ?? []).every(name => !pending.some(other => other.name === name)));
                if (ready < 0) throw new Error('RESOURCE_CLOSE_DEPENDENCY_CYCLE');
                closeOrder.push(pending.splice(ready, 1)[0]);
            }
            for (const phase of ['flush', 'close']) {
                let failed = false;
                for (const {hooks} of closeOrder) {
                    if (typeof hooks[phase] !== 'function') continue;
                    if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
                    try { await hooks[phase](); } catch {
                        if (phase === 'close') throw new Error('RESOURCE_CLOSE_FAILED'); // never close a dependent store
                        failed = true;
                    }
                }
                // Failed flush must not close stores underneath unknown writes.
                if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
                if (failed) throw new Error('RESOURCE_' + phase.toUpperCase() + '_FAILED');
            }
        },
        // Deliberate owner-only inspection, not serialization/logging payload.
        unresolvedForTermination() { return [...unresolvedHandles]; },
        snapshot() { return { stopping, names: [...names], ownershipFailed, unresolvedCount: unresolvedHandles.length }; }
    });
}
