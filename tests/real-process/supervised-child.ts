/**
 * Shared supervised-child runner for real-process fixtures.
 *
 * Ported from the REVIEWED supervisor contract in
 * tests/automated/product-shutdown-contracts-real.test.ts, generalized only
 * in that the script path, args, env and timeout are parameters. The
 * contract is unchanged:
 * - spawn 'error' resolves the outcome (the promise can never hang);
 * - stdout/stderr are captured head+tail IN BYTES with exact counts and
 *   bounded memory; any dropped middle bytes mark the evidence truncated;
 * - normal completion settles at the direct child's 'exit'; streams are
 *   then drained until EOF ('close') under a shared bounded deadline - a
 *   still-held pipe marks the evidence incomplete;
 * - the FIRST post-exit/timeout group probe classifies natural exit: a live
 *   group then means a leaked descendant (hadSurvivors) EVEN IF the later
 *   cleanup succeeds; known survivors are killed immediately, the direct
 *   child's reap AND group absence are awaited under the cleanup deadline;
 * - group liveness treats ONLY ESRCH as gone (EPERM/other = alive/unknown);
 *   kill failures other than ESRCH are recorded in killError;
 * - ESRCH proves only THIS process group is gone: a detached descendant
 *   that created its own session escapes the probe (declared residual gap).
 * - the MINIMAL state observers (exit/close/error) are installed first,
 *   before any other setup: every later failure route (including the
 *   emergency one) can rely on real events instead of a setup that may
 *   have failed. If even that minimal installation throws, a bare 'error'
 *   swallow prevents an unhandled child 'error' from crashing the runner,
 *   and the emergency route still kills and probes the group INDEPENDENTLY;
 *   the result is then unverified and failed, never claimed protected.
 * - an unexpected throw ANYWHERE in the supervisor (inside settle, inside a
 *   capture callback, or synchronously after spawn) takes the same
 *   fail-closed EMERGENCY route: kill if the pid exists and the group is
 *   not confirmed absent, await exit + group reap + EOF under the shared
 *   budget, reconcile with process state (exitCode/signalCode) rather than
 *   handler-written events alone, destroy the pipes, then resolve a FAILED
 *   result carrying runnerError. The emergency path is non-recursive: its
 *   own failures are appended to runnerError, never re-routed. Cleanup
 *   never converts a failure into success.
 * Timeout/survivor/truncation always fail; cleanup never converts to success.
 */
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;

export const HEAD_KEEP = 128 * 1024;
export const TAIL_KEEP = 128 * 1024;
/** Shared across EOF drain + reap: child timeout + this budget must stay
 * under the outer vitest allowance, so cleanup can never be outrun. */
export const CLEANUP_BUDGET_MS = 4000;

export type ChildOutcome =
    | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
    | { kind: 'spawn-error'; error: Error }
    | { kind: 'timeout' };

