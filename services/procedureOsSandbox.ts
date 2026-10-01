import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decodeFileContract, type SandboxReceipt } from './procedureFileSandbox';
import type { Procedure } from './memoryEvidence';

/** Linux-only opt-in isolated test worker. No registry approval or execution endpoint. */
export async function testOsFileProcedure(procedure: Procedure): Promise<SandboxReceipt> {
    decodeFileContract(procedure); // Parent validation, repeated strictly in the worker.
    const script = await readFile(fileURLToPath(new URL('./procedureOsSandboxWorker.cjs', import.meta.url)), 'utf8');
    const result = await isolatedWorker(script, procedure.steps[0]);
    return { procedureId: procedure.id, ownerId: procedure.ownerId, version: procedure.version,
        contractHash: createHash('sha256').update(procedure.steps[0]).digest('hex'), ...result };
}

/** Trusted worker source only. Never pass generated or user code here. */
async function isolatedWorker(script: string, input: string): Promise<{ succeeded: boolean; operations: number }> {
    if (process.platform !== 'linux') throw new Error('OS sandbox requires Linux bubblewrap');
    // Mount only executable/runtime libraries, not /usr, /home, host /tmp or /etc.
    const args = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
        '--clearenv', '--setenv', 'PATH', '/runtime', '--setenv', 'HOME', '/work',
        '--dir', '/runtime', '--ro-bind', process.execPath, '/runtime/node',
        '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
        '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/work', '--chdir', '/work',
        '/runtime/node', '--max-old-space-size=64', '-e', script];
    return new Promise((resolve, reject) => {
        // prlimit is deployment-owned, fixed command. Missing isolation fails closed.
        const child = spawn('/usr/bin/prlimit', ['--as=2147483648', '--cpu=3', '--fsize=1048576',
            '--nofile=64', '--core=0', '--', '/usr/bin/bwrap', ...args],
        { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        let output = '', diagnostic = '', settled = false;
        const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } } };
        const timer = setTimeout(() => { stop(); }, 5000);
        const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); stop(); reject(error); } };
        child.on('error', fail);
        child.stdin.on('error', () => { /* Exit/error handler reports failed isolation. */ });
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.length > 4096) fail(new Error('Worker output budget exceeded')); });
        child.stderr.on('data', (chunk: Buffer) => { diagnostic += chunk.toString(); if (diagnostic.length > 4096) fail(new Error('Worker diagnostic budget exceeded')); });
        child.on('close', (code, signal) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            try {
                const receipt = JSON.parse(output) as { succeeded: boolean; operations: number };
                if (signal || typeof receipt.succeeded !== 'boolean' || !Number.isInteger(receipt.operations)
                    || receipt.operations < 0 || receipt.operations > 32 || (receipt.succeeded && code !== 0)) throw new Error('Invalid worker receipt');
                resolve(receipt);
            } catch { reject(new Error('OS isolation failed or worker exceeded its budget')); }
        });
        child.stdin.end(input);
    });
}
