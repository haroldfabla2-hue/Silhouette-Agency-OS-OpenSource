/**
 * Root-cause coverage for the audit finding on PR #204 review: the
 * IntrospectionEngine constructor persists a concept and loads goals via
 * fire-and-forget dynamic imports of continuumMemory. During module restarts
 * (vi.resetModules) the import can resolve while the `continuum` export
 * binding is still uninitialized; the old code dereferenced undefined and
 * lost the write behind a misleading "Failed to persist concept" storage
 * error (non-fatal log noise).
 *
 * The fix waits for the binding (module lifecycle) and classifies the
 * outcome honestly; these tests drive that lifecycle deterministically.
 *
 * Doubled (declared): ONLY the continuumMemory module export (a controllable
 * binding). The introspection module under test is real.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// vi.hoisted: the mock factory and the test body MUST share one binding
// holder - a plain `let` can diverge between the factory's module scope and
// the test scope when the mocked namespace is served to other modules.
const mocks = vi.hoisted(() => ({ binding: undefined as any }));
vi.mock('../../services/continuumMemory', () => ({
    get continuum() { return mocks.binding; }
}));
// Declared harness boundary: geminiService pulls consciousnessEngine, which
// dereferences continuum.getIdentityNodes during identity init - it is not
// the unit under test and must not consume the partial continuum double.
vi.mock('../../services/geminiService', () => ({
    generateEmbedding: vi.fn().mockRejectedValue(new Error('test boundary: embeddings not available in this harness')),
}));

async function waitFor(cond: () => boolean, ms = 5000, step = 25): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (cond()) return;
        await new Promise(r => setTimeout(r, step));
    }
    throw new Error('waitFor timeout');
}

afterEach(() => {
    vi.resetModules();
    mocks.binding = undefined;
    vi.restoreAllMocks();
});

describe('introspection constructor persistence across module lifecycle', () => {
    it('defers the constructor concept write until the continuum binding initializes', async () => {
        const store = vi.fn().mockResolvedValue({ ok: true });
        const retrieve = vi.fn().mockResolvedValue([]);
        const errors: any[] = [];
        vi.spyOn(console, 'error').mockImplementation((...a: any[]) => { errors.push(a); });

        mocks.binding = undefined; // continuum module mid-evaluation
        const mod = await import('../../services/introspectionEngine');
        expect(mod.introspection).toBeTruthy();

        // Several ticks with the binding uninitialized: no write happens, and
        // crucially no misleading storage error is logged while waiting.
        await new Promise(r => setTimeout(r, 200));
        expect(store).not.toHaveBeenCalled();
        expect(errors.flat().join(' ')).not.toContain('Failed to persist concept');

        // The module finishes initializing: the deferred write lands.
        mocks.binding = { store, retrieve };
        await waitFor(() => store.mock.calls.length > 0);
        expect(String(store.mock.calls[0][0])).toContain('Ethical Alignment');
        expect(errors.flat().join(' ')).not.toContain('Failed to persist concept');
    }, 15000);

    it('classifies a never-initialized continuum as module lifecycle, not storage failure', async () => {
        const errors: any[] = [];
        vi.spyOn(console, 'error').mockImplementation((...a: any[]) => { errors.push(a); });

        mocks.binding = undefined; // never initializes
        await import('../../services/introspectionEngine');

        await waitFor(() => errors.flat().join(' ').includes('module-lifecycle wait'), 10000);
        const text = errors.flat().join(' ');
        expect(text).toContain('module-lifecycle wait');
        expect(text).toContain('NOT a storage failure');
        expect(text).not.toContain('Failed to persist concept');

        // Retryable + visible: the exhausted write is journaled, never dropped,
        // and drains on the next successful continuum access.
        const { introspection } = await import('../../services/introspectionEngine');
        expect(introspection.getPendingContinuumWriteCount()).toBeGreaterThan(0);
        const store = vi.fn().mockResolvedValue({ ok: true });
        mocks.binding = { store, retrieve: vi.fn().mockResolvedValue([]) };
        introspection.injectConcept('Trigger Drain');
        await waitFor(() => store.mock.calls.length >= 2);
        const written = store.mock.calls.map(c => String(c[0]));
        expect(written.some(w => w.includes('Ethical Alignment'))).toBe(true);
        expect(written.some(w => w.includes('Trigger Drain'))).toBe(true);
        await waitFor(() => introspection.getPendingContinuumWriteCount() === 0);
    }, 20000);

    it('journal-first: a journaled write survives a module restart and yields exactly one stored effect', async () => {
        // Declared double (mechanics only): an idempotent consumer merging by
        // the stable entry id - mirrors the real continuum working-tier
        // upsert + LanceDB merge-by-ID contract that this journal relies on.
        const stored = new Map<string, any>();
        const storeCalls: Array<string | undefined> = [];
        const store = vi.fn().mockImplementation(async (content: string, _tier: any, _tags: any, _skip: any, extra: any) => {
            storeCalls.push(extra?.id);
            stored.set(extra?.id ?? content, { content, extra });
            return { ok: true };
        });

        mocks.binding = undefined; // continuum not ready: write journals first
        let mod = await import('../../services/introspectionEngine');
        await waitFor(() => mod.introspection.getPendingContinuumWriteCount() > 0);
        expect(store).not.toHaveBeenCalled(); // durable BEFORE any attempt
        const journaledIds = (mod.introspection as any).pendingContinuumWrites.map((w: any) => w.id);
        expect(journaledIds.every((id: any) => typeof id === 'string' && id.length > 0)).toBe(true);

        // RESTART: module registry wiped; the SQLite journal survives (same worker DB).
        vi.resetModules();
        mocks.binding = { store, retrieve: vi.fn().mockResolvedValue([]) };
        mod = await import('../../services/introspectionEngine');
        await waitFor(() => mod.introspection.getPendingContinuumWriteCount() === 0);
        for (const id of journaledIds) {
            expect(stored.has(id)).toBe(true); // replayed with its stable id
        }

        // Crash window: store confirmed but the ACK was lost -> the SAME
        // journaled entry replays. Delivery is at-least-once (store runs
        // again) yet the stored effect stays exactly one (collapse by id).
        const replayEntry = {
            id: 'crash-window-entry-1',
            content: '[INTROSPECTION] Injected Concept Vector: Crash Window (Str: 1)',
            tags: ['system', 'concept-vector'],
            queuedAt: Date.now(),
        };
        (mod.introspection as any).pendingContinuumWrites.push({ ...replayEntry });
        await (mod.introspection as any).drainPendingContinuumWrites();
        (mod.introspection as any).pendingContinuumWrites.push({ ...replayEntry }); // lost ACK: entry still journaled
        await (mod.introspection as any).drainPendingContinuumWrites();
        expect(storeCalls.filter(id => id === 'crash-window-entry-1').length).toBe(2); // at-least-once, honest
        expect([...stored.keys()].filter(k => k === 'crash-window-entry-1').length).toBe(1); // exactly one effect
        expect(mod.introspection.getPendingContinuumWriteCount()).toBe(0); // ACKed
    }, 20000);
});
