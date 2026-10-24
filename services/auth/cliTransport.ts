/**
 * [auth-connections] REAL transport for official CLI/SDK routes: Silhouette
 * invokes the vendor's own binary, and the vendor binary does the OAuth -
 * subscription tokens never enter Silhouette stores, env, or logs. The
 * active account routes the call through a per-account env overlay:
 *   cli-home:/path   -> CODEX_HOME-style home dir holding the CLI's own login
 *   env:VAR_NAME     -> pass that env var (e.g. an officially issued setup
 *                       token) to the child process only
 * No subscription OAuth is converted into a Silhouette bearer credential.
 * Vendor login validation is PENDING owner accounts/plans; the mechanics
 * here (detection, routing, timeout, redaction) are what this module proves.
 */
import { spawn } from 'node:child_process';
import { realpathSync, statSync, accessSync, constants } from 'node:fs';
import { delimiter, join, isAbsolute } from 'node:path';
import type { ProviderAccount } from './accountStore';

export interface CliInvocation {
    bin: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    accountId: string;
}

export interface CliResult {
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
}

export class CliRouteError extends Error {}

const SECRET_OUTPUT_RE = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{10,}|ghp_[0-9A-Za-z]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;

/** Scrub token-shaped material from child output before it can reach logs. */
export function redactCliOutput(text: string): string {
    return text.replace(SECRET_OUTPUT_RE, '<redacted-output>');
}

/**
 * Per-vendor home-dir semantics. ONLY vendors with a documented home/config
 * dir variable may use cli-home routing; the rest must use env: (a bare
 * assumption that every CLI reads CODEX_HOME would be invented semantics).
 * codex: CODEX_HOME per https://developers.openai.com/codex/auth/ci-cd-auth/
 */
export const vendorHomeEnvVar: Record<string, string | undefined> = {
    'codex-cli-authjson': 'CODEX_HOME',
    'claude-setup-token': undefined, // not verified from Anthropic docs: env: only
    'copilot-official-sdk': undefined, // not verified from GitHub docs: env: only
};

/** Child env allowlist: the vendor CLI never inherits unrelated secrets. */
const CHILD_ENV_BASE = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER', 'SHELL'];

function minimalChildEnv(baseEnv: NodeJS.ProcessEnv, extra: string[]): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of [...CHILD_ENV_BASE, ...extra]) {
        if (baseEnv[name] !== undefined) env[name] = baseEnv[name];
    }
    return env;
}

const DEFAULT_ALLOWED_BIN_DIRS = ['/usr/bin', '/usr/local/bin', '/bin', '/opt/homebrew/bin'];

/**
 * Resolve a bare executable name to a trusted absolute path: found on PATH,
 * inside an allowed directory, a regular file (symlinks resolved), owner-
 * executable. A bare name alone never proves the binary is the official CLI.
 */
export function resolveOfficialBin(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
    allowedDirs: string[] = DEFAULT_ALLOWED_BIN_DIRS,
): string {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) throw new CliRouteError('bin must be a bare executable name');
    for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
        const candidate = join(dir, name);
        try {
            accessSync(candidate, constants.X_OK);
            const real = realpathSync(candidate);
            if (!statSync(real).isFile()) continue;
            if (!allowedDirs.some(d => real === join(d, name) || real.startsWith(d + '/'))) {
                throw new CliRouteError(`${name} resolves outside allowed directories: ${real}`);
            }
            return real;
        } catch (err) {
            if (err instanceof CliRouteError) throw err;
            continue;
        }
    }
    throw new CliRouteError(`official binary not found on PATH: ${name}`);
}

/**
 * Build the invocation for an account. The account's secretRef selects the
 * routing: a dedicated CLI home (only for vendors with verified home-dir
 * semantics) or an env var passed only to the child. The child receives a
 * MINIMAL allowlisted environment - never the server's full env.
 */
export function buildCliInvocation(
    account: ProviderAccount,
    bin: string,
    args: string[],
    baseEnv: NodeJS.ProcessEnv = process.env,
    options: { allowAbsoluteBin?: boolean; routeId?: string } = {},
): CliInvocation {
    const binOk = options.allowAbsoluteBin ? (bin.startsWith('/') && !bin.includes('..')) : /^[a-z0-9][a-z0-9_.-]*$/i.test(bin);
    if (!binOk) throw new CliRouteError('bin must be a bare executable name, never a path or shell string');
    const ref = account.secretRef;
    let env: NodeJS.ProcessEnv;
    if (ref.startsWith('cli-home:')) {
        const homeVar = vendorHomeEnvVar[options.routeId ?? ''];
        if (!homeVar) throw new CliRouteError(`home-dir routing unverified for this vendor route; use env: instead`);
        const home = ref.slice('cli-home:'.length);
        if (!home.startsWith('/') || home.includes('..')) throw new CliRouteError('cli-home must be an absolute path without traversal');
        env = minimalChildEnv(baseEnv, []);
        env[homeVar] = home;
        env.HOME = home;
    } else if (ref.startsWith('env:')) {
        const name = ref.slice(4);
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new CliRouteError('invalid env var name');
        if (!baseEnv[name]) throw new CliRouteError(`${name} not set in the server environment`);
        env = minimalChildEnv(baseEnv, [name]);
    } else {
        throw new CliRouteError('CLI routes require cli-home: or env: secretRef');
    }
    return { bin, args, env, accountId: account.accountId };
}

/**
 * Execute the official binary without a shell (no string interpolation),
 * with a hard timeout, bounded output, and token-shaped redaction.
 */
export function runOfficialCli(invocation: CliInvocation, options: { timeoutMs?: number; maxOutputBytes?: number } = {}): Promise<CliResult> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
    return new Promise((resolve, reject) => {
        // detached: own process group so a timeout kills grandchildren too;
        // resolve on 'exit' (not 'close') so a grandchild holding pipes open
        // cannot outwait the timeout.
        const child = spawn(invocation.bin, invocation.args, { env: invocation.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        let stdout = '', stderr = '', truncated = false;
        const timer = setTimeout(() => {
            try { process.kill(-child.pid!, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
        }, timeoutMs);
        child.stdout.on('data', (d) => { if (stdout.length < maxOutputBytes) stdout += d.toString('utf8'); else truncated = true; });
        child.stderr.on('data', (d) => { if (stderr.length < maxOutputBytes) stderr += d.toString('utf8'); else truncated = true; });
        child.on('error', (err) => { clearTimeout(timer); reject(new CliRouteError(`failed to start ${invocation.bin}: ${err.message}`)); });
        child.on('exit', (exitCode, signal) => {
            clearTimeout(timer);
            resolve({
                exitCode,
                timedOut: signal === 'SIGKILL',
                stdout: redactCliOutput(stdout) + (truncated ? '\n<output truncated>' : ''),
                stderr: redactCliOutput(stderr),
            });
        });
    });
}

/** Official route table: which binary implements each vendor route. */
export const officialCliBins: Record<string, { bin: string; headlessArgs: (prompt: string) => string[] }> = {
    'codex-cli-authjson': { bin: 'codex', headlessArgs: (prompt) => ['exec', prompt] },
    'claude-setup-token': { bin: 'claude', headlessArgs: (prompt) => ['-p', prompt, '--output-format', 'json'] },
    'copilot-official-sdk': { bin: 'copilot', headlessArgs: (prompt) => ['-p', prompt] },
};
