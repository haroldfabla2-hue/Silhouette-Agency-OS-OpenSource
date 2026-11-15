/**
 * [auth-connections] Cross-process OAuth refresh lock WITH FENCING.
 * Stale expiry alone does not make a lock safe (lesson PR#198): a holder that
 * goes stale can wake up and write late, next to the new holder. Here every
 * acquisition takes a monotonically increasing fence from a persistent file;
 * token writes must pass checkFence() immediately before landing, so a stale
 * holder's late write is rejected even after its lock was reclaimed.
 * OpenClaw inspiration verified in auth-profiles (MIT, commit d25ac78);
 * implementation is our own.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RefreshLockOptions {
    staleMs?: number;
    maxWaitMs?: number;
    initialBackoffMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export interface HeldRefreshLock {
    /** Monotonic fence for this acquisition; pass to every guarded write. */
    readonly fence: number;
    /** True only while this holder's fence is still the latest - call right before writing. */
    checkFence: () => boolean;
    release: () => void;
}

export class RefreshLockTimeout extends Error {
    constructor(public readonly lockPath: string) { super(`Timed out acquiring refresh lock: ${lockPath}`); }
}
export class FenceLostError extends Error {
    constructor(public readonly fence: number) { super(`Refresh lock fence ${fence} lost: another holder acquired the lock`); }
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function readFence(fenceFile: string): number {
    try { return Number(readFileSync(fenceFile, 'utf8').trim()) || 0; } catch { return 0; }
}

export async function acquireRefreshLock(
    dir: string,
    name: string,
    options: RefreshLockOptions = {},
): Promise<HeldRefreshLock> {
    const staleMs = options.staleMs ?? 180_000;
    const maxWaitMs = options.maxWaitMs ?? 120_000;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? defaultSleep;
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) throw new Error('Invalid lock name');
    const lockDir = join(dir, `${name}.lock`);
    const ownerFile = join(lockDir, 'owner.json');
    const fenceFile = join(dir, `${name}.fence`);
    mkdirSync(dir, { recursive: true });
    const deadline = now() + maxWaitMs;
    let backoff = options.initialBackoffMs ?? 100;

    for (;;) {
        try {
            mkdirSync(lockDir);
            // Inside the exclusive section: bump the persistent fence.
            const fence = readFence(fenceFile) + 1;
            writeFileSync(fenceFile, String(fence), { mode: 0o600 });
            const owner = JSON.stringify({ pid: process.pid, acquiredAt: now(), fence });
            writeFileSync(ownerFile, owner, { mode: 0o600 });
            let released = false;
            const stillOurs = (): boolean => {
                try { return readFileSync(ownerFile, 'utf8') === owner; } catch { return false; }
            };
            return {
                fence,
                checkFence: () => !released && stillOurs() && readFence(fenceFile) === fence,
                release: () => {
                    if (released) return;
                    released = true;
                    try { if (stillOurs()) rmSync(lockDir, { recursive: true, force: true }); } catch { /* reclaimed already */ }
                },
            };
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
            let stale = false;
            try { stale = now() - statSync(ownerFile).mtimeMs > staleMs; } catch { stale = true; }
            if (stale) { rmSync(lockDir, { recursive: true, force: true }); continue; }
            if (now() + backoff > deadline) throw new RefreshLockTimeout(lockDir);
            await sleep(backoff);
            backoff = Math.min(backoff * 2, 10_000);
        }
    }
}

/**
 * Guarded write helper: throws FenceLostError instead of letting a stale
 * holder's write land. Use for token persistence during refresh.
 */
export function assertFence(held: HeldRefreshLock): void {
    if (!held.checkFence()) throw new FenceLostError(held.fence);
}

export async function withRefreshLock<T>(dir: string, name: string, fn: (held: HeldRefreshLock) => Promise<T>, options?: RefreshLockOptions): Promise<T> {
    const held = await acquireRefreshLock(dir, name, options);
    try { return await fn(held); } finally { held.release(); }
}
