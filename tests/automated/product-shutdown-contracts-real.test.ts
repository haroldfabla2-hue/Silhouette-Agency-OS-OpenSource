/** Actual subprocesses, real sockets and filesystem, providers OFF.
 * Narrow shutdown contracts: redis fallback quiet-but-visible with a
 * shared disconnect receipt, continuous-memory never-started vs
 * blocked-store distinction with a STICKY failure, and honest drain
 * outcomes. The fixture holds its own controlled endpoint on an
 * ephemeral port (host-default Redis/Neo4j are never contacted).
 * Children get NO process.exit on the success path: termination must be
 * natural; the supervisor bounds it externally.
 *
 * Supervisor contract (review-derived, fail-closed):
 * - spawn 'error' resolves the outcome (the promise can never hang);
 * - stdout/stderr are preserved as head+tail with exact byte counts;
 *   any dropped middle bytes mark the evidence truncated = FAILURE;
 * - completion is the direct child's 'exit'; streams are then drained
 *   until EOF ('close') under a short bounded deadline - destroying the
 *   pipes early would lose trailing result/error bytes; hitting the
 *   deadline marks the evidence incomplete = FAILURE;
 * - the post-exit process-group probe is decisive for natural exit: a
 *   live group at the FIRST probe means a leaked descendant and fails
 *   acceptance EVEN IF the subsequent cleanup succeeds (hadSurvivors is
 *   reported separately from survivorsAfterCleanup);
 * - on timeout the direct child's reap ('exit') is awaited as well as
 *   group absence, both bounded;
 * - group liveness treats ONLY ESRCH as gone (EPERM/other = alive or
 *   unknown = not reaped); kill failures other than ESRCH are recorded;
 * - ESRCH proves only THIS process group is gone: a detached descendant
 *   that created its own session escapes the probe - an explicit
 *   residual gap, not a no-escaped-descendants guarantee.
 *
 * Local-model policy: SILHOUETTE_INFERENCE_MODE=cloud-only is set in the
 * child env (source-level prevention at the getEmbedding call boundary -
 * NOT OS isolation). The transformer cache root is baselined immediately
 * BEFORE each child and diffed only after the group is fully gone:
 * pre-existing cache content from earlier tests in the job is reported,
 * never attributed to this fixture; only NEW or CHANGED entries fail.
 * The snapshot walks fail closed: unreadable entries, depth/count caps
 * hit, an unreadable installed-version receipt, or an installed version
 * differing from the VERIFIED layout version (2.17.2, pinned below) all
 * make the cache guard FAIL instead of silently passing. */
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
const HEAD_KEEP = 128 * 1024;
const TAIL_KEEP = 128 * 1024;
const CLEANUP_BUDGET_MS = 4000; // shared across EOF drain + reap: child timeout + cleanup must stay under the vitest allowance
// The transformer cache layout below is verified ONLY for this version
// (published 2.17.2 env.js: DEFAULT_CACHE_DIR = <package-root>/.cache).
const VERIFIED_CACHE_LAYOUT_VERSION = '2.17.2';
const installedTransformersVersion: string = (() => {
    try {
        return JSON.parse(readFileSync(resolve('node_modules/@xenova/transformers/package.json'), 'utf8')).version ?? 'installed-unreadable';
    } catch {
        return 'installed-unreadable';
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

interface CacheSnapshot {
    entries: Map<string, string>; // relpath -> `${size}:${mtimeMs}`
    incomplete: boolean;          // unreadable/missing entries or caps hit: NOT a full inventory
}
const snapshotCache = (): CacheSnapshot => {
    const entries = new Map<string, string>();
    let incomplete = false;
    if (!existsSync(transformerCacheRoot)) return { entries, incomplete };
    // ONE shared visited-entry count (files AND directories), checked per
    // iteration: no shape of tree (deep, flat, empty-dir-heavy) stalls the walk.
    let visited = 0;
    const walk = (dir: string, depth: number) => {
        if (depth > 6) { incomplete = true; return; }
        let names: string[];
        try { names = readdirSync(dir); } catch { incomplete = true; return; }
        for (const name of names) {
            visited++;
            if (visited > 500) { incomplete = true; return; }
            const p = join(dir, name);
            try {
                const st = statSync(p);
                if (st.isDirectory()) walk(p, depth + 1);
                else entries.set(relative(transformerCacheRoot, p), `${st.size}:${st.mtimeMs}`);
            } catch { incomplete = true; }
        }
    };
    walk(transformerCacheRoot, 0);
    return { entries, incomplete };
};

/** Entries created or modified while the child ran. Pre-existing untouched
 * content is the job's earlier-test state, never this fixture's breach.
 * An incomplete snapshot on either side is not a diff - it fails closed. */
const cacheBreach = (before: CacheSnapshot): { changed: string[]; incomplete: boolean } => {
    const after = snapshotCache();
    const changed: string[] = [];
    for (const [rel, sig] of after.entries) {
        if (before.entries.get(rel) !== sig) changed.push(rel);
    }
    return { changed, incomplete: before.incomplete || after.incomplete };
};

const inventory = (root: string, max = 200): { entries: string[]; incomplete: boolean } => {
    const entries: string[] = [];
    let incomplete = false;
    let visited = 0; // files AND directories, checked per iteration
    const walk = (dir: string, depth: number) => {
        if (depth > 5) { incomplete = true; return; }
        let names: string[];
        try { names = readdirSync(dir); } catch { incomplete = true; return; }
        for (const name of names) {
            visited++;
            if (visited > max) { incomplete = true; return; }
            const p = join(dir, name);
            entries.push(relative(root, p));
            try { if (statSync(p).isDirectory()) walk(p, depth + 1); } catch { /* skip */ }
        }
    };
    walk(root, 0);
    return { entries, incomplete };
};

type ChildOutcome =
    | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
    | { kind: 'spawn-error'; error: Error }
    | { kind: 'timeout' };

interface ChildResult {
    outcome: ChildOutcome;
    stdout: string;
    stderr: string;
    stdoutBytes: number;
    stderrBytes: number;
    truncated: boolean;             // output bytes were dropped: evidence NOT complete
    evidenceComplete: boolean;      // streams reached EOF before the drain deadline
    hadSurvivors: boolean;          // group alive at the FIRST post-exit/timeout probe: natural-exit breach
    survivorsAfterCleanup: boolean; // still alive or unknown after kill + bounded reap
    childReaped: boolean;           // direct child 'exit' observed (awaited on the timeout path)
    killError: string | null;
    groupGoneWaitMs: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** ESRCH is the ONLY answer that means gone. EPERM/other = alive or unknown.
 * Scope note: this probes ONE process group; a detached descendant that
 * created its own session is invisible to it (residual gap, not claimed). */
const groupAlive = (pid: number): boolean | null => {
    try { process.kill(-pid, 0); return true; }
    catch (e: any) { return e?.code === 'ESRCH' ? false : null; }
};

/** Head+tail capture in BYTES with exact counts and bounded memory.
 * Non-truncated output is reassembled byte-exact; any dropped middle marks
 * the evidence truncated and fails the test (no full-evidence claim). */
const makeCapture = () => {
    let head = Buffer.alloc(0), tail = Buffer.alloc(0), total = 0;
    const push = (chunk: Buffer) => {
        total += chunk.length;
        if (head.length < HEAD_KEEP) head = Buffer.concat([head, chunk.subarray(0, HEAD_KEEP - head.length)]);
        tail = tail.length + chunk.length <= TAIL_KEEP ? Buffer.concat([tail, chunk]) : Buffer.concat([tail, chunk]).subarray(tail.length + chunk.length - TAIL_KEEP);
    };
    const render = () => {
        if (total <= HEAD_KEEP + TAIL_KEEP) {
            const overlap = head.length + tail.length - total; // >= 0; that many tail bytes duplicate head
            return { text: Buffer.concat([head, tail.subarray(Math.max(0, overlap))]).toString('utf8'), truncated: false, bytes: total };
        }
        const dropped = total - HEAD_KEEP - TAIL_KEEP;
        return { text: `${head.toString('utf8')}\n...[${dropped} bytes dropped]...\n${tail.toString('utf8')}`, truncated: true, bytes: total };
    };
    return { push, render };
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
        const out = makeCapture(), err = makeCapture();
        let settled = false;
        let killError: string | null = null;
        let exitEvent: { code: number | null; signal: NodeJS.Signals | null } | null = null;
        let closeEvent = false;
        const exitWaiters: Array<() => void> = [];
        const closeWaiters: Array<() => void> = [];

        child.stdout?.on('data', (c: Buffer) => out.push(c));
        child.stderr?.on('data', (c: Buffer) => err.push(c));
        child.on('exit', (code, signal) => {
            exitEvent = { code, signal };
            for (const w of exitWaiters.splice(0)) w();
            // Normal termination settles HERE; the timeout and spawn-error
            // paths are blocked by the settled guard inside settle().
            void settle({ kind: 'exit', code, signal });
        });
        child.on('close', () => {
            closeEvent = true;
            for (const w of closeWaiters.splice(0)) w();
        });
        child.on('error', (error) => { void settle({ kind: 'spawn-error', error }); });

        const killGroup = () => {
            if (pid === undefined) return;
            try { process.kill(-pid, 'SIGKILL'); }
            catch (e: any) { if (e?.code !== 'ESRCH') killError = String(e?.message ?? e); }
        };

        const waitExit = (budgetMs: number) => new Promise<boolean>((done) => {
            if (exitEvent) return done(true);
            const t = setTimeout(() => done(false), budgetMs);
            exitWaiters.push(() => { clearTimeout(t); done(true); });
        });
        const waitClose = (budgetMs: number) => new Promise<boolean>((done) => {
            if (closeEvent) return done(true);
            const t = setTimeout(() => done(false), budgetMs);
            closeWaiters.push(() => { clearTimeout(t); done(true); });
        });
        const reapGroup = async (budgetMs: number): Promise<boolean> => {
            if (pid === undefined) return true;
            const deadline = Date.now() + budgetMs;
            let alive = groupAlive(pid);
            while (alive !== false && Date.now() < deadline) {
                await sleep(50);
                alive = groupAlive(pid);
            }
            return alive === false;
        };

        const settle = async (outcome: ChildOutcome) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const waitStart = Date.now();
            // ONE shared cleanup deadline: child timeout + this budget must stay
            // below the outer vitest allowance, so cleanup can never be outrun.
            const deadline = waitStart + CLEANUP_BUDGET_MS;
            const remaining = () => Math.max(0, deadline - Date.now());
            let childReaped = exitEvent !== null;
            // FIRST probe immediately at settlement - BEFORE any drain: a
            // transient leaked descendant that exits during the EOF window is
            // still classified as a natural-exit breach.
            const hadSurvivors = pid !== undefined && groupAlive(pid) !== false;
            let survivorsAfterCleanup = false;
            // Known survivors are killed IMMEDIATELY - before any EOF wait, so
            // a descendant holding inherited pipes cannot consume the reap budget.
            if (hadSurvivors) killGroup();
            if (outcome.kind === 'timeout') {
                childReaped = await waitExit(remaining()); // await the direct child's reap, not only the group
            }
            if (hadSurvivors && pid !== undefined) {
                survivorsAfterCleanup = !(await reapGroup(remaining()));
            }
            // Bounded EOF drain AFTER cleanup: pipes EOF once their holders are
            // gone; a still-held pipe hits the shared deadline and marks the
            // evidence incomplete.
            const drained = exitEvent !== null ? await waitClose(remaining()) : false;
            child.stdout?.destroy();
            child.stderr?.destroy();
            const o = out.render(), e = err.render();
            resolvePromise({
                outcome,
                stdout: o.text, stderr: e.text,
                stdoutBytes: o.bytes, stderrBytes: e.bytes,
                truncated: o.truncated || e.truncated,
                evidenceComplete: exitEvent !== null && drained,
                hadSurvivors,
                survivorsAfterCleanup,
                childReaped,
                killError,
                groupGoneWaitMs: Date.now() - waitStart
            });
        };

        const timer = setTimeout(() => { void settle({ kind: 'timeout' }); }, timeoutMs);
    });
};

const expectCleanChild = (result: ChildResult, mode: string) => {
    const summary = `[child ${mode}] outcome=${JSON.stringify(result.outcome)} hadSurvivors=${result.hadSurvivors} survivorsAfterCleanup=${result.survivorsAfterCleanup} childReaped=${result.childReaped} killError=${result.killError} truncated=${result.truncated} evidenceComplete=${result.evidenceComplete} stdoutBytes=${result.stdoutBytes} stderrBytes=${result.stderrBytes} groupGoneWaitMs=${result.groupGoneWaitMs}`;
    const clean = result.outcome.kind === 'exit' && result.outcome.code === 0
        && !result.hadSurvivors && !result.survivorsAfterCleanup && result.killError === null
        && !result.truncated && result.evidenceComplete
        && result.stdout.includes(`"mode":"${mode}"`);
    // Full child evidence on ANY abnormal or incomplete outcome; summary on success.
    console.log(clean ? summary : `${summary}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    expect(result.outcome.kind, `child ${mode} must exit by itself, not be killed or fail to spawn`).toBe('exit');
    if (result.outcome.kind === 'exit') {
        expect(result.outcome.code, `child ${mode} exit code`).toBe(0);
    }
    expect(result.hadSurvivors, `child ${mode} exited but left a live process group: NOT natural termination`).toBe(false);
    expect(result.survivorsAfterCleanup, `child ${mode} process group not reaped within budget`).toBe(false);
    expect(result.childReaped, `child ${mode} direct child was not reaped`).toBe(true);
    expect(result.killError, `child ${mode} group kill failed`).toBeNull();
    expect(result.truncated, `child ${mode} output exceeded head+tail capture: evidence incomplete`).toBe(false);
    expect(result.evidenceComplete, `child ${mode} streams did not reach EOF: evidence incomplete`).toBe(true);
    expect(result.stdout, `child ${mode} must print its result line`).toContain(`"mode":"${mode}"`);
};

/** Cache guard assertions. Evidence (inventory, receipt, diff) is logged
 * from the test's finally even when the child already failed; assertions
 * run only when no earlier failure would be masked. */
const assertCacheGuard = (changed: string[], incomplete: boolean) => {
    expect(installedTransformersVersion, 'installed transformers version unreadable: cache-root guard unverified').not.toBe('installed-unreadable');
    expect(installedTransformersVersion, `cache-root layout verified only for @xenova/transformers ${VERIFIED_CACHE_LAYOUT_VERSION}: guard fails closed`).toBe(VERIFIED_CACHE_LAYOUT_VERSION);
    expect(incomplete, `transformer cache snapshot incomplete: cannot prove no-change`).toBe(false);
    expect(changed, `transformer cache changed under cloud-only (new/changed: ${changed.join(', ')})`).toEqual([]);
};

const runMode = async (mode: string, childTimeoutMs: number) => {
    const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
    const cacheBefore = snapshotCache();
    let result: ChildResult | null = null;
    let cleanupError: unknown = null;
    let changed: string[] = [], incomplete = true;
    try {
        result = await runChild(directory, mode, childTimeoutMs);
        expectCleanChild(result, mode);
    } finally {
        // Safety evidence runs even - ESPECIALLY - after an abnormal outcome.
        // An evidence/cleanup failure is captured, never thrown here: the
        // primary child failure propagates untouched out of this finally.
        try {
            ({ changed, incomplete } = cacheBreach(cacheBefore));
            const inv = inventory(directory);
            console.log(`[fixture inventory ${mode}] ${inv.incomplete ? 'INCOMPLETE ' : ''}`, inv.entries);
            console.log(`[transformers receipt ${mode}] verifiedLayout=${VERIFIED_CACHE_LAYOUT_VERSION} installed=${installedTransformersVersion} cacheRootPreexisting=${cacheBefore.entries.size > 0} snapshotIncomplete=${incomplete} changed=${changed.length}${changed.length ? ' :: ' + changed.join(', ') : ''}`);
            if (result?.survivorsAfterCleanup) {
                // Runtime state unknown: RETAIN the cwd for forensics instead of
                // deleting artifacts under an unreaped process group.
                console.log(`[fixture retained ${mode}] cwd preserved at ${directory}: process group not reaped`);
            } else {
                rmSync(directory, { recursive: true, force: true });
            }
        } catch (e) {
            cleanupError = e;
            console.error(`[cleanup evidence error ${mode}]`, e);
        }
    }
    // Reached only when the child was accepted: a primary failure propagates
    // from the try above and never arrives here.
    if (cleanupError !== null) throw cleanupError;
    assertCacheGuard(changed, incomplete);
};

describe('real shutdown contracts (narrow)', () => {
    // child timeout + CLEANUP_BUDGET_MS stays below each vitest allowance.
    // Outer allowance = inner natural-exit bound (unchanged) + 4s shared
    // cleanup + 11s for the capped snapshot/inventory/rm evidence work.
    for (const mode of ['memory-never-started-fresh', 'memory-never-started-prior-wal', 'memory-blocked-store']) it(mode, async () => {
        await runMode(mode, 30000);
    }, 45000);
    for (const mode of ['redis-fallback-quiet', 'drain-receipts-ok']) it(mode, async () => {
        await runMode(mode, 90000);
    }, 105000);
});
