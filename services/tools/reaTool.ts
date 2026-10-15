/**
 * [REA Fase 2] Official squad wrapper around the REA CLI (rea-agents@6.5.0).
 *
 * REA can emit ~100 MB of evidence JSON per run; raw output must never reach
 * a prompt. This module is the single chokepoint, same bar as fileJail:
 * every invocation is classified, bounded, and audited — fail-closed.
 *
 * Configuration (env-driven, nothing hardcoded):
 *   SILHOUETTE_REA_BIN               path to the rea executable
 *                                    (default /opt/silhouette-tools/rea/node_modules/.bin/rea)
 *   SILHOUETTE_REA_ENV_FILE          shell file linking Ghidra etc.; set to
 *                                    "" to disable (default .../rea/rea-env.sh)
 *   SILHOUETTE_REA_AUDIT_LOG         JSONL audit journal (default <cwd>/data/rea-audit.jsonl)
 *   SILHOUETTE_REA_MAX_TOKENS        forced --token-limit per call (default 2000)
 *   SILHOUETTE_REA_MAX_OUTPUT_BYTES  hard stdout cap; overflow is truncated
 *                                    with an explicit marker (default 262144)
 *   SILHOUETTE_REA_TIMEOUT_MS        per-call timeout (default 120000)
 *   SILHOUETTE_REA_OVERNIGHT_START_HOUR / _END_HOUR (defaults 2 and 6, local)
 *
 * Command policy (reverse_engineering skill):
 *   - BLOCKED: self-mutation (install/uninstall/update), server modes (mcp),
 *     shell completions, and unrestricted live consoles (debug-with-gdb,
 *     cutter-command). Never available to squads.
 *   - DAYLIGHT: static JavaScript/Electron/web analysis (no native engine).
 *   - OVERNIGHT-ONLY: everything else (native/binary analysis needs Ghidra,
 *     2-4 GB RAM) — allowed only inside the overnight window.
 * Every call requires an explicit entitlement justification, recorded in the
 * audit journal next to a sha256 of the evidence actually returned.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ReaAnalyzeInput {
    command: string;
    target?: string;
    extraArgs?: string[];
    filter?: string;
    /** REQUIRED: why we are entitled to analyze this target. Audited. */
    entitlement: string;
    purpose?: string;
    /** Test hook: evaluate the overnight window against this instant. */
    now?: Date;
}

export type ReaRunResult =
    | { ok: true; command: string; mode: 'daylight' | 'overnight'; output: unknown; raw: string; truncated: boolean; evidenceSha256: string; durationMs: number }
    | { ok: false; reason: string; decision: string };

/** Never available through the squad tool: self-mutation, server modes, unrestricted live consoles. */
export const REA_BLOCKED_COMMANDS = new Set([
    'install', 'uninstall', 'update', 'mcp', 'completions',
    'debug-with-gdb',   // unrestricted GDB console in an ephemeral MI session
    'cutter-command',   // unrestricted Rizin command in a live Cutter instance
]);

/**
 * Daylight commands need no native engine: static JavaScript/Electron/web
 * analysis, passive captures, evidence compares and traces over already
 * captured evidence. Everything else (native/binary analysis via Ghidra,
 * 2-4 GB RAM) is overnight-only. Fail-closed: an unrecognized command is
 * treated as overnight, never as daylight.
 */
export const REA_DAYLIGHT_PATTERN = /(javascript|web|wasm|electron|source|bundle|screenshot|browser|ledger|capabilities|compare)/;

const TARGET_DENIED_PATTERNS: Array<{ re: RegExp; why: string }> = [
    { re: /^\.git$/i, why: 'paths may not traverse .git' },
    { re: /^\.env(\..+)?$/i, why: 'environment files may contain secrets' },
    { re: /\.(pem|key|p12|pfx|keystore|jks)$/i, why: 'key material is not analyzable through the tool' },
    { re: /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, why: 'SSH keys are not analyzable through the tool' },
];