export interface ChildResult {
    outcome: ChildOutcome;
    stdout: string;
    stderr: string;
    stdoutBytes: number;
    stderrBytes: number;
    truncated: boolean;             // output bytes were dropped: evidence NOT complete
    evidenceComplete: boolean;      // streams reached EOF before the drain deadline
    hadSurvivors: boolean;          // group alive at the FIRST post-exit/timeout probe
    survivorsAfterCleanup: boolean; // still alive or unknown after kill + bounded reap
    childReaped: boolean;           // direct child 'exit' observed (or reconciled from exitCode/signalCode on the emergency path)
    killError: string | null;
    runnerError: string | null;     // unexpected throw INSIDE the supervisor itself (fail-closed)
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

/** Head+tail capture in BYTES with exact counts and bounded memory. */
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

export interface RunChildSpec {
    /** Absolute path of the child entry script (run under the tsx loader). */
    script: string;
    args?: string[];
    cwd: string;
    /** COMPLETE child env: the caller owns the full whitelist. */
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
}

export const runChild = (spec: RunChildSpec): Promise<ChildResult> => {
    return new Promise((resolvePromise) => {
        let child: ChildProcess;
        try {
            child = spawn(
                process.execPath,
                ['--import', loader, spec.script, ...(spec.args ?? [])],
                {
                    cwd: spec.cwd,
                    env: spec.env,
                    detached: true,               // own process group: descendants are killable/reap-able
                    stdio: ['ignore', 'pipe', 'pipe']
                }
            );
        } catch (e: any) {
            // spawn threw SYNCHRONOUSLY: no process exists, nothing to reap.
            resolvePromise({
                outcome: { kind: 'spawn-error', error: e instanceof Error ? e : new Error(String(e)) },
                stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
                truncated: false, evidenceComplete: false,
                hadSurvivors: false, survivorsAfterCleanup: false,
                childReaped: false, killError: null, runnerError: null, groupGoneWaitMs: 0
            });
            return;
        }
        const pid = child.pid;            // undefined if spawn failed asynchronously
        const out = makeCapture(), err = makeCapture();
        let settled = false;
        let emergencyStarted = false;
        let killError: string | null = null;
        let runnerError: string | null = null;
        let runnerFailure: Error | null = null;
        let exitEvent: { code: number | null; signal: NodeJS.Signals | null } | null = null;
        let closeEvent = false;
        const exitWaiters: Array<() => void> = [];
        const closeWaiters: Array<() => void> = [];
        let timer: ReturnType<typeof setTimeout> | undefined;

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

        // Emergency route for an unexpected supervisor throw: INDEPENDENT and
        // bounded, non-recursive. It reconciles with PROCESS state
        // (exitCode/signalCode, set by Node itself) in addition to the
        // handler-written events, so it does not depend on any setup that
        // may have failed. Every step records; nothing rethrows; the
        // resolved result is ALWAYS failed (never green via cleanup).
        const emergencyReap = async () => {
            const waitStart = Date.now();
            const deadline = waitStart + CLEANUP_BUDGET_MS;
            const remaining = () => Math.max(0, deadline - Date.now());
            let childReaped = exitEvent !== null || child.exitCode !== null || child.signalCode !== null;
            let hadSurvivors = false;
            let survivorsAfterCleanup = false;
            try {
                hadSurvivors = pid !== undefined && groupAlive(pid) !== false;
                if (hadSurvivors) killGroup();
                if (!childReaped && pid !== undefined) {
                    // waitExit uses the minimal observers when installed;
                    // the exitCode/signalCode recheck reconciles either way.
                    childReaped = (await waitExit(remaining())) || child.exitCode !== null || child.signalCode !== null;
                }
                // Group probes are INDEPENDENT of any event handler.
                if (hadSurvivors && pid !== undefined) survivorsAfterCleanup = !(await reapGroup(remaining()));
                // Give held pipes a bounded chance to reach EOF before the
                // destroys below; the result stays fail-closed regardless
                // (evidenceComplete is always false on this path).
                if (exitEvent !== null || child.exitCode !== null || child.signalCode !== null) {
                    await waitClose(remaining());
                }
            } catch (e2: any) {
                // A failure INSIDE the emergency path is appended, never
                // re-routed into recordRunnerError (no recursion).
                runnerError = `${runnerError}\nemergency reap also failed: ${String(e2?.stack ?? e2)}`;
                survivorsAfterCleanup = pid !== undefined ? groupAlive(pid) !== false : true;
            }
            try { child.stdout?.destroy(); } catch { /* result is already fail-closed */ }
            try { child.stderr?.destroy(); } catch { /* result is already fail-closed */ }
            let o = { text: '', truncated: true, bytes: 0 };
            let eo = { text: '', truncated: true, bytes: 0 };
            try { o = out.render(); } catch { /* capture failure stays truncated */ }
            try { eo = err.render(); } catch { /* capture failure stays truncated */ }
            resolvePromise({
                outcome: { kind: 'spawn-error', error: runnerFailure ?? new Error(runnerError ?? 'supervisor emergency') },
                stdout: o.text, stderr: eo.text,
                stdoutBytes: o.bytes, stderrBytes: eo.bytes,
                truncated: true, evidenceComplete: false,
                hadSurvivors,
                survivorsAfterCleanup,
                childReaped,
                killError, runnerError, groupGoneWaitMs: Date.now() - waitStart
            });
        };

        // Defensive: an unexpected throw inside settle, inside a capture
        // callback, or synchronously after spawn must still reap the process
        // and resolve a FAIL-CLOSED result, never an unhandled rejection, a
        // silent hang, or a live orphan.
        const recordRunnerError = (e: any) => {
            if (emergencyStarted) return; // already on the emergency path: no recursion
            emergencyStarted = true;
            settled = true;               // block every normal settle path
            if (timer !== undefined) clearTimeout(timer);
            runnerError = String(e?.stack ?? e);
            runnerFailure = e instanceof Error ? e : new Error(String(e));
            void emergencyReap();
        };

        const settle = async (outcome: ChildOutcome) => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            const waitStart = Date.now();
            // ONE shared cleanup deadline: child timeout + this budget must
            // stay below the outer vitest allowance.
            const deadline = waitStart + CLEANUP_BUDGET_MS;
            const remaining = () => Math.max(0, deadline - Date.now());
            let childReaped = exitEvent !== null;
            // FIRST probe immediately at settlement - BEFORE any drain: a
            // transient leaked descendant that exits during the EOF window is
            // still classified as a natural-exit breach.
            const hadSurvivors = pid !== undefined && groupAlive(pid) !== false;
            let survivorsAfterCleanup = false;
            // Known survivors are killed IMMEDIATELY - before any EOF wait,
            // so a descendant holding inherited pipes cannot consume the
            // reap budget.
            if (hadSurvivors) killGroup();
            // Await the direct child's reap on EVERY path that can reach
            // settlement without an 'exit': timeout AND spawn-error with a
            // defined pid (a half-spawned process is still a process).
            if (exitEvent === null && pid !== undefined) {
                childReaped = await waitExit(remaining());
            }
            if (hadSurvivors && pid !== undefined) {
                survivorsAfterCleanup = !(await reapGroup(remaining()));
            }
            // Bounded EOF drain AFTER cleanup: pipes EOF once their holders
            // are gone; a still-held pipe hits the shared deadline and marks
            // the evidence incomplete.
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
                runnerError,
                groupGoneWaitMs: Date.now() - waitStart
            });
        };

