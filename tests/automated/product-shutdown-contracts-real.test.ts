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
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, readFileSync, openSync, closeSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const environment = (directory: string, boot: 'acceptance' | 'normal' = 'acceptance') => ({
    PATH: process.env.PATH,
    HOME: directory,
    NODE_ENV: 'test',
    SILHOUETTE_PROVIDERS: 'off',
    SILHOUETTE_INFERENCE_MODE: 'cloud-only',
    SILHOUETTE_MIGRATIONS_DIR: migrationAssets,
    SILHOUETTE_BOOT_MODE: boot
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
    teeOutError: string | null;     // durable full-stdout capture failure: open/write/close (sticky, separate from the bounded oracle)
    teeErrError: string | null;     // durable full-stderr capture failure
    teeOutBytes: number;            // bytes REALLY written (stream bytesWritten at close), never assumed
    teeErrBytes: number;
    fullStdoutPath: string | null;  // durable byte-0 full capture outside the removable cwd (null: not requested)
    fullStderrPath: string | null;
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
const runChild = (directory: string, mode: string, timeoutMs: number, sharedStores: { sqlitePath: string; lancePath: string } | null = null, evidenceDir: string | null = null, boot: 'acceptance' | 'normal' = 'acceptance'): Promise<ChildResult> => {
    return new Promise((resolvePromise) => {
        // [D-CANON] Durable FULL logs: fds REALLY pre-opened (openSync)
        // BEFORE spawn, then async WriteStreams over those fds - no
        // synchronous write/fsync in the supervisor's DATA PATH. The pre-open
        // itself (openSync) and the later manifest readFileSync/hashing ARE
        // synchronous: they add overhead, carry no syscall time bound, and
        // the 4s structure is never a guaranteed real-time bound under all
        // I/O. Open failure: non-fatal, recorded as an evidence error, oracle
        // untouched. The bounded capture below remains the oracle,
        // byte-for-byte unchanged.
        const fullStdoutPath = evidenceDir === null ? null : join(evidenceDir, 'child.stdout.full.log');
        const fullStderrPath = evidenceDir === null ? null : join(evidenceDir, 'child.stderr.full.log');
        let teeOut: ReturnType<typeof createWriteStream> | null = null;
        let teeErr: ReturnType<typeof createWriteStream> | null = null;
        let teeOutError: string | null = null;
        let teeErrError: string | null = null;
        if (fullStdoutPath !== null) {
            let fd: number | null = null;
            try {
                fd = openSync(fullStdoutPath, 'w');
                teeOut = createWriteStream(fullStdoutPath, { fd });
                fd = null; // ownership TRANSFERRED to the stream (autoClose): never closed twice
                teeOut.on('error', (e: Error) => { if (teeOutError === null) teeOutError = String(e?.message ?? e); });
            } catch (e: any) {
                teeOutError = `open: ${String(e?.message ?? e)}`;
                if (fd !== null) { try { closeSync(fd); } catch { /* orphan-fd close: evidence only */ } }
            }
        }
        if (fullStderrPath !== null) {
            let fd: number | null = null;
            try {
                fd = openSync(fullStderrPath, 'w');
                teeErr = createWriteStream(fullStderrPath, { fd });
                fd = null; // ownership TRANSFERRED to the stream (autoClose): never closed twice
                teeErr.on('error', (e: Error) => { if (teeErrError === null) teeErrError = String(e?.message ?? e); });
            } catch (e: any) {
                teeErrError = `open: ${String(e?.message ?? e)}`;
                if (fd !== null) { try { closeSync(fd); } catch { /* orphan-fd close: evidence only */ } }
            }
        }
        // Sticky-failure writes: after any tee failure no more writes are
        // attempted; a write error is caught INSIDE the data path, so it can
        // never escape the listener nor impede settle/reap. The queue is
        // EXPLICITLY BOUNDED per tee: the bounded oracle does not protect the
        // stream's internal buffer, which could grow for 90s under slow disk.
        // On overflow: sticky capture-overflow INCOMPLETE, no more enqueues,
        // destroy REQUESTED (close requested, not observed). The child's
        // stdout is NEVER paused - its scheduling/backpressure stay untouched
        // - and the bounded oracle keeps consuming with kill/reap intact.
        const TEE_QUEUE_LIMIT = 4 * 1024 * 1024; // diagnostic queue bound, NOT the oracle's
        const writeTee = (tee: ReturnType<typeof createWriteStream> | null, chunk: Buffer, which: 'stdout' | 'stderr'): void => {
            if (tee === null || tee.destroyed) return;
            if (which === 'stdout' ? teeOutError !== null : teeErrError !== null) return;
            if (tee.writableLength + chunk.length > TEE_QUEUE_LIMIT) {
                if (which === 'stdout') teeOutError = 'capture-overflow: capture INCOMPLETE';
                else teeErrError = 'capture-overflow: capture INCOMPLETE';
                try { tee.destroy(); } catch { /* close requested, not observed */ }
                return;
            }
            try { tee.write(chunk); } catch (e: any) {
                if (which === 'stdout') teeOutError = `write: ${String(e?.message ?? e)}`;
                else teeErrError = `write: ${String(e?.message ?? e)}`;
            }
        };
        // argv[3] carries ONLY the evidence dir (absolute, owned by this
        // run); env and policy keys stay exactly as environment() defines.
        const args = evidenceDir === null ? ['--import', loader, script, mode] : ['--import', loader, script, mode, evidenceDir];
        let child: ChildProcess;
        try {
            child = spawn(process.execPath, args, {
                cwd: directory,
                env: sharedStores
                    ? { ...environment(directory, boot), SILHOUETTE_DB_PATH: sharedStores.sqlitePath, SILHOUETTE_LANCEDB_PATH: sharedStores.lancePath }
                    : environment(directory, boot),
                detached: true,               // own process group: descendants are killable/reap-able
                stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (e) {
            // [D-CANON] Synchronous spawn/setup failure: destroy() is
            // REQUESTED on both durable streams (close REQUESTED, NOT
            // observed before rethrow), then the PRIMARY spawn error
            // propagates untouched - evidence never replaces it.
            try { teeOut?.destroy(); } catch { /* evidence only */ }
            try { teeErr?.destroy(); } catch { /* evidence only */ }
            throw e;
        }
        const pid = child.pid;            // undefined if spawn failed synchronously
        const out = makeCapture(), err = makeCapture();
        let settled = false;
        let killError: string | null = null;
        let exitEvent: { code: number | null; signal: NodeJS.Signals | null } | null = null;
        let closeEvent = false;
        const exitWaiters: Array<() => void> = [];
        const closeWaiters: Array<() => void> = [];

        child.stdout?.on('data', (c: Buffer) => { out.push(c); writeTee(teeOut, c, 'stdout'); });
        child.stderr?.on('data', (c: Buffer) => { err.push(c); writeTee(teeErr, c, 'stderr'); });
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
            // [D-CANON] Close BOTH durable streams in PARALLEL under the SAME
            // remaining budget. end() flushes; the 'close' event (autoClose)
            // proves the fd REALLY closed - only a normal close with intact
            // bytes and zero errors credits a complete capture. Wait timers
            // are ALWAYS cleared. On budget exhaustion or end-throw, destroy()
            // is REQUESTED (close requested, NOT observed: no fd-closed claim
            // on that return) and the capture is marked INCOMPLETE via the
            // sticky error fields. Kill/reap/EOF above already ran; this wait
            // never delays them.
            const closeBudget = remaining();
            const closeTee = (tee: ReturnType<typeof createWriteStream> | null, which: 'stdout' | 'stderr'): Promise<void> => new Promise((done) => {
                if (tee === null || tee.closed) return done();
                const mark = (msg: string) => {
                    if (which === 'stdout') { if (teeOutError === null) teeOutError = msg; }
                    else { if (teeErrError === null) teeErrError = msg; }
                };
                const t = setTimeout(() => {
                    mark('close-timeout: capture INCOMPLETE');
                    try { tee.destroy(); } catch { /* evidence only */ }
                    done();
                }, closeBudget);
                tee.once('close', () => { clearTimeout(t); done(); });
                try { tee.end(); } catch (e: any) {
                    clearTimeout(t);
                    mark(`end: ${String(e?.message ?? e)}`);
                    try { tee.destroy(); } catch { /* evidence only */ }
                    done();
                }
            });
            await Promise.all([closeTee(teeOut, 'stdout'), closeTee(teeErr, 'stderr')]);
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
                groupGoneWaitMs: Date.now() - waitStart,
                teeOutError,
                teeErrError,
                teeOutBytes: teeOut === null ? 0 : teeOut.bytesWritten,
                teeErrBytes: teeErr === null ? 0 : teeErr.bytesWritten,
                fullStdoutPath,
                fullStderrPath
            });
        };

        const timer = setTimeout(() => { void settle({ kind: 'timeout' }); }, timeoutMs);
    });
};

const expectCleanChild = (result: ChildResult, mode: string) => {
    const summary = `[child ${mode}] outcome=${JSON.stringify(result.outcome)} hadSurvivors=${result.hadSurvivors} survivorsAfterCleanup=${result.survivorsAfterCleanup} childReaped=${result.childReaped} killError=${result.killError} truncated=${result.truncated} evidenceComplete=${result.evidenceComplete} stdoutBytes=${result.stdoutBytes} stderrBytes=${result.stderrBytes} groupGoneWaitMs=${result.groupGoneWaitMs} teeOutError=${result.teeOutError} teeErrError=${result.teeErrError} teeOutBytes=${result.teeOutBytes} teeErrBytes=${result.teeErrBytes} fullLogs=${result.fullStdoutPath ?? 'none'}`;
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
    // Durable-capture assertions run AFTER the primary oracle ones: an
    // evidence failure is reported, never masked, and never masks them.
    // Without a requested capture dir these are vacuously satisfied.
    expect(result.teeOutError, `child ${mode} full stdout capture failed`).toBeNull();
    expect(result.teeErrError, `child ${mode} full stderr capture failed`).toBeNull();
    if (result.fullStdoutPath !== null) {
        expect(result.teeOutBytes, `child ${mode} full stdout bytes must equal the oracle byte count`).toBe(result.stdoutBytes);
    }
    if (result.fullStderrPath !== null) {
        expect(result.teeErrBytes, `child ${mode} full stderr bytes must equal the oracle byte count`).toBe(result.stderrBytes);
    }
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

const runMode = async (mode: string, childTimeoutMs: number, boot: 'acceptance' | 'normal' = 'acceptance') => {
    const directory = mkdtempSync(join(tmpdir(), 'shutdown-contracts-real-'));
    const cacheBefore = snapshotCache();
    let result: ChildResult | null = null;
    let cleanupError: unknown = null;
    let changed: string[] = [], incomplete = true;
    try {
        result = await runChild(directory, mode, childTimeoutMs, null, null, boot);
        expectCleanChild(result, mode);
        // Relay only the structured fixture receipt, never arbitrary stdout.
        const receipt = parseModeReceipt(result.stdout, mode);
        console.log(`[shutdown receipt ${mode}] ${JSON.stringify(receipt)}`);
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
    // [D-CANON] Durable diagnostic evidence root: OUTSIDE every removable
    // phase cwd and the shared stores root, fresh per run, NEVER removed by
    // this fixture. Each phase child receives its own dir ONLY as argv[3]
    // (never via env: the module-eval policy scrub is irrelevant to it).
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'memory-restart-evidence-'));
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
            const evidenceDir = join(evidenceRoot, phase);
            mkdirSync(evidenceDir, { recursive: true });
            // [D-CANON] Path published BEFORE spawn: if everything after this
            // fails, the artifacts are recoverable at a known location.
            console.log(`[evidence dir ${phase}] ${evidenceDir}`);
            let result: ChildResult | null = null;
            let cleanupError: unknown = null;
            let changed: string[] = [], incomplete = true;
            let cacheBefore: CacheSnapshot | null = null;
            // [D-CANON] Checkpoint verification state, filled by the manifest
            // attempt in the finally below (even on timeout/oracle failure).
            let checkpointStatus: Record<string, string> = {};
            let checkpointTokens: Record<string, number> = {};
            let missingCheckpoints: string[] = [];
            let errFiles: string[] = [];
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
                result = await runChild(directory, phase, childTimeoutMs, sharedStores, evidenceDir);
                // Latch FIRST on return: no throwing work may precede this.
                safeToRemove = result.childReaped === true && result.survivorsAfterCleanup === false && result.killError === null;
                if (safeToRemove) anySurvivors = false;
                expectCleanChild(result, phase);
                phaseReceipts[phase] = parseModeReceipt(result.stdout, phase);
            } finally {
                // [D-CANON] FIRST an independent evidence manifest attempt: it
                // runs even when the oracle FAILED or the child TIMED OUT
                // (exactly the case under diagnosis) and never replaces the
                // primary error. kill/reap/EOF already finished inside settle;
                // this hashing is diagnostic overhead AFTER them - the file
                // cleanup below CAN be delayed by it, the 240s outer allowance
                // is unchanged, and no immediate cleanup is promised.
                try {
                    const names = readdirSync(evidenceDir).sort();
                    const manifest: Record<string, string> = {};
                    for (const name of names) manifest[name] = createHash('sha256').update(readFileSync(join(evidenceDir, name))).digest('hex');
                    // Stable ONLY with: streams EOF + untruncated + zero tee
                    // errors + real written bytes equal to the oracle counts +
                    // direct child reaped + no live group at any probe.
                    const bytesOk = result !== null
                        && (result.fullStdoutPath === null || result.teeOutBytes === result.stdoutBytes)
                        && (result.fullStderrPath === null || result.teeErrBytes === result.stderrBytes);
                    const stable = result?.evidenceComplete === true && result?.truncated === false
                        && result?.teeOutError === null && result?.teeErrError === null
                        && bytesOk && result?.childReaped === true
                        && result?.hadSurvivors === false && result?.survivorsAfterCleanup === false;
                    // Expected canonical checkpoints with MINIMAL SEMANTIC
                    // validation (no schema framework): mode ligature, token
                    // kind, integer non-negative token matching the evidence's
                    // own watermarkOrdinal, O2 snapshot required, O1 shape.
                    const expected = [`${phase}.predrain.json`, `${phase}.postcleanup.json`];
                    missingCheckpoints = expected.filter(n => !names.includes(n));
                    errFiles = names.filter(n => n.endsWith('.err'));
                    checkpointStatus = {};
                    checkpointTokens = {};
                    for (const n of expected) {
                        if (!names.includes(n)) { checkpointStatus[n] = 'not-reached'; continue; }
                        try {
                            const parsed = JSON.parse(readFileSync(join(evidenceDir, n), 'utf8'));
                            if (parsed?.mode !== phase) { checkpointStatus[n] = 'mode-mismatch'; continue; }
                            if (typeof parsed?.tokenKind !== 'string') { checkpointStatus[n] = 'no-token-kind'; continue; }
                            if (!Number.isInteger(parsed?.watermarkOrdinal) || parsed.watermarkOrdinal < 0) { checkpointStatus[n] = 'bad-token'; continue; }
                            if (parsed?.o2?.observation !== 'snapshot') { checkpointStatus[n] = 'o2-not-snapshot'; continue; }
                            if (parsed?.o2?.evidence?.watermarkOrdinal !== parsed.watermarkOrdinal) { checkpointStatus[n] = 'token-evidence-mismatch'; continue; }
                            const o1 = parsed?.o1;
                            if (o1?.observation === 'receipt-observed') {
                                if (o1.receipt === null || o1.receipt === undefined) { checkpointStatus[n] = 'o1-receipt-missing'; continue; }
                            } else if (o1?.observation === 'receipt-not-yet-observed') {
                                if (typeof o1.id !== 'number' || typeof o1.claimId !== 'string') { checkpointStatus[n] = 'o1-ids-missing'; continue; }
                            } else { checkpointStatus[n] = 'o1-unavailable-or-unknown'; continue; } // unavailable => partial evidence => reader HOLD
                            checkpointStatus[n] = `ok:${parsed.tokenKind}`;
                            checkpointTokens[n] = parsed.watermarkOrdinal;
                        } catch { checkpointStatus[n] = 'unparseable'; }
                    }
                    console.log(`[evidence manifest ${phase}] ${stable ? '' : 'INCOMPLETE '}root=${evidenceDir} files=${JSON.stringify(manifest)} checkpoints=${JSON.stringify(checkpointStatus)} missing=${JSON.stringify(missingCheckpoints)} errFiles=${JSON.stringify(errFiles)}`);
                } catch (e) {
                    if (cleanupError === null) cleanupError = e;
                    console.error(`[evidence manifest error ${phase}]`, e);
                }
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
            // [D-CANON] Canonical evidence gate - reached ONLY on the
            // accepted-child path (a primary failure is already propagating
            // and never arrives here): both expected checkpoints must exist,
            // pass semantic validation with tokenKind 'predrain', carry the
            // SAME token, and have zero .err side files, BEFORE the reader
            // phase is spawned. Incomplete evidence never enables the reader
            // and never yields a false PASS.
            const notOk = Object.entries(checkpointStatus).filter(([, v]) => v !== 'ok:predrain');
            const tokens = Object.values(checkpointTokens);
            const tokensDiffer = tokens.length === 2 && tokens[0] !== tokens[1];
            if (missingCheckpoints.length > 0 || errFiles.length > 0 || notOk.length > 0 || tokensDiffer) {
                throw new Error(`[evidence gate ${phase}] incomplete canonical checkpoint evidence: missing=${missingCheckpoints.join('|') || 'none'} errFiles=${errFiles.join('|') || 'none'} notOk=${notOk.map(([k, v]) => `${k}:${v}`).join('|') || 'none'} tokensDiffer=${tokensDiffer}`);
            }
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
            // [D-CANON] The evidence root is NEVER removed: full logs and
            // checkpoints must outlive every removable directory.
            console.log(`[evidence retained memory-restart] evidence root preserved at ${evidenceRoot}`);
        } catch (e) {
            // Secondary error: collected, rethrown below ONLY when no primary
            // failure is already propagating out of the try above.
            outerCleanupError = e;
            console.error('[cleanup evidence error memory-restart-shared]', e);
        }
    }
    if (outerCleanupError !== null) throw outerCleanupError;
};

