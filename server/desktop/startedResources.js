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
    let stopping = false, stopResult, ownershipFailed = false;
    const unresolvedHandles = [];
    return Object.freeze({
        add(name, hooks) {
            if (stopping || typeof name !== 'string' || names.has(name) || !hooks || !['stopAdmission','flush','close'].some(key => typeof hooks[key] === 'function')) {
                // Startup may ALREADY have created a live resource. Keep the
                // actual closure reachable, latch failure, do not call unknown
                // late stops/closes before the writer barrier. Owner termination
                // is required; throwing does NOT roll initialization back.
                ownershipFailed = true;
                unresolvedHandles.push({name,hooks});
                throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
            }
            names.add(name); entries.push({name,hooks});
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
        async finalize(barrier) {
            if (!stopping) throw new Error('RESOURCE_ADMISSION_NOT_STOPPED');
            await stopResult;
            if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
            await barrier(); // Failure blocks flush/close, never race active writers.
            if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
            for (const phase of ['flush', 'close']) {
                let failed = false;
                for (const {hooks} of entries) {
                    if (typeof hooks[phase] !== 'function') continue;
                    if (ownershipFailed) throw new Error('STARTED_RESOURCE_OWNERSHIP_UNRESOLVED');
                    try { await hooks[phase](); } catch { failed = true; }
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
