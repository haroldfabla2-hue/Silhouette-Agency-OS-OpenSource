import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Fase 1 worktree freshness: the planner and the acceptance gates must
// operate on CURRENT upstream code. A stale selfwork clone defeated the
// shrink gate in fire test 7700e173 (planner gutted a file that had grown
// on main; the clone still had the old small version). These tests run
// hermetically against a local bare "upstream" repo, no network.

let tmp: string;
let upstreamWork: string;
let upstreamBare: string;
let repo: string;
let worktree: string;
let selfdevDir: string;
let svc: typeof import('../../services/selfCodeService');

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

describe('worktree freshness sync (hermetic upstream)', () => {
    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtsync-'));
        upstreamWork = path.join(tmp, 'upstream-work');
        upstreamBare = path.join(tmp, 'upstream.git');
        repo = path.join(tmp, 'repo');
        worktree = path.join(tmp, 'repo-selfwork');
        selfdevDir = path.join(tmp, 'selfdev');

        fs.mkdirSync(upstreamWork);
        git(upstreamWork, ['init', '-qb', 'main']);
        git(upstreamWork, ['config', 'user.email', 'test@test.local']);
        git(upstreamWork, ['config', 'user.name', 'test']);
        fs.writeFileSync(path.join(upstreamWork, 'hello.ts'), 'export const x = 1;\n');
        git(upstreamWork, ['add', '-A']);
        git(upstreamWork, ['commit', '-qm', 'v1']);
        git(tmp, ['init', '-q', '--bare', upstreamBare]); git(upstreamBare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
        git(upstreamWork, ['push', '-q', upstreamBare, 'main']);
        git(tmp, ['clone', '-q', upstreamBare, repo]);

        process.env.SELF_REPO_PATH = repo;
        process.env.SELF_WORKTREE_PATH = worktree;
        process.env.SELF_REPO_UPSTREAM_URL = upstreamBare;
        process.env.SELFDEV_DIR = selfdevDir;

        svc = await import('../../services/selfCodeService');
    });

    afterAll(() => {
        try { git(repo, ['worktree', 'remove', '--force', worktree]); } catch { /* best effort */ }
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.SELF_REPO_PATH;
        delete process.env.SELF_WORKTREE_PATH;
        delete process.env.SELF_REPO_UPSTREAM_URL;
        delete process.env.SELFDEV_DIR;
    });

    it('syncs a stale clone and worktree to upstream main', async () => {
        const s = svc.selfCodeService;
        await s.ensureWorktree();
        expect(fs.readFileSync(path.join(worktree, 'hello.ts'), 'utf8')).toContain('x = 1');

        // upstream moves on: modify + add a file
        fs.writeFileSync(path.join(upstreamWork, 'hello.ts'), 'export const x = 2;\n');
        fs.writeFileSync(path.join(upstreamWork, 'newfile.ts'), 'export const fresh = true;\n');
        git(upstreamWork, ['add', '-A']);
        git(upstreamWork, ['commit', '-qm', 'v2']);
        git(upstreamWork, ['push', '-q', upstreamBare, 'main']);
        const head = git(upstreamWork, ['rev-parse', 'HEAD']);

        const r = await s.syncWithUpstream();
        expect(r.syncedTo).toBe(head);
        expect(fs.readFileSync(path.join(worktree, 'hello.ts'), 'utf8')).toContain('x = 2');
        expect(fs.existsSync(path.join(worktree, 'newfile.ts'))).toBe(true);
    });

    it('discards dirty worktree leftovers and reports the head', async () => {
        const s = svc.selfCodeService;
        await s.ensureWorktree();
        fs.writeFileSync(path.join(worktree, 'leftover.ts'), 'junk');
        fs.writeFileSync(path.join(worktree, 'hello.ts'), 'export const x = 999;\n');

        const head = git(upstreamWork, ['rev-parse', 'HEAD']);
        const r = await s.syncWithUpstream();
        expect(r.syncedTo).toBe(head);
        expect(fs.readFileSync(path.join(worktree, 'hello.ts'), 'utf8')).toContain('x = 2');
        expect(fs.existsSync(path.join(worktree, 'leftover.ts'))).toBe(false);
        expect(git(worktree, ['status', '--porcelain'])).toBe('');
    });

    it('fail-closed: throws when the upstream URL is not configured', async () => {
        delete process.env.SELF_REPO_UPSTREAM_URL;
        const s = svc.selfCodeService;
        await expect(s.syncWithUpstream()).rejects.toThrowError(/SELF_REPO_UPSTREAM_URL/);
        process.env.SELF_REPO_UPSTREAM_URL = upstreamBare;
    });

    it('execute never VERIFIES against stale code when sync is unavailable', async () => {
        process.env.SELF_REPO_UPSTREAM_URL = path.join(tmp, 'does-not-exist.git');
        const cycMod = await import('../../services/selfdev/cycleService');
        const s = new cycMod.SelfDevCycleService({ dir: selfdevDir });
        const c = s.create({ issue: 'sync unavailable path', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        const att = await s.attempt(c.id, [{ op: 'write', path: 'src/x.ts', content: 'export const x = 1;\n', rationale: 'op' }]);
        expect(att.state).toBe('ATTEMPTED');
        const ex = await s.execute(c.id);
        // ops landed (auditable in the clone) but verification is honestly blocked
        expect(fs.readFileSync(path.join(worktree, 'src', 'x.ts'), 'utf8')).toContain('x = 1');
        expect(ex.state).toBe('EXECUTED');
        expect(ex.lastError).toMatch(/verification unavailable \(worktree sync\)/);
        s.abandon(c.id, 'test done');
        process.env.SELF_REPO_UPSTREAM_URL = upstreamBare;
    });
});
