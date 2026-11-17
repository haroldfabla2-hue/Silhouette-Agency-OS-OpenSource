/** Actual subprocesses, real sockets and filesystem, providers OFF.
 * Narrow shutdown contracts: redis fallback quiet-but-visible with a
 * shared disconnect receipt, continuous-memory never-started vs
 * blocked-store distinction with a STICKY failure, and honest drain
 * outcomes. The fixture holds its own controlled endpoint on an
 * ephemeral port (host-default Redis is never contacted). Children get
 * NO process.exit on the success path: termination is natural, bounded
 * externally by the execFileSync timeout - a lingering interval or
 * socket keeps the child alive and fails the run. */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
const migrationAssets = resolve('db/migrations/sqlite');
const script = resolve('tests/real-process/shutdown-contracts-child.ts');
const environment = (directory: string) => ({ PATH: process.env.PATH, HOME: directory, NODE_ENV: 'test', SILHOUETTE_PROVIDERS: 'off', SILHOUETTE_MIGRATIONS_DIR: migrationAssets, SILHOUETTE_BOOT_MODE: 'acceptance' });
// A failing child must not lose its own evidence: execFileSync attaches
// captured stdout/stderr to the error - surface them before rethrowing.
const runChild = (directory: string, mode: string, timeout: number): string => {
    try {
        return execFileSync(process.execPath, ['--import', loader, script, mode], { cwd: directory, encoding: 'utf8', timeout, env: environment(directory) }) as string;
    } catch (error: any) {
        if (error?.stdout) console.error(`[child ${mode} stdout]\n${error.stdout}`);
        if (error?.stderr) console.error(`[child ${mode} stderr]\n${error.stderr}`);
        throw error;
    }
};

describe('real shutdown contracts (narrow)', () => {
    for (const mode of ['memory-never-started-fresh', 'memory-never-started-prior-wal', 'memory-blocked-store']) it(mode, () => {
        const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
        try {
            const output = runChild(directory, mode, 30000);
            expect(output).toContain(`"mode":"${mode}"`);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    }, 35000);
    for (const mode of ['redis-fallback-quiet', 'drain-receipts-ok']) it(mode, () => {
        const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
        try {
            const output = runChild(directory, mode, 90000);
            expect(output).toContain(`"mode":"${mode}"`);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    }, 95000);
});
