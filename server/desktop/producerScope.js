import { desktopTick, desktopRun, desktopWorkBound, desktopLineageLive, desktopOutcome } from '../../services/lifecycle/desktopWork.js';
// Optional ownership context. Unbound native CLI uses the original native timer
// APIs unchanged. Scope tracks returned promises, NOT unreturned nested work.
let owner;
export function bindProducerScope(scope) {
    if (owner) throw new Error('PRODUCER_SCOPE_ALREADY_BOUND');
    owner = scope;
}
export function producerScopeBound() { return owner !== undefined; }
export function producerAdmissionOpen() { return !owner || owner.snapshot().accepting || desktopLineageLive(); }
export function ownedWork(task) { return owner ? owner.run(task) : task(); }
export function ownedInterval(task, ms) { return owner ? owner.interval(task, ms) : setInterval(task, ms); }
export function ownedTimeout(task, ms) { return owner ? owner.timeout(task, ms) : setTimeout(task, ms); }
// A required delayed descendant is owned NOW, not when its timer fires. Unlike
// autonomous timeouts it is not canceled at root closure. Deadline failure keeps
// its promise/timer owned; only the supervisor may bound a stuck session.
export function ownedDeferred(task, ms) {
    if (!desktopWorkBound()) return setTimeout(task, ms);
    return desktopRun('producer-delayed-descendant', () => new Promise((resolve, reject) => {
        setTimeout(() => { try { resolve(task()); } catch (error) { reject(error); } }, ms);
    }));
}
export function createProducerScope() {
    let accepting = true, failed = false;
    const intervals = new Set(), timeouts = new Set(), active = new Set();
    const start = task => {
        if (!accepting) return;
        let result;
        try { result = desktopWorkBound() ? desktopTick('producer-tick', task) : task(); } catch { failed = true; return; }
        const pending = Promise.resolve(result).catch(() => { failed = true; });
        active.add(pending); pending.finally(() => active.delete(pending));
    };
    return Object.freeze({
        run(task) {
            if (!accepting && !desktopWorkBound()) return Promise.reject(new Error('PRODUCER_ADMISSION_STOPPED'));
            let result;
            try { result = desktopWorkBound() ? desktopRun('producer-work', task) : task(); } catch (error) { failed = true; throw error; }
            const pending = Promise.resolve(result);
            active.add(pending);
            pending.then(() => active.delete(pending), () => { failed = true; active.delete(pending); });
            return pending;
        },
        interval(task, ms) {
            if (!accepting) throw new Error('PRODUCER_ADMISSION_STOPPED');
            const timer = setInterval(() => start(task), ms); intervals.add(timer); return timer;
        },
        timeout(task, ms) {
            if (!accepting) throw new Error('PRODUCER_ADMISSION_STOPPED');
            const timer = setTimeout(() => { timeouts.delete(timer); start(task); }, ms); timeouts.add(timer); return timer;
        },
        stopAdmission() {
            accepting = false;
            for (const timer of intervals) clearInterval(timer);
            for (const timer of timeouts) { clearTimeout(timer); desktopOutcome('producer-timeout', 'not-started'); }
            intervals.clear(); timeouts.clear();
        },
        async drain(ms = 4000) {
            if (accepting) throw new Error('PRODUCER_ADMISSION_NOT_STOPPED');
            let timer;
            try {
                await Promise.race([
                    Promise.allSettled([...active]),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PRODUCER_INFLIGHT_UNRESOLVED')), ms); })
                ]);
            } finally { clearTimeout(timer); }
            if (failed) throw new Error('PRODUCER_TASK_FAILED');
        },
        snapshot() { return { accepting, active: active.size, timers: intervals.size + timeouts.size, failed }; }
    });
}
