/**
 * Daemon lock resilience: a stale or unreachable lock must NOT silently
 * defer a task by its full interval (observed in production: after a restart,
 * every daemon task was postponed ~12h because the skip path set lastRun).
 *
 * Root fix pinned here:
 *  1. A skip (lock held or lock check failed) never updates lastRun — the
 *     task stays due and retries on the next tick.
 *  2. The lock TTL is capped (1h) so a dead holder blocks for at most the
 *     cap, never a whole 12h/24h interval.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const acquireLock = vi.fn();
vi.mock('../../services/redisClient', () => ({
    // Proxy: acquireLock is test-controlled; every other method is a harmless
    // async no-op so the heavy import chain (continuum, graph, ...) inits.
    redisClient: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'acquireLock') return (...args: any[]) => acquireLock(...args);
            if (prop === 'isConnected' || prop === 'isMock') return false;
            return async () => true;
        }
    })
}));

import { UnifiedDaemon } from '../../services/daemon/unifiedDaemon';

const tmpDirs: string[] = [];
afterEach(() => {
    tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    acquireLock.mockReset();
});

function freshDaemon() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-'));
    tmpDirs.push(dir);
    const daemon = new UnifiedDaemon();
    // Isolate state persistence to a tmp file
    (daemon as any).STATE_FILE = path.join(dir, 'daemon_state.json');
    // Replace the task list with one controlled task that is due (lastRun 0)
    const ran: number[] = [];
    (daemon as any).tasks = [{
        name: 'Janitor',
        intervalMs: 12 * 60 * 60 * 1000,
        enabled: true,
        lastRun: 0,
        runCount: 0,
        errCount: 0,
        execute: async () => { ran.push(Date.now()); }
    }];
    return { daemon: daemon as any, ran };
}

describe('daemon lock resilience', () => {
    it('a skip (lock held) does NOT update lastRun — the task stays due', async () => {
        const { daemon, ran } = freshDaemon();
        acquireLock.mockResolvedValue(false); // lock held by another (possibly dead) holder
        await daemon.tick();
        expect(ran).toHaveLength(0);
        expect(daemon.tasks[0].lastRun).toBe(0); // still due, not deferred
    });

    it('when the lock frees, the very next tick runs the task', async () => {
        const { daemon, ran } = freshDaemon();
        acquireLock.mockResolvedValueOnce(false); // stale lock held
        await daemon.tick();
        acquireLock.mockResolvedValueOnce(true);  // lock expired/released
        await daemon.tick();
        expect(ran).toHaveLength(1);
        expect(daemon.tasks[0].runCount).toBe(1);
    });

    it('lock TTL is capped at 1h even for a 12h-interval task', async () => {
        const { daemon } = freshDaemon();
        acquireLock.mockResolvedValue(true);
        await daemon.tick();
        expect(acquireLock).toHaveBeenCalledTimes(1);
        const [key, ttl] = acquireLock.mock.calls[0];
        expect(key).toBe('lock:daemon:janitor');
        expect(ttl).toBe(60 * 60 * 1000); // capped, not 12h - 1s
    });

    it('a lock acquisition failure (redis blip) also leaves the task due', async () => {
        const { daemon, ran } = freshDaemon();
        acquireLock.mockRejectedValue(new Error('redis down'));
        // tick() must survive the failure without marking the task as run
        await expect(daemon.tick()).resolves.not.toThrow();
        expect(ran).toHaveLength(0);
        expect(daemon.tasks[0].lastRun).toBe(0);
    });
});
