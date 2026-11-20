// No producer imports and no initialization side effects. Constructors register
// BEFORE arming resources. Once shutdown starts, late construction is refused
// before subscriptions/timers can be acquired.
export type OwnedProducer = 'narrative' | 'arbiter' | 'power';
export type ProducerStop = () => unknown | Promise<unknown>;
const producers = new Map<OwnedProducer, ProducerStop>();
let stopping = false;
let draining: Promise<Record<string, unknown>> | null = null;
export function registerOwnedProducer(name: OwnedProducer, stop: ProducerStop): void {
    if (stopping) throw new Error('PRODUCER_ADMISSION_CLOSED');
    if (producers.has(name)) throw new Error('PRODUCER_ALREADY_REGISTERED');
    producers.set(name, stop);
}
export function ownedProducerNames(): OwnedProducer[] { return [...producers.keys()]; }
export function drainOwnedProducers(): Promise<Record<string, unknown>> {
    if (draining) return draining;
    stopping = true;
    // Snapshot real owners, never import a producer to discover whether it exists.
    const owners = [...producers.entries()].sort(([a], [b]) => {
        const order = { arbiter: 0, narrative: 1, power: 2 };
        return order[a] - order[b];
    });
    draining = (async () => {
        const receipts: Record<string, unknown> = {};
        // Invoke every gate synchronously before awaiting any slow stop.
        // Otherwise a narrative tick could start while arbiter drainage waits.
        const work = owners.map(([name, stop]) => {
            try { return { name, task: Promise.resolve(stop()) }; }
            catch { return { name, task: Promise.reject(new Error('PRODUCER_STOP_FAILED')) }; }
        });
        const settled = await Promise.allSettled(work.map(entry => entry.task));
        for (let i = 0; i < work.length; i++) {
            const result = settled[i];
            receipts[work[i].name] = result.status === 'fulfilled' ? result.value : { stopFailed: true };
        }
        return receipts;
    })();
    // Only concurrent invocations share a task. Sequential retries must observe
    // current state, notably a pending journal whose earlier write failed.
    void draining.finally(() => { draining = null; });
    return draining;
}

/** Dedicated Desktop owner consumes each real stop as a separate phase and
 * drains its fanout FROM OUTSIDE that stop's ticket before touching dependents.
 * Arbiter stop/power stop do not emit product events in their current source;
 * narrative preservation is last, after final cleanup emissions are settled.
 * No cleanup imports or name-based construction. Legacy drain is unchanged. */
export function takeOwnedProducerPhases(): Array<{ name: OwnedProducer; stop: ProducerStop }> {
    if (draining) throw new Error('PRODUCER_DRAIN_ALREADY_ACTIVE');
    stopping = true;
    const order: Record<OwnedProducer, number> = { arbiter: 0, power: 1, narrative: 2 };
    return [...producers.entries()].sort(([a], [b]) => order[a] - order[b]).map(([name, stop]) => ({ name, stop }));
}
