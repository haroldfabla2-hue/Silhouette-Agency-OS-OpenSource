import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';
import { execFileSync } from 'child_process';

// F2 Self-Code Toolkit: agents may read/write their own source ONLY inside
// an isolated git worktree. The running tree is never touched, writes need a
// rationale, every mutation lands in an append-only journal, and confinement
// rejects escapes, dotfiles like .env, and dependency/data directories.
//
// These tests run against a REAL throwaway git repository (hermetic tmp dir),
// exercising the real service and routes over HTTP - no mocks.

const ROOT = path.resolve(__dirname, '..', '..');

let tmp: string;
let repo: string;
let worktree: string;
let server: http.Server;
let port: number;

function post(route: string, body: any) {
    return fetch(`http://127.0.0.1:${port}/v1/self/code${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    }).then(async (r) => ({ status: r.status, json: await r.json() as any }));
}

function get(route: string) {
    return fetch(`http://127.0.0.1:${port}/v1/self/code${route}`)
        .then(async (r) => ({ status: r.status, json: await r.json() as any }));
}

describe('F2 self-code toolkit (real git worktree, real HTTP)', () => {
    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcode-'));
        repo = path.join(tmp, 'repo');
        worktree = path.join(tmp, 'repo-selfwork');
        fs.mkdirSync(repo);
        execFileSync('git', ['init', '-q'], { cwd: repo });
        execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
        execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
        fs.mkdirSync(path.join(repo, 'services'));
        fs.writeFileSync(path.join(repo, 'services', 'hello.ts'), 'export const x = 1;\n');
        fs.writeFileSync(path.join(repo, '.env'), 'SHOULD_NEVER_BE_READ=1\n');
        execFileSync('git', ['add', '-A'], { cwd: repo });
        execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

        process.env.SELF_REPO_PATH = repo;
        process.env.SELF_WORKTREE_PATH = worktree;

        const { default: selfCodeRouter } = await import('../../server/routes/v1/selfcode.routes');
        const app = express();
        app.use(express.json());
        app.use('/v1/self/code', selfCodeRouter);
        server = http.createServer(app);
        await new Promise<void>((r) => server.listen(0, r));
        port = (server.address() as any).port;
    });

    afterAll(() => {
        server?.close();
        try {
            execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
        } catch { /* best effort */ }
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.SELF_REPO_PATH;
        delete process.env.SELF_WORKTREE_PATH;
    });

    it('reads a file from the isolated worktree, never the running tree', async () => {
        const { status, json } = await post('/read', { path: 'services/hello.ts' });
        expect(status).toBe(200);
        expect(json.content).toContain('export const x = 1');
        expect(json.sha).toMatch(/^[a-f0-9]{64}$/);
        expect(fs.existsSync(path.join(worktree, 'services', 'hello.ts'))).toBe(true);
    });

    it('rejects escapes, .env, node_modules and data/ with 400', async () => {
        for (const p of ['../outside.ts', '/etc/passwd', '.env', 'node_modules/x.js', 'data/memory.json']) {
            const { status } = await post('/read', { path: p });
            expect(status).toBe(400);
        }
    });

    it('writes require a rationale and are journaled with before/after hashes', async () => {
        const noReason = await post('/write', { path: 'services/hello.ts', content: 'export const x = 2;\n' });
        expect(noReason.status).toBe(400);

        const ok = await post('/write', { path: 'services/hello.ts', content: 'export const x = 2;\n', rationale: 'bump x' });
        expect(ok.status).toBe(200);
        expect(ok.json.shaBefore).toMatch(/^[a-f0-9]{64}$/);
        expect(ok.json.shaAfter).toMatch(/^[a-f0-9]{64}$/);
        expect(ok.json.shaBefore).not.toBe(ok.json.shaAfter);

        const journal = await get('/journal');
        const writes = journal.json.entries.filter((e: any) => e.action === 'write');
        expect(writes.length).toBeGreaterThanOrEqual(1);
        expect(writes[writes.length - 1].rationale).toBe('bump x');
        expect(writes[writes.length - 1].shaAfter).toBe(ok.json.shaAfter);
    });

    it('diff reflects worktree changes; the source repo stays untouched', async () => {
        const { status, json } = await get('/diff');
        expect(status).toBe(200);
        expect(json.diff).toContain('x = 2');
        // The original repo must be clean: F2 never mutates the running tree.
        const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim();
        expect(dirty).toBe('');
    });

    it('rejects oversized writes and missing targets', async () => {
        const bigRes = await fetch(`http://127.0.0.1:${port}/v1/self/code/write`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'services/big.ts', content: 'x'.repeat(300 * 1024), rationale: 'too big' })
        });
        expect([400, 413]).toContain(bigRes.status); // service cap or framework body limit
        expect(fs.existsSync(path.join(worktree, 'services', 'big.ts'))).toBe(false);
        const missing = await post('/read', { path: 'services/nope.ts' });
        expect(missing.status).toBe(404);
    });

    it('source guards: denylist and caps exist and main is never committed to', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/selfCodeService.ts'), 'utf8');
        expect(svc).toMatch(/DENIED_SEGMENTS/);
        expect(svc).toMatch(/MAX_WRITE_BYTES/);
        expect(svc).not.toMatch(/git['"]?, \['commit/); // never commits
        expect(svc).not.toMatch(/systemctl|pm2|restart/); // never restarts the deployment
    });
});