// Two genuinely fresh processes share ONLY an owned cwd journal. No provider
// call is requested: both finish below the unchanged 30s narrative tick.
const runNarrativePendingRestart = async () => {
    const directory = mkdtempSync(join(tmpdir(), 'narrative-pending-real-'));
    const cacheBefore = snapshotCache();
    let retain = false;
    try {
        for (const mode of ['narrative-pending-write', 'narrative-pending-read']) {
            const result = await runChild(directory, mode, 20000);
            retain ||= result.survivorsAfterCleanup;
            expectCleanChild(result, mode);
            const receipt = parseModeReceipt(result.stdout, mode);
            expect(receipt.pendingPreserved).toBe(2);
            expect(receipt.originalWorkEqual).toBe(true);
            expect(receipt.completedDuringDrain).toBe(0);
            if (mode.endsWith('read')) expect(receipt.pendingRecovered).toBe(2);
            console.log(`[shutdown receipt ${mode}] ${JSON.stringify(receipt)}`);
        }
    } finally {
        const breach = cacheBreach(cacheBefore);
        if (!retain) rmSync(directory, { recursive: true, force: true });
        assertCacheGuard(breach.changed, breach.incomplete);
    }
};

describe('real shutdown contracts (narrow)', () => {
    it('narrative pending original work survives process restart without processing', runNarrativePendingRestart, 65000);
    // child timeout + CLEANUP_BUDGET_MS stays below each vitest allowance.
    // Outer allowance = inner natural-exit bound (unchanged) + 4s shared
    // cleanup + 11s for the capped snapshot/inventory/rm evidence work.
    for (const mode of ['producers-never-started', 'narrative-pending-storage-failure', 'memory-never-started-fresh', 'memory-never-started-prior-wal', 'memory-blocked-store']) it(mode, async () => {
        await runMode(mode, 30000);
    }, 45000);
    // Fallback-family children run under NORMAL boot: after the corte, the
    // acceptance gate in redisClient.connect() hard-disables the mock
    // fallback these modes assert (redis-policy-barrier pins that). Under
    // normal boot with SILHOUETTE_PROVIDERS=off the child exercises the REAL
    // Redis-client refusal path the suite now supervises. loopback-rejected
    // / dedicated-barrier and the memory write/read env stay acceptance
    // (defaults untouched above).
    for (const mode of ['redis-fallback-quiet', 'drain-receipts-ok', 'sqlite-close-causality']) it(mode, async () => {
        await runMode(mode, 90000, 'normal');
    }, 105000);
    // Two sequential 90s children + per-phase evidence work, one allowance.
    it('memory-restart-facts', async () => {
        await runMemoryRestart(90000);
    }, 240000);
});
