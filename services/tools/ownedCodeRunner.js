// Node backend only. Process ownership/output limits are not an OS security sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
let trustedResourceRoot;
const ownedFaults = new WeakSet();
function configureCodeResourceRoot(root) {
    // Bootstrap-only injection. Never call with tool arguments/model output.
    if (trustedResourceRoot !== undefined) throw new Error('Code resource root already configured');
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Resource root must be absolute');
    const actual = fs.realpathSync(root);
    if (actual !== path.normalize(root) || !fs.statSync(actual).isDirectory()) throw new Error('Resource root must be canonical');
    trustedResourceRoot = actual;
}
function runnerPath(cwd = process.cwd()) {
    const root = trustedResourceRoot || cwd;
    const file = path.join(root, 'scripts', 'sandbox_runner.js');
    if (file.split(path.sep).some(x => x.endsWith('.asar'))) throw new Error('Code runner must be outside ASAR');
    const actual = fs.realpathSync(file);
    if (actual !== file || !actual.startsWith(root + path.sep) || !fs.statSync(actual).isFile()) throw new Error('Invalid code runner path');
    return actual;
}
function fault(code, cleanup = 'not-started') {
    const error = new Error('Code runner failed: ' + code);
    ownedFaults.add(error);
    error.code = code;
    error.cleanup = cleanup;
    return error;
}
function boundedText(value, maxBytes) {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length <= maxBytes) return value;
    return bytes.subarray(0, Math.max(0, maxBytes - 32)).toString('utf8') + '[truncated]';
}
function preparePayload(payload, maxInputBytes) {
    // Preserve the existing CODE wire conversion, including toJSON/getters,
    // omitted undefined object fields, array nulls and nonfinite number nulls.
    // Serialization can execute caller JS and allocate without a bound, as before.
    // This is process ownership, not an OS/CPU/RSS security boundary.
    if (!payload || typeof payload.code !== 'string') throw fault('INPUT_CODE_TYPE');
    const serialized = JSON.stringify({ code: payload.code, args: payload.args });
    // Optional trusted-owner limit only. No ungrounded new production input cap.
    if (maxInputBytes !== undefined && Buffer.byteLength(serialized) > maxInputBytes) throw fault('INPUT_LIMIT');
    return serialized;
}
function deliverRunnerData(parsed, onLog) {
    // Child output is bounded user/tool DATA, never a trusted diagnostic or instruction.
    let used = 0, truncated = false;
    if (Array.isArray(parsed.logs)) {
        for (let i = 0; i < parsed.logs.length; i++) {
            const value = parsed.logs[i];
            if (typeof value !== 'string') continue;
            if (i >= 64 || used + Buffer.byteLength(value) > 16 * 1024) { truncated = true; break; }
            used += Buffer.byteLength(value);
            onLog(value);
        }
        if (truncated) onLog('[runner logs truncated]');
    }
    if (parsed.success !== true) {
        const error = fault('EXECUTION_ERROR', 'closed');
        error.executionMessage = boundedText(typeof parsed.error === 'string' ? parsed.error : 'Execution failed inside sandbox', 2048);
        // Preserve the bounded execution message separately from fixed infrastructure diagnostics.
        error.message = 'Code execution failed: ' + error.executionMessage;
        throw error;
    }
    return parsed.result;
}
function runOwnedJsonChild({ executable, entry, cwd, payload, timeoutMs = 5000, termGraceMs = 100, closeWaitMs = 1000, maxInputBytes = undefined, maxOutputBytes = 1024 * 1024, onLog = message => console.log('[Sandbox Log]', message) }) {
    // This lower-level executor accepts trusted owner parameters only, not tool input.
    let serialized;
    try { serialized = preparePayload(payload, maxInputBytes); } catch (error) { return Promise.reject(ownedFaults.has(error) ? error : fault('INPUT_SERIALIZATION'));  }
    return new Promise((resolve, reject) => {
        let child, firstFailure, timer, forceTimer, closeTimer, settled = false, totalBytes = 0, retainedBytes = 0, exitCode = null, exitSignal = null;
        const chunks = [];
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(closeTimer);
            if (error) {
                error.details = { pid: child?.pid, observedOutputBytes: totalBytes, retainedOutputBytes: retainedBytes, exitCode, signal: exitSignal, cleanup: error.cleanup };
                reject(error);
            } else resolve(result);
        };
        const failFirst = code => {
            if (firstFailure || settled) return;
            firstFailure = fault(code, 'awaiting-close');
            clearTimeout(timer);
            // Don't destroy stdin with an Error: errors are handled explicitly below.
            child.stdin.destroy();
            try { child.kill('SIGTERM'); } catch (_) { /* escalation remains bounded */ }
            forceTimer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch (_) { /* close or explicit unresolved */ }
                closeTimer = setTimeout(() => {
                    firstFailure.cleanup = 'UNRESOLVED-no-close-after-force';
                    finish(firstFailure);
                }, closeWaitMs);
            }, termGraceMs);
        };
        try {
            child = spawn(executable, [entry], { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (_) { finish(fault('SPAWN_THROW')); return; }
        // Attach every listener synchronously, before writing or starting work.
        child.on('error', () => failFirst('SPAWN_ERROR'));
        child.stdin.on('error', () => failFirst('STDIN_ERROR'));
        child.stdout.on('error', () => failFirst('STDOUT_ERROR'));
        child.stderr.on('error', () => failFirst('STDERR_ERROR'));
        const collect = (data, stdout) => {
            const remaining = Math.max(0, maxOutputBytes - totalBytes);
            if (stdout && remaining) {
                const kept = Buffer.from(data.subarray(0, remaining));
                chunks.push(kept); retainedBytes += kept.length;
            }
            totalBytes = Math.min(Number.MAX_SAFE_INTEGER, totalBytes + data.length);
            if (totalBytes > maxOutputBytes) failFirst('OUTPUT_LIMIT');
        };
        child.stdout.on('data', data => collect(data, true));
        child.stderr.on('data', data => collect(data, false));
        child.on('close', (code, signal) => {
            if (settled) return;
            exitCode = code; exitSignal = signal;
            if (firstFailure) { firstFailure.cleanup = 'closed'; firstFailure.exitCode = code; firstFailure.signal = signal; finish(firstFailure); return; }
            if (code !== 0 || signal) { finish(fault('EXIT_STATUS', 'closed')); return; }
            let parsed;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { finish(fault('INVALID_JSON', 'closed')); return; }
            if (!parsed || typeof parsed !== 'object') { finish(fault('INVALID_RESPONSE', 'closed')); return; }
            try { finish(null, deliverRunnerData(parsed, onLog)); } catch (error) { finish(error.code === 'EXECUTION_ERROR' ? error : fault('LOG_SINK_ERROR', 'closed')); }
        });
        timer = setTimeout(() => failFirst('TIMEOUT'), timeoutMs);
        try {
            child.stdin.end(serialized, error => { if (error) failFirst('STDIN_ERROR'); });
        } catch (_) { failFirst('STDIN_WRITE'); }
    });
}
function runCodeInOwnedChild(code, args) {
    if (process.versions.electron) return Promise.reject(fault('NODE_BACKEND_REQUIRED'));
    let entry;
    try { entry = runnerPath(); } catch (_) { return Promise.reject(fault('MISSING_OR_INVALID_RUNNER')); }
    // process.execPath is the already selected Node backend, never Electron main/PATH node.
    return runOwnedJsonChild({ executable: process.execPath, entry, cwd: process.cwd(), payload: { code, args } });
}
export { configureCodeResourceRoot, runnerPath, runOwnedJsonChild, runCodeInOwnedChild };
