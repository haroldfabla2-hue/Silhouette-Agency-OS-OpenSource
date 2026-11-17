/** Actual subprocesses, real sockets and filesystem, providers OFF.
 * Narrow shutdown contracts: redis fallback quiet-but-visible with a
 * shared disconnect receipt, continuous-memory never-started vs
 * blocked-store distinction with a STICKY failure, honest drain
 * outcomes, and drain step-5 SQLite busy causality (fail while busy,
 * repeat not consumed, release, retry closes for real). The fixture holds its own controlled endpoint on an
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

// sharedStores is a strict WHITELIST: only the two owned store paths may be
// injected into the child env. Policy keys (SILHOUETTE_PROVIDERS=off,
// SILHOUETTE_INFERENCE_MODE=cloud-only, NODE_ENV, ...) come exclusively from
// environment() and can never be overridden through this path.
const runChild = (directory: string, mode: string, timeoutMs: number, sharedStores: { sqlitePath: string; lancePath: string } | null = null): Promise<ChildResult> => {
    return new Promise((resolvePromise) => {
        const child: ChildProcess = spawn(process.execPath, ['--import', loader, script, mode], {
            cwd: directory,
            env: sharedStores
                ? { ...environment(directory), SILHOUETTE_DB_PATH: sharedStores.sqlitePath, SILHOUETTE_LANCEDB_PATH: sharedStores.lancePath }
                : environment(directory),
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

/** Cross-process memory-restart slice: TWO sequential children that share ONLY
 * the two owned fixture stores (explicit SILHOUETTE_DB_PATH and
 * SILHOUETTE_LANCEDB_PATH inside one owned shared root). Each child still gets
 * its own disposable cwd/HOME, so every cwd-relative state (continuum snapshot,
 * quota ledger, memory transitions) stays per-child owned and is never shared
 * or inherited. Phase order is the oracle: the reader process only passes when
 * the writer process genuinely persisted. */
/** The child's own JSON receipt line, parsed from captured stdout (other
 * module logs share the stream): exactly one parseable line carrying the
 * mode marker is required - no receipt, no pass. */
const parseModeReceipt = (stdout: string, phase: string): any => {
    const lines = stdout.split('\n').filter(l => l.startsWith('{') && l.includes(`"mode":"${phase}"`));
    expect(lines.length, `child ${phase} must print exactly one JSON receipt line`).toBe(1);
    return JSON.parse(lines[0]);
};

/** Intentional shape assertion for receipt id arrays: an array of exactly
 * `length` distinct nonempty strings. Malformed fields fail HERE with a clear
 * oracle message, never downstream by coercion. */
const expectIdArray = (value: unknown, label: string, length: number): string[] => {
    expect(Array.isArray(value), `${label} must be an array`).toBe(true);
    const arr = value as unknown[];
    expect(arr.length, `${label} must contain exactly ${length} entries`).toBe(length);
    for (const v of arr) {
        expect(typeof v, `${label} entries must be strings`).toBe('string');
        expect((v as string).length, `${label} entries must be nonempty`).toBeGreaterThan(0);
    }
    expect(new Set(arr).size, `${label} entries must be distinct`).toBe(arr.length);
    return arr as string[];
};

