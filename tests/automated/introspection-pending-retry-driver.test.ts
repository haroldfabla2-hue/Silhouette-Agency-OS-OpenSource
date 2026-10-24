/**
 * Dedicated coverage for the pending-concept-write retry driver (auditor
 * requirement on 6f31ee6): the driver is a new operational guarantee, so it
 * is tested directly, not only through the direct drain path.
 *
 * Timer strategy (declared): REAL timers with the interval shortened to
 * 50ms via the engine's static config, instead of a fake clock. Reason: the
 * engine's constructor chain progresses through vite SSR dynamic imports,
 * which do not complete under a fully faked clock (the import graph itself
 * freezes); a short REAL interval exercises the actual guarantee - a real
 * timer ticking a real drain - with deterministic waitFor assertions.
 *
 * Isolation (declared): each test mutates the private statics via `as any`
 * (PENDING_RETRY_INTERVAL_MS, PENDING_WRITES_KEY) and constructs a FRESH
 * IntrospectionEngine, so the module singleton (constructed at import with
 * the default key/interval) never shares a journal with the test instance.
 *
 * Doubled (declared): ONLY the continuumMemory module export (controllable
 * binding) and the geminiService boundary. Journal (SQLite per-worker tmp),
 * drain, guard and driver are real.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ binding: undefined as any }));
vi.mock('../../services/continuumMemory', () => ({
    get continuum() { return mocks.binding; }
}));
vi.mock('../../services/geminiService', () => ({
    generateEmbedding: vi.fn().mockRejectedValue(new Error('test boundary: embeddings not available in this harness')),
}));

let keySeq = 0;
const engines: any[] = [];

async function freshEngine(intervalMs = 50) {
    // Black-hole binding during module import: the module SINGLETON (built at
    // import with the default key/interval) settles its constructor write
    // against this sink and never touches the test's spy or journal keys.
    mocks.binding = { store: async () => ({ ok: true }), retrieve: async () => [] };
    const mod = await import('../../services/introspectionEngine');
    await new Promise(r => setTimeout(r, 100)); // let singleton chains settle
    (mod.IntrospectionEngine as any).PENDING_RETRY_INTERVAL_MS = intervalMs;
    (mod.IntrospectionEngine as any).PENDING_WRITES_KEY = `test_pending_concept_writes_${Date.now()}_${keySeq++}`;
    const engine = new mod.IntrospectionEngine();
    engines.push(engine);
    return engine;
}

async function waitFor(cond: () => boolean, ms = 8000, step = 25): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (cond()) return;
        await new Promise(r => setTimeout(r, step));
    }
    throw new Error('waitFor timeout');
}

afterEach(() => {
    while (engines.length > 0) engines.pop()!.stopPendingRetryDriver();
    vi.resetModules();
    mocks.binding = undefined;
    vi.restoreAllMocks();
});

describe('pending concept-write retry driver (shortened real interval)', () => {
    it('retries a journaled write after a store failure when the interval ticks', async () => {
        const store = vi.fn()
            .mockRejectedValueOnce(new Error('transient store failure'))
            .mockResolvedValue({ ok: true });

        const engine = await freshEngine();
        mocks.binding = { store, retrieve: vi.fn().mockResolvedValue([]) };
        await waitFor(() => store.mock.calls.length === 1); // first drain: fails
        expect(engine.getPendingContinuumWriteCount()).toBe(1); // journaled, not dropped

        await waitFor(() => store.mock.calls.length >= 2); // driver tick retried
        await waitFor(() => engine.getPendingContinuumWriteCount() === 0); // ACKed on retry
    }, 20000);

    it('does nothing while the journal is empty', async () => {
        const store = vi.fn().mockResolvedValue({ ok: true });

        const engine = await freshEngine();
        mocks.binding = { store, retrieve: vi.fn().mockResolvedValue([]) };
        await waitFor(() => engine.getPendingContinuumWriteCount() === 0);
        await waitFor(() => store.mock.calls.length >= 1); // constructor entry drained
        const callsAfterDrain = store.mock.calls.length;

        await new Promise(r => setTimeout(r, 220)); // ~4 ticks at 50ms
        expect(store.mock.calls.length).toBe(callsAfterDrain); // no extra stores
    }, 20000);

    it('stopPendingRetryDriver stops further retries (teardown)', async () => {
        const store = vi.fn().mockRejectedValue(new Error('persistent failure'));

        const engine = await freshEngine();
        mocks.binding = { store, retrieve: vi.fn().mockResolvedValue([]) };
        await waitFor(() => store.mock.calls.length === 1);
        expect(engine.getPendingContinuumWriteCount()).toBe(1);

        engine.stopPendingRetryDriver();
        await new Promise(r => setTimeout(r, 220)); // would be ~4 ticks
        expect(store.mock.calls.length).toBe(1); // no retry happened
        expect(engine.getPendingContinuumWriteCount()).toBe(1); // still journaled, visible
    }, 20000);

    it('never runs two drains concurrently (guard race: entry appended mid-drain)', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const gates: Array<() => void> = [];
        const store = vi.fn().mockImplementation(async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise<void>(resolve => gates.push(resolve)); // held until released
            inFlight--;
            return { ok: true };
        });
        const engine = await freshEngine(60_000); // driver inert: test the guard, not the tick
        mocks.binding = { store, retrieve: vi.fn().mockResolvedValue([]) };
        await waitFor(() => store.mock.calls.length === 1); // drain in-flight, store #1 held

        // Guard race: journal a second entry and poke the drain while the
        // first drain is still held - the guard must serialize, not overlap.
        await (engine as any).journalContinuumWrite('[INTROSPECTION] Injected Concept Vector: Race (Str: 1)', ['system', 'concept-vector']);
        await (engine as any).drainPendingContinuumWrites();
        expect(maxInFlight).toBe(1);

        while (gates.length > 0) { gates.shift()!(); await new Promise(r => setTimeout(r, 25)); }
        await waitFor(() => engine.getPendingContinuumWriteCount() === 0);
        expect(store.mock.calls.length).toBe(2); // each entry stored exactly once
        expect(maxInFlight).toBe(1);
    }, 20000);
});
