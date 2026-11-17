/** Actual subprocesses, real sockets and filesystem, providers OFF.
 * Narrow shutdown contracts: redis fallback quiet-but-visible with a
 * shared disconnect receipt, continuous-memory never-started vs
 * blocked-store distinction with a STICKY failure, and honest drain
 * outcomes. The fixture holds its own controlled endpoint on an
 * ephemeral port (host-default Redis/Neo4j are never contacted).
 * Children get NO process.exit on the success path: termination is
 * natural; the supervisor bounds it externally and cleans up the whole
 * process GROUP, so a lingering interval/socket/descendant keeps the
 * child (or its group) alive and fails the run.
 *
 * Supervisor contract (review-derived):
 * - spawn 'error' resolves the outcome (the promise can never hang);
 * - stdout/stderr are capped, and truncation is reported;
 * - completion is the direct child's 'exit', never 'close' (escaped
 *   descendants can hold pipes open and must not stall the harness);
 * - after exit OR timeout the whole process group is probed; only an
 *   ESRCH answer counts as gone (EPERM/other = still alive or unknown);
 * - a live group is SIGKILLed and then polled until gone, with a bounded
 *   budget; survivors or unknown state fail the test with evidence;
 * - kill failures other than ESRCH are recorded, never swallowed.
 *
 * Local-model policy: SILHOUETTE_INFERENCE_MODE=cloud-only is set in the
 * child env (source-level prevention at the getEmbedding call boundary -
 * NOT OS isolation). The transformer cache root is baselined immediately
 * BEFORE each child and diffed only after the group is fully gone:
 * pre-existing cache content from earlier tests in the job is reported,
 * never attributed to this fixture; only NEW or CHANGED entries fail. */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
const migrationAssets = resolve('db/migrations/sqlite');
const script = resolve('tests/real-process/shutdown-contracts-child.ts');
const transformerCacheRoot = resolve('node_modules/@xenova/transformers/.cache');
const OUTPUT_CAP = 256 * 1024;

// Installed-tree receipt: which transformer build this run would actually use.
const installedTransformersVersion = (() => {
    try {
        return JSON.parse(readFileSync(resolve('node_modules/@xenova/transformers/package.json'), 'utf8')).version ?? 'unknown';
    } catch {
        return 'not-installed';
    }
})();

const environment = (directory: string) => ({
    PATH: process.env.PATH,
    HOME: directory,
    NODE_ENV: 'test',
    SILHOUETTE_PROVIDERS: 'off',
    SILHOUETTE_INFERENCE_MODE: 'cloud-only',
    SILHOUETTE_MIGRATIONS_DIR: migrationAssets,
    SILHOUETTE_BOOT_MODE: 'acceptance'
});

type CacheSnapshot = Map<string, string>; // relpath -> `${size}:${mtimeMs}`
const snapshotCache = (): CacheSnapshot | null => {
    if (!existsSync(transformerCacheRoot)) return null;
    const out: CacheSnapshot = new Map();
    const walk = (dir: string, depth: number) => {
        if (out.size > 500 || depth > 6) return;
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            try {
                const st = statSync(p);
                if (st.isDirectory()) walk(p, depth + 1);
                else out.set(relative(transformerCacheRoot, p), `${st.size}:${st.mtimeMs}`);
            } catch { /* unreadable entry: ignore, the diff still covers the rest */ }
        }
    };
    walk(transformerCacheRoot, 0);
    return out;
};

/** Entries created or modified while the child ran. Pre-existing untouched
 * content is the job's earlier-test state, never this fixture's breach. */
const cacheBreach = (before: CacheSnapshot | null): string[] => {
    const after = snapshotCache() ?? new Map() as CacheSnapshot;
    const changed: string[] = [];
    for (const [rel, sig] of after) {
        if (!before || before.get(rel) !== sig) changed.push(rel);
    }
    return changed;
};

const inventory = (root: string, max = 200): string[] => {
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
        if (out.length >= max || depth > 5) return;
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            out.push(relative(root, p));
            try { if (statSync(p).isDirectory()) walk(p, depth + 1); } catch { /* skip */ }
        }
    };
    try { walk(root, 0); } catch { /* dir may already be gone */ }
    return out;
};

type ChildOutcome =
    | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
    | { kind: 'spawn-error'; error: Error }
    | { kind: 'timeout' };

