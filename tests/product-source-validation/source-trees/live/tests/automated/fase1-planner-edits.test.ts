import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Fase-1 planner-contract fix: anchored edits. The planner used to demand
// FULL file contents it never saw (blind planning + token cap), which made
// whole-file rewrites of large files structural, not accidental (cycles
// 7700e173 / 1e93f209 / 48f77520). The contract is now the proven anchored
// edit format: every find must match the current file exactly once, the pure
// gates judge the post-edit content, and the executor applies the same
// verified edits to disk. Real throwaway git repo, real services, no mocks,
// no LLM calls.

let tmp: string;
let repo: string;
let worktree: string;
let selfdevDir: string;
let Service: typeof import('../../services/selfdev/cycleService');
let Gates: typeof import('../../services/selfdev/gates');

const bigFile = (marker: string) =>
    Array.from({ length: 100 }, (_, i) => `export const line_${i} = '${marker}-${i}';`).join('\n') + '\n';

describe('Fase-1 planner anchored edits (real git worktree, no mocks)', () => {
    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfdev-edits-'));
        repo = path.join(tmp, 'repo');
        worktree = path.join(tmp, 'repo-selfwork');
        selfdevDir = path.join(tmp, 'selfdev');
        fs.mkdirSync(repo);
        fs.mkdirSync(path.join(repo, 'src'));
        execFileSync('git', ['init', '-q'], { cwd: repo });
        execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
        execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
        fs.writeFileSync(path.join(repo, 'src', 'target.ts'), bigFile('alpha'));
        fs.writeFileSync(path.join(repo, 'src', 'victim.ts'), bigFile('beta'));
        execFileSync('git', ['add', '-A'], { cwd: repo });
        execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

        process.env.SELF_REPO_PATH = repo;
        process.env.SELF_WORKTREE_PATH = worktree;
        process.env.SELFDEV_DIR = selfdevDir;

        Service = await import('../../services/selfdev/cycleService');
        Gates = await import('../../services/selfdev/gates');
    });

    afterAll(() => {
        try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo }); } catch { /* best effort */ }
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.SELF_REPO_PATH;
        delete process.env.SELF_WORKTREE_PATH;
        delete process.env.SELFDEV_DIR;
    });

    const fresh = (name: string) => {
        const dir = path.join(selfdevDir, name);
        fs.mkdirSync(dir, { recursive: true });
        return new Service.SelfDevCycleService({ dir });
    };

    it('applyCycleEdits: replaces a unique anchor exactly once', () => {
        const out = Gates.applyCycleEdits('aaa MIDDLE ccc', [{ find: 'MIDDLE', replace: 'XXX' }]);
        expect(out).toBe('aaa XXX ccc');
    });

    it('applyCycleEdits: fails honestly on a missing anchor', () => {
        expect(() => Gates.applyCycleEdits('abc', [{ find: 'zzz', replace: 'q' }])).toThrowError(/not found/);
    });

    it('applyCycleEdits: fails honestly on an ambiguous anchor', () => {
        expect(() => Gates.applyCycleEdits('ab ab', [{ find: 'ab', replace: 'q' }])).toThrowError(/ambiguous/);
    });

    it('applyCycleEdits: rejects an empty find', () => {
        expect(() => Gates.applyCycleEdits('abc', [{ find: '', replace: 'q' }])).toThrowError(/non-empty/);
    });

    it('validateOps: accepts edit ops, rejects malformed ones', async () => {
        const s = fresh('validate');
        const c = s.create({ issue: 'fix', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        const bad1 = await s.attempt(c.id, [{ op: 'edit', path: 'src/target.ts', rationale: 'r' } as any]);
        expect(bad1.lastError).toMatch(/edits array/);
        const bad2 = await s.attempt(c.id, [{ op: 'edit', path: 'src/target.ts', edits: [{ find: '', replace: 'x' }], rationale: 'r' }]);
        expect(bad2.lastError).toMatch(/non-empty find/);
        const bad3 = await s.attempt(c.id, [{ op: 'delete', path: 'src/target.ts', rationale: 'r' } as any]);
        expect(bad3.lastError).toMatch(/unsupported op/);
        const ok = await s.attempt(c.id, [{ op: 'edit', path: 'src/target.ts', edits: [{ find: "line_0 = 'alpha-0'", replace: "line_0 = 'patched'" }], rationale: 'surgical fix' }]);
        expect(ok.state).toBe('ATTEMPTED');
    });

    it('executes an anchored edit end-to-end and the gates see the post-edit content', async () => {
        const s = fresh('happy');
        const c = s.create({ issue: 'surgical fix', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        await s.attempt(c.id, [{ op: 'edit', path: 'src/target.ts', edits: [{ find: "export const line_50 = 'alpha-50';", replace: "export const line_50 = 'edited';" }], rationale: 'fix line 50 only' }]);
        const ex = await s.execute(c.id);
        const onDisk = fs.readFileSync(path.join(worktree, 'src', 'target.ts'), 'utf8');
        expect(onDisk).toContain("line_50 = 'edited'");
        expect(onDisk).toContain("line_99 = 'alpha-99'"); // the other 99 lines untouched
        expect(ex.state).toBe('EXECUTED'); // tmp clone has no node_modules: honest unavailability, not failure
        expect(ex.lastError).toMatch(/verification unavailable/);
    });

    it('fails honestly when the edit target does not exist in the clone', async () => {
        const s = fresh('missing');
        const c = s.create({ issue: 'edit a ghost', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        await s.attempt(c.id, [{ op: 'edit', path: 'src/ghost.ts', edits: [{ find: 'x', replace: 'y' }], rationale: 'r' }]);
        const ex = await s.execute(c.id);
        expect(ex.state).toBe('FAILED');
        expect(ex.history.at(-1)?.note).toMatch(/edit target missing/);
    });

    it('fails honestly when the planner hallucinates an anchor', async () => {
        const s = fresh('hallucinated');
        const c = s.create({ issue: 'edit', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        await s.attempt(c.id, [{ op: 'edit', path: 'src/target.ts', edits: [{ find: 'THIS CODE NEVER EXISTED', replace: 'x' }], rationale: 'r' }]);
        const ex = await s.execute(c.id);
        expect(ex.state).toBe('FAILED');
        expect(ex.history.at(-1)?.note).toMatch(/anchor not found/);
    });

    it('the shrink gate still catches a gutting edit (post-edit content is judged)', async () => {
        const s = fresh('gutting');
        const c = s.create({ issue: 'rewrite in disguise', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        // an edit that replaces the entire 100-line file body with 3 lines
        const original = fs.readFileSync(path.join(repo, 'src', 'victim.ts'), 'utf8');
        await s.attempt(c.id, [{ op: 'edit', path: 'src/victim.ts', edits: [{ find: original, replace: 'export const gutted = 1;\n' }], rationale: 'r' }]);
        const ex = await s.execute(c.id);
        expect(ex.state).toBe('FAILED');
        expect(ex.history.at(-1)?.note).toMatch(/deletes >\d+% of src\/victim\.ts/);
    });

    it('write ops stay backward compatible (new files still land whole)', async () => {
        const s = fresh('write-compat');
        const c = s.create({ issue: 'new file', scope: ['src'], acceptance: { kind: 'vitest', target: 'src/x.test.ts' } });
        await s.attempt(c.id, [{ op: 'write', path: 'src/newfile.ts', content: 'export const fresh = true;\n', rationale: 'add new module' }]);
        const ex = await s.execute(c.id);
        expect(ex.state).toBe('EXECUTED');
        expect(fs.readFileSync(path.join(worktree, 'src', 'newfile.ts'), 'utf8')).toContain('fresh = true');
    });
});
