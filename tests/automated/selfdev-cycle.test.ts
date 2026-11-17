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

    it('refuses to write candidate when no runnable committed baseline oracle exists', async () => {
        const s = fresh();
        const c = s.create({ issue: 'add util', scope: ['services'], acceptance: { kind: 'vitest', target: 'tests/util.test.ts' } });
        expect(c.state).toBe('PLANNED');

        // one active cycle at a time
        expect(() => s.create({ issue: 'second', scope: ['src'], acceptance: { kind: 'vitest', target: 'b.test.ts' } })).toThrowError(/already active/);

        // ops outside the declared scope are rejected and the cycle stays PLANNED
        const bad = await s.attempt(c.id, [{ op: 'write', path: 'outside/evil.ts', content: 'x', rationale: 'r' }]);
        expect(bad.state).toBe('PLANNED');
        expect(bad.lastError).toMatch(/outside declared cycle scope/);

        const ok = await s.attempt(c.id, [{ op: 'write', path: 'services/util.ts', content: 'export const util = 42;\n', rationale: 'implement the util' }]);
        expect(ok.state).toBe('ATTEMPTED');
        expect(ok.patch?.source).toBe('operator');

        const ex = await s.execute(c.id);
        // New baseline requirement is pre-write: no installed runner/oracle means
        // unavailable, not a failing baseline and not a landed candidate.
        expect(fs.existsSync(path.join(worktree, 'services', 'util.ts'))).toBe(false);
        expect(ex.state).toBe('ATTEMPTED');
        expect(ex.lastError).toMatch(/BASELINE_EVALUATION_UNAVAILABLE/);

        // PR gate: operator approval is mandatory and state must be VERIFIED
        expect(() => s.requestPR(c.id)).toThrowError(/approvedBy is required/);
        expect(() => s.requestPR(c.id, 'operator-x')).toThrowError(/requires baseline-bound evaluation/);

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

    it('preserves corrupt state and blocks successive service instances instead of forgetting active work', () => {
        const file = path.join(selfdevDir, 'cycles.json');
        fs.writeFileSync(file, 'not json at all', 'utf8');
        for (let restart = 0; restart < 2; restart++) {
            const s = fresh();
            expect(() => s.list()).toThrowError(/SELFDEV_CONTINUITY_UNKNOWN/);
            expect(fs.readFileSync(file, 'utf8')).toBe('not json at all');
        }
        expect(fs.readdirSync(selfdevDir).filter(f => f.startsWith('cycles.json.corrupt-'))).toEqual([]);
    });
});
