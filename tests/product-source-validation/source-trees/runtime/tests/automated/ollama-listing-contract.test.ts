import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
const script = resolve('tests/real-process/ollama-listing-contract-child.ts');

// The parent owns the entire fixture process boundary. Forced termination is
// always failure, including after a receipt: success requires natural exit.
async function runFixture(mode: string): Promise<void> {
    let directory: string | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let leaderReaped = false;
    let groupGone = false;
    let timedOut = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let reapDeadline: ReturnType<typeof setTimeout> | undefined;
    const failures: unknown[] = [];
    const started = Date.now();
    const finalAt = started + 18000;
    const verifyGroup = (): boolean => {
        if (!child?.pid) return leaderReaped;
        if (process.platform === 'win32') return false; // UNKNOWN, never PASS.
        try { process.kill(-child.pid, 0); return false; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
            failures.push(error); // EPERM/unknown is not absence.
            return false;
        }
    };
    const killOwnedTree = () => {
        if (!child?.pid) return;
        if (process.platform === 'win32') {
            const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                timeout: Math.max(1, Math.min(2000, finalAt - Date.now())), encoding: 'utf8'
            });
            if (result.error || result.status !== 0) failures.push(new Error(`Tree termination failed: ${result.error || result.stderr}`));
        } else {
            try { process.kill(-child.pid, 'SIGKILL'); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(error); }
        }
    };
    try {
        directory = mkdtempSync(join(tmpdir(), 'ollama-listing-contract-'));
        // A Windows tree cannot be verified with this reviewed harness. Fail
        // explicitly before spawn; do not silently skip or claim equivalence.
        if (process.platform === 'win32') throw new Error('Fixture tree verification UNKNOWN on Windows');
        child = spawn(process.execPath, ['--import', loader, script, mode], {
            cwd: directory, detached: true, stdio: ['ignore', 'inherit', 'inherit'],
            env: {
                PATH: process.env.PATH, HOME: directory, TMPDIR: directory,
                TEMP: directory, TMP: directory, NODE_ENV: 'test',
                SILHOUETTE_PROVIDERS: 'off', SILHOUETTE_BOOT_MODE: 'normal',
                SILHOUETTE_DB_PATH: join(directory, 'fixture.sqlite')
            }
        });
        const leader = child;
        deadline = setTimeout(() => {
            timedOut = true;
            failures.push(new Error(`Fixture ${mode} exceeded 15000ms; termination is NOT success`));
            killOwnedTree();
        }, Math.max(1, started + 15000 - Date.now()));
        const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, reject) => {
            reapDeadline = setTimeout(() => {
                killOwnedTree();
                reject(new Error('Fixture leader not reaped within 18000ms; cleanup unverified'));
            }, Math.max(1, finalAt - Date.now()));
            leader.once('error', error => {
                // Failed spawn has no PID and therefore no owned OS leader.
                if (!leader.pid) leaderReaped = true;
                reject(error);
            });
            leader.once('close', (code, signal) => {
                leaderReaped = true;
                resolveResult({ code, signal });
            });
        });
        if (deadline) clearTimeout(deadline);
        if (reapDeadline) clearTimeout(reapDeadline);
        groupGone = verifyGroup();
        expect(timedOut).toBe(false);
        expect(result).toEqual({ code: 0, signal: null });
        expect(groupGone, 'Natural leader exit left live/unknown owned group').toBe(true);
        expect(JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'))).toEqual({ mode, passed: true, cleanup: true });
    } catch (error) { failures.push(error); }
    finally {
        if (deadline) clearTimeout(deadline);
        if (reapDeadline) clearTimeout(reapDeadline);
        // One cleanup path owns termination, direct-child reap observation and
        // POSIX group nonexistence. Leader close alone never permits deletion.
        if (!child) {
            leaderReaped = true;
            groupGone = true; // No spawn attempted, no OS owner exists.
        } else {
            groupGone = verifyGroup();
            if (!leaderReaped || !groupGone) killOwnedTree();
            while ((!leaderReaped || !groupGone) && Date.now() < finalAt) {
                groupGone = verifyGroup();
                if (leaderReaped && groupGone) break;
                await new Promise(resolveWait => setTimeout(resolveWait, Math.min(20, Math.max(1, finalAt - Date.now()))));
            }
            groupGone = verifyGroup();
        }
        if (!leaderReaped || !groupGone) {
            failures.push(new Error(`Cleanup UNKNOWN: leaderReaped=${leaderReaped}, groupGone=${groupGone}; retained ${directory}`));
        } else if (directory) {
            try { rmSync(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
        }
    }
    if (failures.length) throw new AggregateError(failures, `Fixture ${mode} failed; leaderReaped=${leaderReaped}; groupGone=${groupGone}; evidence=${directory}`);
}

describe('Actual SDK HTTP listing contract, not inference', () => {
    it('rejects invalid listings/network failure and accepts a reachable models array', async () => { await runFixture('listing'); });
});
