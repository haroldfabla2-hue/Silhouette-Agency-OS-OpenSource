/**
 * SelfCodeService - F2 Self-Code Toolkit (safe)
 *
 * Lets Silhouette's agents read and write their own source code INSIDE AN
 * ISOLATED GIT WORKTREE ONLY. It never touches the running tree, never
 * commits, never pushes, and never relaunches anything. Every mutation is
 * journaled (append-only JSONL) with rationale and before/after hashes.
 *
 * Guardrails (hard):
 * - Path confinement: targets must resolve inside the worktree.
 * - Denylist: .git, node_modules, .env*, data/, dist/, public/output.
 * - Size caps on reads and writes.
 * - The running deployment is never modified: apply/deploy is out of scope
 *   by design (that path goes through PRs and operator-approved merges).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { applyCycleEdits, CycleEdit } from './selfdev/gates';
import { atomicWriteFile, AtomicWriteAppliedError } from './selfdev/atomicWrite';

const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const DENIED_SEGMENTS = ['.git', 'node_modules', 'data', 'dist'];
const DENIED_PREFIXES = ['.env'];

export interface JournalEntry {
    ts: string;
    actor: string;
    action: 'write' | 'edit' | 'test' | 'init' | 'sync';
    path?: string;
    rationale?: string;
    shaBefore?: string | null;
    shaAfter?: string | null;
    detail?: string;
}

function sha256(buf: Buffer | string): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, preserveOutput = false): Promise<{ code: number; out: string }> {
    return new Promise((resolve) => {
        execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
            const output = `${stdout}${stderr ? `\n${stderr}` : ''}`;
            resolve({ code, out: preserveOutput ? output : output.trim() });
        });
    });
}

class SelfCodeService {
    private repoPath(): string {
        return process.env.SELF_REPO_PATH || process.cwd();
    }

    private worktreePath(): string {
        return process.env.SELF_WORKTREE_PATH
            || path.resolve(this.repoPath(), '..', `${path.basename(this.repoPath())}-selfwork`);
    }

    private journalPath(): string {
        return `${this.worktreePath()}.journal.jsonl`;
    }

    private journal(entry: JournalEntry): boolean {
        try {
            fs.appendFileSync(this.journalPath(), JSON.stringify(entry) + '\n');
            return true;
        } catch (e) {
            console.warn('[SELFCODE] Journal write failed (non-blocking):', e);
            return false;
        }
    }

    /** Record a replacement that happened even though durability confirmation failed. */
    private writeAtomically(abs: string, content: string, entry: JournalEntry): void {
        try {
            atomicWriteFile(abs, content);
        } catch (error) {
            if (error instanceof AtomicWriteAppliedError) {
                error.journalRecorded = this.journal({
                    ...entry, shaAfter: error.shaAfter,
                    detail: 'APPLIED_DURABILITY_UNKNOWN: replacement occurred; directory sync failed'
                });
                error.message += error.journalRecorded
                    ? ' Audit entry recorded (durability not confirmed).'
                    : ' AUDIT WRITE FAILED: replacement occurred but no journal entry was recorded.';
            }
            throw error;
        }
    }

    /** Resolve a caller-supplied relative path inside the worktree, or throw. */
    private confine(relPath: string): string {
        if (!relPath || typeof relPath !== 'string') throw new Error('path is required');
        if (path.isAbsolute(relPath)) throw new Error('absolute paths are not allowed');
        const base = this.worktreePath();
        const resolved = path.resolve(base, relPath);
        if (resolved !== base && !resolved.startsWith(base + path.sep)) {
            throw new Error('path escapes the worktree');
        }
        const rel = path.relative(base, resolved);
        const segments = rel.split(path.sep);
        for (const seg of segments) {
            if (DENIED_SEGMENTS.includes(seg)) throw new Error(`path segment denied: ${seg}`);
        }
        const fileName = segments[segments.length - 1];
        for (const prefix of DENIED_PREFIXES) {
            if (fileName.startsWith(prefix)) throw new Error(`path denied: ${fileName}`);
        }
        if (rel.startsWith('public' + path.sep + 'output')) throw new Error('path denied: public/output');
        if (fs.existsSync(base)) {
            const realBase = fs.realpathSync(base);
            let ancestor = resolved;
            while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
            const real = fs.realpathSync(ancestor);
            if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new Error('path escapes the worktree through a symlink');
        }
        return resolved;
    }

    /** Create the isolated worktree on first use. Never mutates the running tree. */
    public async ensureWorktree(): Promise<{ path: string; created: boolean }> {
        const wt = this.worktreePath();
        if (fs.existsSync(path.join(wt, '.git'))) return { path: wt, created: false };
        fs.mkdirSync(path.dirname(wt), { recursive: true });
        const res = await run('git', ['worktree', 'add', '--detach', wt], this.repoPath(), 30000);
        if (res.code !== 0) throw new Error(`git worktree add failed: ${res.out}`);
        // Tests need dependencies; link them in (read-only link, no copy).
        try {
            const nm = path.join(this.repoPath(), 'node_modules');
            if (fs.existsSync(nm) && !fs.existsSync(path.join(wt, 'node_modules'))) {
                fs.symlinkSync(nm, path.join(wt, 'node_modules'), 'dir');
            }
        } catch (e) {
            console.warn('[SELFCODE] node_modules link failed; tests may be unavailable:', e);
        }
        this.journal({ ts: new Date().toISOString(), actor: 'api', action: 'init', detail: `worktree created at ${wt}` });
        return { path: wt, created: true };
    }

    /** Before any reset/clean, preserve dirty candidate bytes and refuse to discard them.
     * Snapshots are local audit evidence, not an approval, executable archive or rollback.
     * Fail closed on unreadable/oversized/special paths. Never copy denied data/secrets. */
    private async guardCleanForSync(root: string): Promise<void> {
        try { await this.inspectCleanForSync(root); }
        catch (error) { throw new Error(`sync blocked: ${(error as Error).message}`, { cause: error }); }
    }

    private async inspectCleanForSync(root: string): Promise<void> {
        const status = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], root, 15000, true);
        if (status.code !== 0) throw new Error('sync blocked: cannot inspect candidate status');
        if (root === this.worktreePath()) {
            const ignored = await run('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], root, 15000, true);
            if (ignored.code !== 0 || ignored.out.split('\0').filter(Boolean).some(p => p !== 'node_modules/' && p !== 'node_modules')) {
                throw new Error('ignored candidate artifacts present; preserve in place, no reset');
            }
        }
        if (!status.out) return;
        // Capture the diff and exact changed regular files (including untracked).
        // Use NUL-delimited git paths; porcelain text quoting is not a path parser.
        const changes = await run('git', ['diff', '--binary', 'HEAD'], root, 15000, true);
        const tracked = await run('git', ['diff', '--name-only', '-z', 'HEAD'], root, 15000, true);
        const untracked = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], root, 15000, true);
        if ([changes, tracked, untracked].some(r => r.code !== 0)) throw new Error('sync blocked: cannot preserve candidate diff');
        const files: { path: string; contentBase64?: string; sha256?: string; deleted?: true; withheld?: true }[] = [];
        let bytes = Buffer.byteLength(changes.out);
        for (const rel of new Set((tracked.out + '\0' + untracked.out).split('\0').filter(Boolean))) {
            const segments = rel.split('/');
            if (segments.some(x => DENIED_SEGMENTS.includes(x) || x.startsWith('.env')) || rel.startsWith('public/output/')) {
                // Do not copy private artifacts to an audit snapshot. Refuse the sync either way.
                throw new Error('sync blocked: candidate includes denied private path; preserve it in place');
            }
            const absolute = path.resolve(root, rel);
            if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('sync blocked: candidate path escapes root');
            if (!fs.existsSync(absolute)) { files.push({ path: rel, deleted: true }); continue; }
            const stat = fs.lstatSync(absolute);
            if (!stat.isFile() || stat.nlink !== 1 || !fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep)) {
                throw new Error('sync blocked: candidate includes unsafe file; preserved in place');
            }
            bytes += stat.size;
            if (bytes > 4 * 1024 * 1024) throw new Error('sync blocked: candidate exceeds evidence cap; preserved in place');
            const content = fs.readFileSync(absolute);
            files.push({ path: rel, contentBase64: content.toString('base64'), sha256: sha256(content) });
        }
        const base = await run('git', ['rev-parse', 'HEAD'], root, 15000);
        if (base.code !== 0) throw new Error('sync blocked: cannot pin candidate base');
        const evidence = JSON.stringify({ version: 1, root, baseSha: base.out, status: status.out, diff: changes.out, files });
        const digest = sha256(evidence);
        const directory = `${root}.preserved-candidates`;
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const destination = path.join(directory, digest + '.json');
        if (!fs.existsSync(destination)) atomicWriteFile(destination, evidence);
        if (sha256(fs.readFileSync(destination)) !== digest) throw new Error('sync blocked: candidate preservation readback mismatch');
        throw new Error(`sync blocked: dirty candidate preserved in place and evidence ${digest}; explicit review required before cleanup`);
    }

    /**
     * Fetch upstream objects and sync ONLY the clean isolated selfwork tree to the default
     * branch. The planner and the acceptance gates must operate on current
     * code: a stale clone makes the shrink gate compare against ghosts and
     * lets the planner rewrite files that no longer look the way it thinks.
     * Upstream URL is env-driven (SELF_REPO_UPSTREAM_URL), never the clone's
     * own origin, which may point at a template repo. Fail-closed: throws
     * when the URL is unset or any git step fails.
     */
    public async syncWithUpstream(): Promise<{ syncedTo: string }> {
        const url = (process.env.SELF_REPO_UPSTREAM_URL || '').trim();
        if (!url) throw new Error('worktree sync unavailable: SELF_REPO_UPSTREAM_URL not configured');
        const repo = this.repoPath();
        await this.guardCleanForSync(repo);
        const wt = (await this.ensureWorktree()).path;
        await this.guardCleanForSync(wt);
        const fetchRes = await run('git', ['fetch', url, 'main'], repo, 120000);
        if (fetchRes.code !== 0) throw new Error(`worktree sync fetch failed: ${fetchRes.out.slice(-300)}`);
        const shaRes = await run('git', ['rev-parse', 'FETCH_HEAD'], repo, 15000);
        if (shaRes.code !== 0) throw new Error(`worktree sync rev-parse failed: ${shaRes.out.slice(-300)}`);
        const sha = shaRes.out.trim();
        // Recheck after fetch: no concurrent candidate may be silently discarded.
        await this.guardCleanForSync(repo);
        await this.guardCleanForSync(wt);
        // The source checkout is never reset. Only the separate selfwork clone moves.
        const resetWt = await run('git', ['reset', '--hard', sha], wt, 60000);
        if (resetWt.code !== 0) throw new Error(`worktree sync worktree reset failed: ${resetWt.out.slice(-300)}`);
        // Never git-clean a candidate: ignored artifacts and evidence are not disposable.
        this.journal({
            ts: new Date().toISOString(), actor: 'api', action: 'sync',
            detail: `clean isolated worktree synced to ${sha}; source checkout unchanged; no cleanup`
        });
        return { syncedTo: sha };
    }

    public async readFile(relPath: string): Promise<{ path: string; content: string; sha: string; truncated: boolean }> {
        await this.ensureWorktree();
        const abs = this.confine(relPath);
        if (!fs.existsSync(abs)) throw new Error('file not found in worktree');
        const buf = fs.readFileSync(abs);
        const truncated = buf.length > MAX_READ_BYTES;
        return {
            path: relPath,
            content: buf.subarray(0, MAX_READ_BYTES).toString('utf8'),
            sha: sha256(buf),
            truncated
        };
    }

    /**
     * Apply anchored edits to an existing file in the worktree. Every anchor
     * must match exactly once (see applyCycleEdits); the whole op fails
     * honestly before touching disk otherwise.
     */
    public async applyEdits(relPath: string, edits: CycleEdit[], rationale: string): Promise<{ path: string; shaBefore: string | null; shaAfter: string }> {
        if (!rationale || !rationale.trim()) throw new Error('rationale is required for every write');
        if (!Array.isArray(edits) || edits.length === 0) throw new Error('edits must be a non-empty array');
        const current = await this.readFile(relPath); // worktree + confinement + existence
        const next = applyCycleEdits(current.content, edits);
        const abs = this.confine(relPath);
        const shaBefore = current.sha;
        this.writeAtomically(abs, next, { ts: new Date().toISOString(), actor: 'api', action: 'edit', path: relPath, rationale, shaBefore });
        const shaAfter = sha256(next);
        this.journal({ ts: new Date().toISOString(), actor: 'api', action: 'edit', path: relPath, rationale, shaBefore, shaAfter });
        return { path: relPath, shaBefore, shaAfter };
    }

    public async writeFile(relPath: string, content: string, rationale: string): Promise<{ path: string; shaBefore: string | null; shaAfter: string; diff: string }> {
        if (!rationale || !rationale.trim()) throw new Error('rationale is required for every write');
        if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('content exceeds 256KB cap');
        await this.ensureWorktree();
        const abs = this.confine(relPath);
        const shaBefore = fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : null;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        this.writeAtomically(abs, content, { ts: new Date().toISOString(), actor: 'api', action: 'write', path: relPath, rationale, shaBefore });
        const shaAfter = sha256(content);
        const diff = await run('git', ['diff', '--', relPath], this.worktreePath(), 15000);
        this.journal({ ts: new Date().toISOString(), actor: 'api', action: 'write', path: relPath, rationale, shaBefore, shaAfter });
        return { path: relPath, shaBefore, shaAfter, diff: diff.out };
    }

    public async diff(): Promise<{ diff: string }> {
        await this.ensureWorktree();
        const res = await run('git', ['diff', 'HEAD'], this.worktreePath(), 15000);
        const untracked = await run('git', ['status', '--porcelain'], this.worktreePath(), 15000);
        return { diff: `${res.out}\n\n# status:\n${untracked.out}` };
    }

    /** Fase 1 gate: full typecheck inside the isolated clone. */
    public async runTypecheck(): Promise<{ code: number; output: string }> {
        const wt = (await this.ensureWorktree()).path;
        if (!fs.existsSync(path.join(wt, 'node_modules'))) {
            throw new Error('typecheck unavailable: node_modules missing in worktree');
        }
        const cwd = this.worktreePath();
        const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' };
        return new Promise((resolve) => {
            execFile('npx', ['tsc', '--noEmit'], { cwd, env, timeout: 300_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
                resolve({ code: err ? (err as any).code ?? 1 : 0, output: `${stdout}${stderr}` });
            });
        });
    }

    /** Fase 1 gate: each touched route module must import cleanly in the clone. */
    public async runRouteSmoke(relPath: string): Promise<{ code: number; output: string }> {
        const wt = (await this.ensureWorktree()).path;
        if (!fs.existsSync(path.join(wt, 'node_modules'))) {
            throw new Error('route smoke unavailable: node_modules missing in worktree');
        }
        const cwd = this.worktreePath();
        const script = `import('./${relPath.replace(/'/g, '')}').then(()=>process.exit(0)).catch(e=>{console.error(e && e.message || e);process.exit(1)})`;
        return new Promise((resolve) => {
            execFile('npx', ['tsx', '-e', script], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
                resolve({ code: err ? (err as any).code ?? 1 : 0, output: `${stdout}${stderr}` });
            });
        });
    }

    public async runTest(target: string): Promise<{ code: number; output: string }> {
        if (!target || target.includes('..') || path.isAbsolute(target)) throw new Error('target must be a relative test path');
        const wt = (await this.ensureWorktree()).path;
        const abs = this.confine(target);
        if (!fs.existsSync(abs)) throw new Error('test target not found in worktree');
        if (!fs.existsSync(path.join(wt, 'node_modules'))) {
            throw new Error('tests unavailable: node_modules missing in worktree');
        }
        const res = await run('npx', ['vitest', 'run', target], wt, 180000);
        this.journal({ ts: new Date().toISOString(), actor: 'api', action: 'test', path: target, detail: `exit ${res.code}` });
        return { code: res.code, output: res.out.slice(-8000) };
    }

    public journalEntries(limit: number = 50): JournalEntry[] {
        const jp = this.journalPath();
        if (!fs.existsSync(jp)) return [];
        const lines = fs.readFileSync(jp, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-Math.max(1, Math.min(limit, 500))).map((l) => {
            try { return JSON.parse(l); } catch { return { ts: '', actor: '', action: 'write' as const, detail: l }; }
        });
    }
}

export const selfCodeService = new SelfCodeService();