const runMemoryRestart = async (childTimeoutMs: number) => {
    const sharedRoot = mkdtempSync(join(tmpdir(), 'memory-restart-shared-'));
    const sharedStores = {
        sqlitePath: join(sharedRoot, 'facts.sqlite'),
        lancePath: join(sharedRoot, 'lance')
    };
    // Retention latch: set from each ChildResult IMMEDIATELY on return, before
    // any evidence work that could throw. An unresolved result is conservatively
    // treated as possible survivors: shared stores are never deleted while an
    // unreaped child may still hold them.
    let anySurvivors = true;
    let outerCleanupError: unknown = null;
    const phaseReceipts: Record<string, any> = {};
    try {
        for (const phase of ['memory-restart-write', 'memory-restart-read']) {
            const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
            let result: ChildResult | null = null;
            let cleanupError: unknown = null;
            let changed: string[] = [], incomplete = true;
            let cacheBefore: CacheSnapshot | null = null;
            // safeToRemove: the ONE reaping verdict, latched from ChildResult
            // before any evidence work. A null/unsettled result or any
            // unresolved kill/reap signal retains BOTH this phase cwd and
            // (via anySurvivors) the shared root.
            let safeToRemove = false;
            try {
                // Conservative BEFORE the attempt: until a reaped ChildResult
                // says otherwise, a possibly-live child may hold the stores.
                anySurvivors = true;
                cacheBefore = snapshotCache();
                result = await runChild(directory, phase, childTimeoutMs, sharedStores);
                // Latch FIRST on return: no throwing work may precede this.
                safeToRemove = result.childReaped === true && result.survivorsAfterCleanup === false && result.killError === null;
                if (safeToRemove) anySurvivors = false;
                expectCleanChild(result, phase);
                phaseReceipts[phase] = parseModeReceipt(result.stdout, phase);
            } finally {
                // Evidence and removal are INDEPENDENT attempts: an evidence
                // failure never skips the removal of a safely reaped child's
                // cwd, a removal failure never replaces the primary error, and
                // neither masks a cache-snapshot acquisition failure above.
                try {
                    if (cacheBefore !== null) {
                        ({ changed, incomplete } = cacheBreach(cacheBefore));
                        const inv = inventory(directory);
                        console.log(`[fixture inventory ${phase}] ${inv.incomplete ? 'INCOMPLETE ' : ''}`, inv.entries);
                        console.log(`[transformers receipt ${phase}] verifiedLayout=${VERIFIED_CACHE_LAYOUT_VERSION} installed=${installedTransformersVersion} cacheRootPreexisting=${cacheBefore.entries.size > 0} snapshotIncomplete=${incomplete} changed=${changed.length}${changed.length ? ' :: ' + changed.join(', ') : ''}`);
                    }
                } catch (e) {
                    cleanupError = e;
                    console.error(`[cleanup evidence error ${phase}]`, e);
                }
                try {
                    if (safeToRemove) {
                        rmSync(directory, { recursive: true, force: true });
                    } else {
                        console.log(`[fixture retained ${phase}] cwd preserved at ${directory}: child not safely reaped`);
                    }
                } catch (e) {
                    if (cleanupError === null) cleanupError = e;
                    console.error(`[cleanup removal error ${phase}]`, e);
                }
            }
            if (cleanupError !== null) throw cleanupError;
            // cacheBefore is non-null here: its acquisition failure above is a
            // primary error that already propagated, so the guard never skips.
            assertCacheGuard(changed, incomplete);
        }
        // Receipt SHAPE validation (intentional oracle assertions, not
        // incidental iteration): mode markers, truthful drain receipts, and
        // exact id-array shapes for both phases.
        const writer = phaseReceipts['memory-restart-write'];
        expect(writer.mode, 'writer receipt mode').toBe('memory-restart-write');
        expect(writer.drain_ok, 'writer drain must report true').toBe(true);
        const writerSqlite = expectIdArray(writer.sqlite_ids, 'writer sqlite_ids', 3);
        const writerLance = expectIdArray(writer.lance_fact_ids, 'writer lance_fact_ids', 3);
        expect([...writerLance].sort(), 'writer Lance factids must match writer SQLite ids').toEqual([...writerSqlite].sort());
        const reader = phaseReceipts['memory-restart-read'];
        expect(reader.mode, 'reader receipt mode').toBe('memory-restart-read');
        expect(reader.drain_ok, 'reader drain must report true').toBe(true);
        const readerA = expectIdArray(reader.sqlite_ids_a, 'reader sqlite_ids_a', 2);
        const readerB = expectIdArray(reader.sqlite_ids_b, 'reader sqlite_ids_b', 1);
        const readerLance = expectIdArray(reader.lance_fact_ids, 'reader lance_fact_ids', 3);
        // Cross-process identity comparison on validated shapes: the fresh
        // reader's SQLite ids AND Lance factids must both equal the writer's
        // unique id set. This is the restart outcome, not a log impression.
        const writerSet = [...writerSqlite].sort();
        expect([...readerA, ...readerB].sort(), 'fresh-reader SQLite ids must match writer ids exactly').toEqual(writerSet);
        expect([...readerLance].sort(), 'fresh-reader Lance factids must match writer ids exactly').toEqual(writerSet);
        console.log(`[memory-restart receipt write] ${JSON.stringify(writer)}`);
        console.log(`[memory-restart receipt read] ${JSON.stringify(reader)}`);
    } finally {
        // Outer cleanup is INDEPENDENT: secondary errors are collected and
        // rethrown only when no primary failure is already propagating.
        try {
            const sharedInv = inventory(sharedRoot);
            console.log(`[fixture inventory memory-restart-shared] ${sharedInv.incomplete ? 'INCOMPLETE ' : ''}`, sharedInv.entries);
            if (anySurvivors) {
                console.log(`[fixture retained memory-restart] shared root preserved at ${sharedRoot}: process group not reaped or outcome unresolved`);
            } else {
                rmSync(sharedRoot, { recursive: true, force: true });
            }
        } catch (e) {
            // Secondary error: collected, rethrown below ONLY when no primary
            // failure is already propagating out of the try above.
            outerCleanupError = e;
            console.error('[cleanup evidence error memory-restart-shared]', e);
        }
    }
    if (outerCleanupError !== null) throw outerCleanupError;
};

describe('real shutdown contracts (narrow)', () => {
    // child timeout + CLEANUP_BUDGET_MS stays below each vitest allowance.
    // Outer allowance = inner natural-exit bound (unchanged) + 4s shared
    // cleanup + 11s for the capped snapshot/inventory/rm evidence work.
    for (const mode of ['memory-never-started-fresh', 'memory-never-started-prior-wal', 'memory-blocked-store']) it(mode, async () => {
        await runMode(mode, 30000);
    }, 45000);
    for (const mode of ['redis-fallback-quiet', 'drain-receipts-ok', 'sqlite-close-causality']) it(mode, async () => {
        await runMode(mode, 90000);
    }, 105000);
    // Two sequential 90s children + per-phase evidence work, one allowance.
    it('memory-restart-facts', async () => {
        await runMemoryRestart(90000);
    }, 240000);
});
