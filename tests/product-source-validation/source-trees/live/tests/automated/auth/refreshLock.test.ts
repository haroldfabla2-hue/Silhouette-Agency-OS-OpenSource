import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRefreshLock, withRefreshLock, assertFence, FenceLostError, RefreshLockTimeout } from '../../../services/auth/refreshLock';

const dirs: string[] = [];
function dir(): string { const d = mkdtempSync(join(tmpdir(), 'rl-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('refreshLock', () => {
    it('serializes holders and rejects late writers via fencing', async () => {
        const d = dir();
        const a = await acquireRefreshLock(d, 'gemini', { staleMs: 30 });
        assertFence(a); // held: write would land
        // A goes stale; B reclaims and gets a NEW fence
        await new Promise(r => setTimeout(r, 50));
        const b = await acquireRefreshLock(d, 'gemini', { staleMs: 30, maxWaitMs: 2000 });
        expect(b.fence).toBeGreaterThan(a.fence);
        // Late write from the stale holder is rejected, not just unlocked
        expect(a.checkFence()).toBe(false);
        expect(() => assertFence(a)).toThrow(FenceLostError);
        // A releasing must NOT remove B's lock (ownership check)
        a.release();
        expect(b.checkFence()).toBe(true);
        assertFence(b);
        b.release();
        expect(b.checkFence()).toBe(false);
    });
    it('times out a waiter instead of queueing forever', async () => {
        const d = dir();
        const a = await acquireRefreshLock(d, 'openai', { staleMs: 60_000 });
        await expect(acquireRefreshLock(d, 'openai', { staleMs: 60_000, maxWaitMs: 200, initialBackoffMs: 50 }))
            .rejects.toBeInstanceOf(RefreshLockTimeout);
        a.release();
    });
    it('withRefreshLock releases on error and allows re-acquisition', async () => {
        const d = dir();
        await expect(withRefreshLock(d, 'copilot', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        const again = await acquireRefreshLock(d, 'copilot', { maxWaitMs: 500 });
        again.release();
    });
});
