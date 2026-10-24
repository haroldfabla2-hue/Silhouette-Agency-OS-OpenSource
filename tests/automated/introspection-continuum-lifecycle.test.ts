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

let binding: any = undefined;
vi.mock('../../services/continuumMemory', () => ({
    get continuum() { return binding; }
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
    binding = undefined;
    vi.restoreAllMocks();
});

describe('introspection constructor persistence across module lifecycle', () => {
    it('defers the constructor concept write until the continuum binding initializes', async () => {
        const store = vi.fn().mockResolvedValue({ ok: true });
        const retrieve = vi.fn().mockResolvedValue([]);
        const errors: any[] = [];
        vi.spyOn(console, 'error').mockImplementation((...a: any[]) => { errors.push(a); });

        binding = undefined; // continuum module mid-evaluation
        const mod = await import('../../services/introspectionEngine');
        expect(mod.introspection).toBeTruthy();

        // Several ticks with the binding uninitialized: no write happens, and
        // crucially no misleading storage error is logged while waiting.
        await new Promise(r => setTimeout(r, 200));
        expect(store).not.toHaveBeenCalled();
        expect(errors.flat().join(' ')).not.toContain('Failed to persist concept');

        // The module finishes initializing: the deferred write lands.
        binding = { store, retrieve };
        await waitFor(() => store.mock.calls.length > 0);
        expect(String(store.mock.calls[0][0])).toContain('Ethical Alignment');
        expect(errors.flat().join(' ')).not.toContain('Failed to persist concept');
    }, 15000);

    it('classifies a never-initialized continuum as module lifecycle, not storage failure', async () => {
        const errors: any[] = [];
        vi.spyOn(console, 'error').mockImplementation((...a: any[]) => { errors.push(a); });

        binding = undefined; // never initializes
        await import('../../services/introspectionEngine');

        await waitFor(() => errors.flat().join(' ').includes('module-lifecycle wait'), 10000);
        const text = errors.flat().join(' ');
        expect(text).toContain('module-lifecycle wait');
        expect(text).toContain('NOT a storage failure');
        expect(text).not.toContain('Failed to persist concept');
    }, 20000);
});