function reaBin(): string {
    const env = (process.env.SILHOUETTE_REA_BIN || '').trim();
    return env || '/opt/silhouette-tools/rea/node_modules/.bin/rea';
}
function reaEnvFile(): string {
    if ('SILHOUETTE_REA_ENV_FILE' in process.env) return (process.env.SILHOUETTE_REA_ENV_FILE || '').trim();
    return '/opt/silhouette-tools/rea/rea-env.sh';
}
function auditLogPath(): string {
    const env = (process.env.SILHOUETTE_REA_AUDIT_LOG || '').trim();
    return env || path.join(process.cwd(), 'data', 'rea-audit.jsonl');
}
function maxTokens(): number {
    const n = Number(process.env.SILHOUETTE_REA_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}
function maxOutputBytes(): number {
    const n = Number(process.env.SILHOUETTE_REA_MAX_OUTPUT_BYTES);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 262144;
}
function timeoutMs(): number {
    const n = Number(process.env.SILHOUETTE_REA_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120000;
}
function overnightHours(): { start: number; end: number } {
    const s = Number(process.env.SILHOUETTE_REA_OVERNIGHT_START_HOUR);
    const e = Number(process.env.SILHOUETTE_REA_OVERNIGHT_END_HOUR);
    return {
        start: Number.isInteger(s) && s >= 0 && s <= 23 ? s : 2,
        end: Number.isInteger(e) && e >= 0 && e <= 23 ? e : 6,
    };
}

export function inOvernightWindow(d: Date = new Date()): boolean {
    const { start, end } = overnightHours();
    const h = d.getHours();
    return start <= end ? (h >= start && h < end) : (h >= start || h < end);
}

export function classifyCommand(command: string): 'blocked' | 'daylight' | 'overnight' {
    if (REA_BLOCKED_COMMANDS.has(command)) return 'blocked';
    return REA_DAYLIGHT_PATTERN.test(command) ? 'daylight' : 'overnight';
}

function targetDenied(target: string): string | null {
    if (/^https?:\/\//i.test(target)) return null; // public web surface: no path segments
    for (const seg of target.split(/[\\/]/)) {
        for (const { re, why } of TARGET_DENIED_PATTERNS) {
            if (re.test(seg)) return `${why} (segment "${seg}")`;
        }
    }
    return null;
}

export interface ReaAuditEntry {
    ts?: string | undefined; // set by auditRea
    command: string;
    target?: string | undefined;
    filter?: string | undefined;
    entitlement?: string | undefined;
    purpose?: string | undefined;
    mode?: 'daylight' | 'overnight' | undefined;
    decision: 'allowed-daylight' | 'allowed-overnight' | 'denied-blocked' | 'denied-window' | 'denied-entitlement' | 'denied-target' | 'denied-unavailable' | 'denied-command' | 'error';
    exitCode?: number | null | undefined;
    durationMs?: number | undefined;
    stdoutBytes?: number | undefined;
    stdoutSha256?: string | undefined;
    truncated?: boolean | undefined;
    error?: string | undefined;
    actor?: string | undefined;
    actorRole?: string | undefined;
}

export async function auditRea(entry: ReaAuditEntry): Promise<void> {
    try {
        const p = auditLogPath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    } catch (e: any) {
        console.warn(`[REA] audit write failed: ${e.message}`);
    }
}

function sha256Of(s: string): string {
    return crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
}

export async function runRea(input: ReaAnalyzeInput, actor?: { id?: string; role?: string }): Promise<ReaRunResult> {
    const base = {
        command: String(input.command || ''),
        target: input.target, filter: input.filter,
        entitlement: input.entitlement, purpose: input.purpose,
        actor: actor?.id, actorRole: actor?.role,
    };
    const deny = async (decision: ReaAuditEntry['decision'], reason: string): Promise<ReaRunResult> => {
        await auditRea({ ...base, decision, error: reason });
        return { ok: false, reason, decision };
    };

    if (!/^[a-z0-9][a-z0-9-]*$/.test(base.command)) {
        return deny('denied-command', `invalid REA command name "${base.command}"`);
    }
    const cls = classifyCommand(base.command);
    if (cls === 'blocked') {
        return deny('denied-blocked', `command "${base.command}" is never available to squads (self-mutation or unrestricted console)`);
    }
    const entitlement = (input.entitlement || '').trim();
    if (entitlement.length < 8) {
        return deny('denied-entitlement', 'entitlement is required: state why we may analyze this target (own build, open source, user-owned software, or public web surface)');
    }
    if (input.target) {
        const why = targetDenied(input.target);
        if (why) return deny('denied-target', why);
    }
    const bin = reaBin();
    if (!fs.existsSync(bin)) {
        return deny('denied-unavailable', `REA UNAVAILABLE: binary not found at ${bin} (set SILHOUETTE_REA_BIN)`);
    }
    const mode: 'daylight' | 'overnight' = cls === 'daylight' ? 'daylight' : 'overnight';
    const now = input.now || new Date();
    if (mode === 'overnight' && !inOvernightWindow(now)) {
        const { start, end } = overnightHours();
        return deny('denied-window', `command "${base.command}" requires the overnight window (${start}:00-${end}:00 local); native/binary analysis needs Ghidra RAM reserved for the service by day`);
    }

    const argv = [
        base.command,
        ...(input.target ? [input.target] : []),
        ...(input.extraArgs || []),
        '--format', 'json',
        '--token-limit', String(maxTokens()),
        ...(input.filter ? ['--filter-output', input.filter] : []),
    ];
    const envFile = reaEnvFile();
    const started = Date.now();
    const cap = maxOutputBytes();

    return await new Promise<ReaRunResult>((resolvePromise) => {
        const finish = async (r: ReaRunResult, audit: Partial<ReaAuditEntry>) => {
            await auditRea({ ...base, mode, decision: r.ok ? (mode === 'daylight' ? 'allowed-daylight' : 'allowed-overnight') : 'error', durationMs: Date.now() - started, ...audit });
            resolvePromise(r);
        };
        const onDone = async (error: Error | null, stdout: string, stderr: string) => {
            let raw = stdout || '';
            let truncated = false;
            if (Buffer.byteLength(raw, 'utf-8') > cap) {
                raw = raw.slice(0, cap) + `\n[TRUNCATED: output exceeded SILHOUETTE_REA_MAX_OUTPUT_BYTES=${cap}; re-run with --filter-output subsets]`;
                truncated = true;
            }
            if (error) {
                const tail = (stderr || error.message || '').slice(-500);
                await finish({ ok: false, reason: `REA execution failed: ${tail}`, decision: 'error' }, { exitCode: (error as any)?.code ?? null, error: tail });
                return;
            }
            let output: unknown;
            try { output = JSON.parse(raw); } catch { output = undefined; }
            await finish({
                ok: true, command: base.command, mode, output, raw,
                truncated, evidenceSha256: sha256Of(raw), durationMs: Date.now() - started,
            }, { exitCode: 0, stdoutBytes: Buffer.byteLength(raw, 'utf-8'), stdoutSha256: sha256Of(raw), truncated });
        };
        if (envFile && fs.existsSync(envFile)) {
            // Source the env file without string interpolation: everything is
            // passed as positional parameters, so no shell injection surface.
            execFile('bash', ['-c', 'source "$1" >/dev/null 2>&1 || true; shift; exec "$@"', 'bash', envFile, bin, ...argv],
                { timeout: timeoutMs(), maxBuffer: 64 * 1024 * 1024 }, onDone);
        } else {
            execFile(bin, argv, { timeout: timeoutMs(), maxBuffer: 64 * 1024 * 1024 }, onDone);
        }
    });
}
