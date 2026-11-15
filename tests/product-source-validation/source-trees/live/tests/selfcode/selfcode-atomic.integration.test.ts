import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { selfCodeService } from '../../services/selfCodeService';

test('real git worktree: writes, anchored edits, hashes, journal, size and path gates', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcode-service-'));
    const repo = path.join(scratch, 'repo'), wt = path.join(scratch, 'worktree');
    fs.mkdirSync(repo);
    const oldRepo = process.env.SELF_REPO_PATH, oldWt = process.env.SELF_WORKTREE_PATH;
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    try {
        git('init'); fs.writeFileSync(path.join(repo, 'code.ts'), 'const value = 1;\n');
        git('add', 'code.ts'); git('-c', 'user.name=Test Fixture', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
        process.env.SELF_REPO_PATH = repo; process.env.SELF_WORKTREE_PATH = wt;
        const initial = await selfCodeService.ensureWorktree(); assert.equal(initial.created, true);
        const written = await selfCodeService.writeFile('code.ts', 'const value = 2;\n', 'atomic write integration');
        const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
        assert.equal(written.shaBefore, sha('const value = 1;\n'));
        assert.equal(written.shaAfter, sha('const value = 2;\n'));
        const edited = await selfCodeService.applyEdits('code.ts', [{ find: 'value = 2', replace: 'value = 3' }], 'anchored edit integration');
        assert.equal(edited.shaAfter, sha('const value = 3;\n'));
        assert.equal(fs.readFileSync(path.join(repo, 'code.ts'), 'utf8'), 'const value = 1;\n');
        assert.equal(fs.readFileSync(path.join(wt, 'code.ts'), 'utf8'), 'const value = 3;\n');
        const journal = fs.readFileSync(`${wt}.journal.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
        assert.deepEqual(journal.map(e => e.action), ['init', 'write', 'edit']);
        assert.equal(journal[2].shaBefore, written.shaAfter); assert.equal(journal[2].shaAfter, edited.shaAfter);
        await assert.rejects(selfCodeService.writeFile('../escape', 'no', 'denied'), /escapes/);
        await assert.rejects(selfCodeService.writeFile('.env', 'no', 'denied'), /denied/);
        await assert.rejects(selfCodeService.writeFile('data/a', 'no', 'denied'), /denied/);
        await assert.rejects(selfCodeService.writeFile('code.ts', 'x'.repeat(262145), 'denied'), /256KB/);
        await assert.rejects(selfCodeService.applyEdits('code.ts', [{ find: 'missing', replace: 'x' }], 'denied'), /anchor not found/);
        assert.equal(fs.readFileSync(path.join(wt, 'code.ts'), 'utf8'), 'const value = 3;\n');
        assert.equal(fs.readFileSync(`${wt}.journal.jsonl`, 'utf8').trim().split('\n').length, 3);
        // applyEdits had no 256KiB write cap before this change. Preserve that capability.
        const large = 'x'.repeat(262145);
        await selfCodeService.applyEdits('code.ts', [{ find: 'value = 3', replace: large }], 'preserve prior edit capability');
        assert.equal(fs.readFileSync(path.join(wt, 'code.ts'), 'utf8'), `const ${large};\n`);
    } finally {
        if (oldRepo === undefined) delete process.env.SELF_REPO_PATH; else process.env.SELF_REPO_PATH = oldRepo;
        if (oldWt === undefined) delete process.env.SELF_WORKTREE_PATH; else process.env.SELF_WORKTREE_PATH = oldWt;
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});
