import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Existing npm test bridge. No app, submitted CODE or native install is executed.
// POSIX interruption targets our isolated process group. Windows only owns the
// direct process; this bridge is not Windows descendant-cleanup acceptance.
test('owning CODE runner real-child contract', async () => {
    const cwd = fileURLToPath(new URL('../../', import.meta.url));
    const contract = fileURLToPath(new URL('../owned-code-runner/contract.node.cjs', import.meta.url));
    const output = await new Promise<string>((resolve, reject) => {
        const posix = process.platform !== 'win32';
        const child = spawn(process.execPath, ['--test', contract], {
            cwd, shell: false, detached: posix, stdio: ['ignore', 'pipe', 'pipe']
        });
        const chunks: Buffer[] = [];
        let bytes = 0, failed: string | undefined, settled = false, closed = false;
        let grace: ReturnType<typeof setTimeout> | undefined;
        let closeWait: ReturnType<typeof setTimeout> | undefined;
        const signal = (sig: NodeJS.Signals) => {
            try {
                if (posix && child.pid) process.kill(-child.pid, sig);
                else child.kill(sig);
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) return false;
            }
            return true;
        };
        const finish = (error?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline); clearTimeout(grace); clearTimeout(closeWait);
            if (error) reject(new Error(error));
            else resolve(Buffer.concat(chunks).toString('utf8'));
        };
        const fail = (reason: string) => {
            if (failed || settled) return;
            failed = reason;
            signal('SIGTERM');
            grace = setTimeout(() => {
                signal('SIGKILL');
                const end = Date.now() + 1000;
                const verify = () => {
                    let groupGone = !posix;
                    if (posix && child.pid) {
                        try { process.kill(-child.pid, 0); }
                        catch (error) { groupGone = error instanceof Error && 'code' in error && error.code === 'ESRCH'; }
                    } else if (!child.pid) groupGone = true;
                    if (closed && groupGone) finish('bridge failed after closed cleanup: ' + failed + (posix ? '' : ' (Windows descendants unverified)'));
                    else if (Date.now() >= end) finish('UNRESOLVED bridge process/group cleanup after ' + failed);
                    else closeWait = setTimeout(verify, 20);
                };
                verify();
            }, 100);
        };
        const deadline = setTimeout(() => fail('bridge 15s deadline'), 15000);
        child.on('error', () => fail('bridge spawn error'));
        child.stdout.on('error', () => fail('bridge stdout error'));
        child.stderr.on('error', () => fail('bridge stderr error'));
        const collect = (chunk: Buffer) => {
            const remaining = Math.max(0, 2 * 1024 * 1024 - bytes);
            if (remaining) chunks.push(Buffer.from(chunk.subarray(0, remaining)));
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) fail('bridge combined output limit');
        };
        child.stdout.on('data', collect); child.stderr.on('data', collect);
        child.on('close', (code, sig) => {
            closed = true;
            if (failed) {
                // The escalation timer verifies root close and POSIX group
                // absence; root close alone never counts as fixture cleanup.
            } else if (code !== 0 || sig !== null) {
                fail('contract non-natural status');
            } else finish();
        });
    });
    for (const line of ['# tests 13', '# pass 13', '# fail 0', '# cancelled 0', '# skipped 0']) {
        expect(output.split(/\r?\n/).filter(value => value === line)).toHaveLength(1);
    }
}, 20000);
