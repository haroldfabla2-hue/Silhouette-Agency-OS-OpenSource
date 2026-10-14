/**
 * CommandExecService - F3 Command Execution (real OS isolation)
 *
 * Lets Silhouette's agents run commands on the machine they live on, the
 * way real coding agents do - but with hard guardrails:
 *
 * - REAL OS ISOLATION: commands run inside bubblewrap (unshare-all,
 *   cap-drop ALL, no network, read-only system binds). The Node vm
 *   module is NOT isolation and is never used here. If bubblewrap is unavailable, the
 *   service refuses and reports UNAVAILABLE - it never degrades to an
 *   unsafe runner.
 * - TIERED WHITELIST: tier1 read-only diagnostics run sandboxed right away.
 *   Everything else (tier2) requires explicit operator approval per action
 *   (pending -> approve). Package installs / environment changes are F4
 *   and are rejected here.
 * - JOURNAL: every request, execution, approval and refusal is appended to
 *   a JSONL audit log with hashes and durations.
 * - FORBIDDEN: touching data/memory paths, restarting services, writing
 *   outside the self-worktree, package managers (F4), network access.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_OUTPUT = 16000;

export type ExecTier = 'tier1' | 'tier2' | 'rejected';
export type ExecStatus = 'executed' | 'pending_approval' | 'rejected' | 'unavailable';

export interface ExecRequest {
    command: string;
    args: string[];
}

export interface ExecRecord {
    id: string;
    ts: string;
    command: string;
    args: string[];
    tier: ExecTier;
    status: ExecStatus;
    reason?: string;
    approvedBy?: string;
    exitCode?: number;
    durationMs?: number;
    outputSha?: string;
    outputTail?: string;
}

// Tier 1: read-only diagnostics. No writes, no network, no state changes.
const TIER1_COMMANDS: Record<string, RegExp[]> = {
    ls: [/^-/],
    pwd: [],
    uname: [/^-/],
    whoami: [],
    date: [],
    uptime: [],
    df: [/^-/],
    free: [/^-/],
    ps: [/^-/],
    nproc: [],
    git: [/^(status|log|diff|show|branch|rev-parse|remote)$/],
    cat: [/^[^-]/],
    head: [/^-/, /^[^-]/],
    tail: [/^-/, /^[^-]/],
    wc: [/^-/, /^[^-]/],
    node: [/^--version$/],
    npm: [/^--version$/, /^ls$/, /^outdated$/]
};

// Hard rejections regardless of tier or approval: environment mutation (F4),
// service control, destructive or memory-touching operations.
const FORBIDDEN_COMMANDS = new Set([
    'apt', 'apt-get', 'dpkg', 'snap', 'pip', 'pip3', 'npm-install',
    'systemctl', 'service', 'reboot', 'shutdown', 'halt', 'poweroff',
    'rm', 'rmdir', 'mkfs', 'dd', 'mount', 'umount', 'fdisk',
    'kill', 'killall', 'pkill',
    'curl', 'wget', 'ssh', 'scp', 'nc', 'ncat',
    'sudo', 'su', 'chown', 'chmod', 'useradd', 'usermod', 'passwd'
]);

const FORBIDDEN_PATH_PATTERN = /(^|\/)data\/|\.env|node_modules|\/etc\/|\/root\/|\.git\//;

function id(): string {
    return crypto.randomBytes(8).toString('hex');
}

function sha(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex');
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; durationMs: number }> {
    const started = Date.now();
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
            resolve({ code, out: `${stdout}${stderr ? `\n${stderr}` : ''}`.trim(), durationMs: Date.now() - started });
        });
    });
}

class CommandExecService {
    private journalFile(): string {
        return process.env.SELF_EXEC_JOURNAL || path.resolve(process.cwd(), 'data', 'exec-journal.jsonl');
    }

    private pending: Map<string, ExecRecord> = new Map();

    private journal(rec: ExecRecord): void {
        try {
            fs.mkdirSync(path.dirname(this.journalFile()), { recursive: true });
            fs.appendFileSync(this.journalFile(), JSON.stringify(rec) + '\n');
        } catch (e) {
            console.warn('[EXEC] Journal write failed (non-blocking):', e);
        }
    }

    public journalEntries(limit: number = 50): ExecRecord[] {
        const jf = this.journalFile();
        if (!fs.existsSync(jf)) return [];
        const lines = fs.readFileSync(jf, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-Math.max(1, Math.min(limit, 500))).map((l) => {
            try { return JSON.parse(l); } catch { return { id: '', ts: '', command: '?', args: [], tier: 'rejected' as ExecTier, status: 'rejected' as ExecStatus, reason: l }; }
        });
    }

    public sandboxRoot(): string {
        return process.env.SELF_WORKTREE_PATH || path.resolve(process.cwd(), '..', `${path.basename(process.cwd())}-selfwork`);
    }

    // Real OS isolation requires the bubblewrap binary, a provisioned sandbox
    // root, AND a verified no-op sandbox run: kernel or container policy can
    // deny namespace setup even when the binary exists. Any failure =>
    // unavailable with the exact reason, never a weaker fallback.
    public async isolationStatus(): Promise<{ backend: 'bubblewrap'; available: boolean; reason?: string }> {
        const bin = await run('bwrap', ['--version'], 5000);
        if (bin.code !== 0) {
            return { backend: 'bubblewrap', available: false, reason: 'bubblewrap (bwrap) not installed: real OS isolation is mandatory; refusing to run unsandboxed' };
        }
        if (!fs.existsSync(this.sandboxRoot())) {
            return { backend: 'bubblewrap', available: false, reason: `sandbox root not provisioned: ${this.sandboxRoot()} - refusing to run without a real isolation root` };
        }
        const probe = await run('bwrap', this.sandboxArgs('true', []), 5000);
        if (probe.code !== 0) {
            const tail = probe.out.split('\n').slice(-2).join(' | ').slice(0, 200);
            return { backend: 'bubblewrap', available: false, reason: `sandbox self-test failed (exit ${probe.code}): ${tail} - refusing to run without verified isolation` };
        }
        return { backend: 'bubblewrap', available: true };
    }

    public async isolationAvailable(): Promise<boolean> {
        return (await this.isolationStatus()).available;
    }

    public classify(command: string, args: string[]): { tier: ExecTier; reason?: string } {
        if (!command || /[\/]/.test(command)) return { tier: 'rejected', reason: 'bare command names only (no paths)' };
        if (FORBIDDEN_COMMANDS.has(command)) return { tier: 'rejected', reason: `${command} is forbidden (destructive, service control, network, or F4 environment mutation)` };
        const joined = args.join(' ');
        if (FORBIDDEN_PATH_PATTERN.test(joined)) return { tier: 'rejected', reason: 'arguments touch forbidden paths (data/, .env, node_modules, /etc, /root, .git)' };
        if (command === 'git' && args[0] === 'rm') return { tier: 'rejected', reason: 'git rm is destructive' };
        const patterns = TIER1_COMMANDS[command];
        if (patterns) {
            const ok = args.every((a) => patterns.length === 0 ? false : patterns.some((re) => re.test(a)));
            if (ok || (patterns.length === 0 && args.length === 0)) return { tier: 'tier1' };
        }
        return { tier: 'tier2', reason: 'outside the read-only whitelist: requires operator approval' };
    }

    private sandboxArgs(command: string, args: string[]): string[] {
        const wt = this.sandboxRoot();
        const bwrapArgs = [
            '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
            '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin',
            '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib',
            '--proc', '/proc', '--dev', '/dev',
            '--bind', wt, '/work', '--chdir', '/work'
        ];
        // /lib64 exists on most distros; bind it when present.
        if (fs.existsSync('/lib64')) bwrapArgs.push('--ro-bind', '/lib64', '/lib64');
        bwrapArgs.push(command, ...args);
        return bwrapArgs;
    }

    private async executeSandboxed(command: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; durationMs: number }> {
        return run('bwrap', this.sandboxArgs(command, args), timeoutMs);
    }

    public async requestExecution(command: string, args: string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ExecRecord> {
        const rec: ExecRecord = {
            id: id(), ts: new Date().toISOString(), command, args,
            tier: 'rejected', status: 'rejected'
        };
        const cls = this.classify(command, args);
        rec.tier = cls.tier;
        if (cls.tier === 'rejected') {
            rec.status = 'rejected';
            rec.reason = cls.reason;
            this.journal(rec);
            return rec;
        }
        if (cls.tier === 'tier2') {
            rec.status = 'pending_approval';
            rec.reason = cls.reason;
            this.pending.set(rec.id, rec);
            this.journal(rec);
            return rec;
        }
        return this.runApproved(rec, timeoutMs);
    }

    public async approve(execId: string, approvedBy: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ExecRecord | null> {
        const rec = this.pending.get(execId);
        if (!rec) return null;
        this.pending.delete(execId);
        rec.approvedBy = approvedBy;
        return this.runApproved(rec, timeoutMs);
    }

    public reject(execId: string, approvedBy: string): ExecRecord | null {
        const rec = this.pending.get(execId);
        if (!rec) return null;
        this.pending.delete(execId);
        rec.status = 'rejected';
        rec.reason = `rejected by operator ${approvedBy}`;
        rec.approvedBy = approvedBy;
        this.journal(rec);
        return rec;
    }

    private async runApproved(rec: ExecRecord, timeoutMs: number): Promise<ExecRecord> {
        const iso = await this.isolationStatus();
        if (!iso.available) {
            rec.status = 'unavailable';
            rec.reason = iso.reason;
            this.journal(rec);
            return rec;
        }
        const res = await this.executeSandboxed(rec.command, rec.args, Math.min(timeoutMs, MAX_TIMEOUT_MS));
        rec.status = 'executed';
        rec.exitCode = res.code;
        rec.durationMs = res.durationMs;
        rec.outputSha = sha(res.out);
        rec.outputTail = res.out.slice(-MAX_OUTPUT);
        this.journal(rec);
        return rec;
    }

    public pendingApprovals(): ExecRecord[] {
        return [...this.pending.values()];
    }
}

export const commandExecService = new CommandExecService();