        // MINIMAL state observers FIRST, before any other setup: the settle
        // and emergency routes both depend on exitEvent/closeEvent. If even
        // this installation throws, the emergency route still kills and
        // probes the group independently, and the result stays unverified
        // and failed - never claimed protected.
        try {
            child.on('exit', (code, signal) => {
                exitEvent = { code, signal };
                for (const w of exitWaiters.splice(0)) w();
                // Normal termination settles HERE; the timeout and spawn-error
                // paths are blocked by the settled guard inside settle().
                void settle({ kind: 'exit', code, signal }).catch(recordRunnerError);
            });
            child.on('close', () => {
                closeEvent = true;
                for (const w of closeWaiters.splice(0)) w();
            });
            child.on('error', (error) => { void settle({ kind: 'spawn-error', error }).catch(recordRunnerError); });
        } catch (e) {
            // Partial installation can leave 'error' unwatched: an unhandled
            // child 'error' event would crash the test runner. Swallow later
            // error events - the emergency route already owns the outcome.
            try { child.on('error', () => { /* emergency route owns the outcome */ }); } catch { /* nothing more to attach */ }
            recordRunnerError(e);
            return;
        }

        try {
            // Capture callbacks are individually protected: a throw inside
            // 'data' fires LATER, outside this registration try, and must
            // reach the same emergency route instead of crashing a listener.
            child.stdout?.on('data', (c: Buffer) => { try { out.push(c); } catch (e) { recordRunnerError(e); } });
            child.stderr?.on('data', (c: Buffer) => { try { err.push(c); } catch (e) { recordRunnerError(e); } });
            timer = setTimeout(() => { void settle({ kind: 'timeout' }).catch(recordRunnerError); }, spec.timeoutMs);
        } catch (e) {
            // A SYNCHRONOUS post-spawn failure with the minimal observers
            // already installed: the emergency route can demonstrate
            // kill/reap/EOF from real events - never a rejected promise.
            recordRunnerError(e);
        }
    });
};

/** Shared assertions: a clean child exits by itself with code 0, leaves no
 * process group, is reaped, kills nothing, and produces complete evidence
 * containing the expected receipt marker. Vitest-agnostic: throws Error with
 * full evidence on failure so any runner can use it. */
export const assertCleanChild = (result: ChildResult, label: string, receiptMarker: string): void => {
    const summary = `[child ${label}] outcome=${JSON.stringify(result.outcome)} hadSurvivors=${result.hadSurvivors} survivorsAfterCleanup=${result.survivorsAfterCleanup} childReaped=${result.childReaped} killError=${result.killError} runnerError=${result.runnerError} truncated=${result.truncated} evidenceComplete=${result.evidenceComplete} stdoutBytes=${result.stdoutBytes} stderrBytes=${result.stderrBytes} groupGoneWaitMs=${result.groupGoneWaitMs}`;
    const failures: string[] = [];
    if (result.outcome.kind !== 'exit') failures.push(`child ${label} must exit by itself, not be killed or fail to spawn`);
    if (result.outcome.kind === 'exit' && result.outcome.code !== 0) failures.push(`child ${label} exit code ${result.outcome.code}`);
    if (result.hadSurvivors) failures.push(`child ${label} exited but left a live process group: NOT natural termination`);
    if (result.survivorsAfterCleanup) failures.push(`child ${label} process group not reaped within budget`);
    if (!result.childReaped) failures.push(`child ${label} direct child was not reaped`);
    if (result.killError !== null) failures.push(`child ${label} group kill failed: ${result.killError}`);
    if (result.truncated) failures.push(`child ${label} output exceeded head+tail capture: evidence incomplete`);
    if (!result.evidenceComplete) failures.push(`child ${label} streams did not reach EOF: evidence incomplete`);
    if (result.runnerError !== null) failures.push(`child ${label} supervisor itself threw: ${result.runnerError}`);
    if (result.outcome.kind === 'exit' && result.outcome.code === 0 && !result.stdout.includes(receiptMarker)) {
        failures.push(`child ${label} exited 0 without the receipt marker "${receiptMarker}"`);
    }
    if (failures.length > 0) {
        throw new Error(`${summary}\nFAILURES:\n- ${failures.join('\n- ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    console.log(summary);
};
