import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Wave-2 P0 self-dev cycle service: issue -> change -> tests -> real
// verification -> operator-approved PR. These tests run against a REAL
// throwaway git repository and the real service (hermetic tmp dirs, no
// mocks, no LLM calls, no GitHub): the operator-supplied patch path is
// exercised end-to-end up to the verification step, and the honest
// "verification unavailable" path is asserted when the clone has no
// node_modules.

let tmp: string;
let repo: string;
let worktree: string;
let selfdevDir: string;
let Service: typeof import('../../services/selfdev/cycleService');

describe('P0 self-dev cycle service (real git worktree, no mocks)', () => {
    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfdev-'));
        repo = path.join(tmp, 'repo');
        worktree = path.join(tmp, 'repo-selfwork');
        selfdevDir = path.join(tmp, 'selfdev');
        fs.mkdirSync(repo);
        execFileSync('git', ['init', '-q'], { cwd: repo });
        execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
        execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
        fs.writeFileSync(path.join(repo, 'hello.ts'), 'export const x = 1;\n');
        execFileSync('git', ['add', '-A'], { cwd: repo });
        execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

        process.env.SELF_REPO_PATH = repo;
        process.env.SELF_WORKTREE_PATH = worktree;
        process.env.SELFDEV_DIR = selfdevDir;

        Service = await import('../../services/selfdev/cycleService');
    });

    afterAll(() => {
        try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo }); } catch { /* best effort */ }
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.SELF_REPO_PATH;
        delete process.env.SELF_WORKTREE_PATH;
        delete process.env.SELFDEV_DIR;
    });

    const fresh = () => new Service.SelfDevCycleService({ dir: selfdevDir });

    it('validates creation input (issue, scope, acceptance)', () => {
        const s = fresh();
        expect(() => s.create({})).toThrowError(/issue is required/);
        expect(() => s.create({ issue: 'x', scope: ['../etc'], acceptance: { kind: 'vitest', target: 'a.test.ts' } })).toThrowError(/scope/);
        expect(() => s.create({ issue: 'x', scope: ['src'], acceptance: { kind: 'vitest', target: '/abs.ts' } })).toThrowError(/acceptance/);
    });

    it('runs the guarded path: PLANNED -> ATTEMPTED -> EXECUTED with honest verification unavailability', async () => {
        const s = fresh();
        const c = s.create({ issue: 'add util', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/util.test.ts' } });
        expect(c.state).toBe('PLANNED');

        // one active cycle at a time
        expect(() => s.create({ issue: 'second', scope: ['src'], acceptance: { kind: 'vitest', target: 'b.test.ts' } })).toThrowError(/already active/);

        // ops outside the declared scope are rejected and the cycle stays PLANNED
        const bad = await s.attempt(c.id, [{ op: 'write', path: 'outside/evil.ts', content: 'x', rationale: 'r' }]);
        expect(bad.state).toBe('PLANNED');
        expect(bad.lastError).toMatch(/outside declared cycle scope/);

        const ok = await s.attempt(c.id, [{ op: 'write', path: 'src/util.ts', content: 'export const util = 42;\n', rationale: 'implement the util' }]);
        expect(ok.state).toBe('ATTEMPTED');
        expect(ok.patch?.source).toBe('operator');

        const ex = await s.execute(c.id);
        // the op really landed inside the isolated worktree
        expect(fs.readFileSync(path.join(worktree, 'src', 'util.ts'), 'utf8')).toContain('util = 42');
        expect(ex.state).toBe('EXECUTED'); // NOT failed: the tmp clone has no node_modules
        expect(ex.lastError).toMatch(/verification unavailable/);
        expect(ex.diff).toMatch(/src/); // porcelain shows the new untracked dir

        // PR gate: operator approval is mandatory and state must be VERIFIED
        expect(() => s.requestPR(c.id)).toThrowError(/approvedBy is required/);
        expect(() => s.requestPR(c.id, 'operator-x')).toThrowError(/VERIFIED/);

        // journal recorded the guarded path
        const j = s.journalEntries(c.id) as any[];
        expect(j.some(e => e.event === 'CREATED')).toBe(true);
        expect(j.some(e => e.event === 'PATCH_PROPOSED' && e.source === 'operator')).toBe(true);
        expect(j.some(e => e.event === 'ERROR')).toBe(true);

        s.abandon(c.id, 'test done');
        expect(s.refresh(c.id).state).toBe('ABANDONED');
    });

    it('persists state across service instances (atomic store)', async () => {
        const s1 = fresh();
        const c = s1.create({ issue: 'persist me', scope: ['src'], acceptance: { kind: 'vitest', target: 'p.test.ts' } });
        const s2 = fresh();
        expect(s2.refresh(c.id).state).toBe('PLANNED');
        s2.abandon(c.id);
    });

    it('quarantines a corrupt state file instead of deleting it', () => {
        fs.writeFileSync(path.join(selfdevDir, 'cycles.json'), 'not json at all', 'utf8');
        const s = fresh();
        expect(s.list()).toEqual([]);
        const quarantined = fs.readdirSync(selfdevDir).filter(f => f.startsWith('cycles.json.corrupt-'));
        expect(quarantined.length).toBe(1);
        expect(fs.readFileSync(path.join(selfdevDir, quarantined[0]), 'utf8')).toBe('not json at all');
    });
});
