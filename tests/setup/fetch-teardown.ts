/**
 * Global fetch teardown guard (CI hygiene).
 *
 * Symptom fixed here: vitest workers crashed AFTER all tests passed with
 * `[vitest-worker]: Closing rpc while "fetch" was pending` (main run
 * 38745508819 on 3e56a32; PR #146 run before its rerun), attributing the
 * crash to whatever file happened to be active at teardown
 * (daemon-state-persistence, daemon-lock-resilience). Every test in those
 * runs was green; the pending fetch is a leftover socket from an earlier
 * file in the same reused worker process — the native fetch connection
 * pool is process-global and survives per-file module isolation.
 *
 * Guard: after each file, abort every in-flight request on the global
 * dispatcher and install a fresh Agent for the next file. No test result
 * is hidden: recorded failures stand; this only stops dangling sockets
 * from crashing the worker when the rpc closes.
 */
import { afterAll } from 'vitest';
import { getGlobalDispatcher, setGlobalDispatcher, Agent } from 'undici';

afterAll(async () => {
    try {
        await getGlobalDispatcher().destroy();
    } catch {
        // best effort: a dispatcher mid-close must not fail the file
    }
    setGlobalDispatcher(new Agent());
});