interface ChildResult {
    outcome: ChildOutcome;
    stdout: string;
    stderr: string;
    truncated: boolean;
    survivors: boolean;      // group still alive (or state unknown) after cleanup
    killError: string | null;
    groupGoneWaitMs: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** ESRCH is the ONLY answer that means gone. EPERM/other = alive or unknown. */
const groupAlive = (pid: number): boolean | null => {
    try { process.kill(-pid, 0); return true; }
    catch (e: any) { return e?.code === 'ESRCH' ? false : null; }
};

const runChild = (directory: string, mode: string, timeoutMs: number): Promise<ChildResult> => {
    return new Promise((resolvePromise) => {
        const child: ChildProcess = spawn(process.execPath, ['--import', loader, script, mode], {
            cwd: directory,
            env: environment(directory),
            detached: true,               // own process group: descendants are killable/reap-able
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const pid = child.pid;            // undefined if spawn failed synchronously
        let stdout = '', stderr = '', truncated = false;
        let settled = false;
        let killError: string | null = null;

        const append = (which: 'stdout' | 'stderr', chunk: Buffer) => {
            if (which === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
            if (stdout.length > OUTPUT_CAP) { stdout = stdout.slice(0, OUTPUT_CAP); truncated = true; }
            if (stderr.length > OUTPUT_CAP) { stderr = stderr.slice(0, OUTPUT_CAP); truncated = true; }
        };
        child.stdout?.on('data', (c: Buffer) => append('stdout', c));
        child.stderr?.on('data', (c: Buffer) => append('stderr', c));

        const killGroup = () => {
            if (pid === undefined) return;
            try { process.kill(-pid, 'SIGKILL'); }
            catch (e: any) { if (e?.code !== 'ESRCH') killError = String(e?.message ?? e); }
        };

        const settle = async (outcome: ChildOutcome) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // Sweep the group: natural child exit does NOT prove descendants are gone.
            const waitStart = Date.now();
            let survivors = false;
            if (pid !== undefined) {
                let alive = groupAlive(pid);
                if (alive !== false) {
                    killGroup();          // survivors (or unknown) after exit/timeout: kill, then reap
                    const deadline = Date.now() + 3000;
                    while (Date.now() < deadline) {
                        alive = groupAlive(pid);
                        if (alive === false) break;
                        await sleep(50);
                    }
                    survivors = alive !== false; // true or unknown(EPERM) at budget end = not reaped
                }
            }
            // Release pipe handles: descendants holding them must not stall us.
            child.stdout?.destroy();
            child.stderr?.destroy();
            resolvePromise({
                outcome, stdout, stderr, truncated, survivors, killError,
                groupGoneWaitMs: Date.now() - waitStart
            });
        };

        const timer = setTimeout(() => { void settle({ kind: 'timeout' }); }, timeoutMs);
        child.on('error', (error) => { void settle({ kind: 'spawn-error', error }); });
        child.on('exit', (code, signal) => { void settle({ kind: 'exit', code, signal }); });
    });
};

const expectCleanChild = (result: ChildResult, mode: string) => {
    const summary = `[child ${mode}] outcome=${JSON.stringify(result.outcome)} survivors=${result.survivors} killError=${result.killError} truncated=${result.truncated} groupGoneWaitMs=${result.groupGoneWaitMs}`;
    const clean = result.outcome.kind === 'exit' && result.outcome.code === 0 && !result.survivors && result.killError === null && result.stdout.includes(`"mode":"${mode}"`);
    // Full child evidence on ANY abnormal outcome; one summary line on success.
    console.log(clean ? summary : `${summary}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    expect(result.outcome.kind, `child ${mode} must exit by itself, not be killed or fail to spawn`).toBe('exit');
    if (result.outcome.kind === 'exit') {
        expect(result.outcome.code, `child ${mode} exit code`).toBe(0);
    }
    expect(result.survivors, `child ${mode} left a live or unknown process group`).toBe(false);
    expect(result.killError, `child ${mode} group kill failed`).toBeNull();
    expect(result.stdout, `child ${mode} must print its result line`).toContain(`"mode":"${mode}"`);
};

describe('real shutdown contracts (narrow)', () => {
    for (const mode of ['memory-never-started-fresh', 'memory-never-started-prior-wal', 'memory-blocked-store']) it(mode, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
        const cacheBefore = snapshotCache();
        try {
            const result = await runChild(directory, mode, 30000);
            expectCleanChild(result, mode);
            const breach = cacheBreach(cacheBefore);
            expect(breach, `transformer cache changed under cloud-only (new/changed: ${breach.join(', ')})`).toEqual([]);
        } finally {
            console.log(`[fixture inventory ${mode}]`, inventory(directory));
            console.log(`[transformers installed] version=${installedTransformersVersion} cacheRootPreexisting=${cacheBefore !== null}`);
            rmSync(directory, { recursive: true, force: true });
        }
    }, 35000);
    for (const mode of ['redis-fallback-quiet', 'drain-receipts-ok']) it(mode, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
        const cacheBefore = snapshotCache();
        try {
            const result = await runChild(directory, mode, 90000);
            expectCleanChild(result, mode);
            const breach = cacheBreach(cacheBefore);
            expect(breach, `transformer cache changed under cloud-only (new/changed: ${breach.join(', ')})`).toEqual([]);
        } finally {
            console.log(`[fixture inventory ${mode}]`, inventory(directory));
            console.log(`[transformers installed] version=${installedTransformersVersion} cacheRootPreexisting=${cacheBefore !== null}`);
            rmSync(directory, { recursive: true, force: true });
        }
    }, 95000);
});
