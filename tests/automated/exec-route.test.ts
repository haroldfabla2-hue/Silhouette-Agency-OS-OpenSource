import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';

// F3 Command Execution: real OS isolation (bubblewrap) or an honest
// UNAVAILABLE - never an unsafe fallback. Tiered whitelist, per-action
// operator approval for anything outside it, forbidden commands rejected
// outright, and everything journaled.
//
// Real service + real HTTP. Sandbox execution itself runs only when the
// host has bubblewrap; either way the honesty contract is asserted.

const ROOT = path.resolve(__dirname, '..', '..');

let server: http.Server;
let port: number;
let journalFile: string;
let modeFile: string;
let isolationReady: boolean;

function get(route: string) {
    return fetch(`http://127.0.0.1:${port}/v1/self/exec${route}`)
        .then(async (r) => ({ status: r.status, json: await r.json() as any }));
}

function post(route: string, body: any) {
    return fetch(`http://127.0.0.1:${port}/v1/self/exec${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    }).then(async (r) => ({ status: r.status, json: await r.json() as any }));
}

describe('F3 command execution (real service, real HTTP)', () => {
    beforeAll(async () => {
        journalFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exec-journal-')), 'journal.jsonl');
        process.env.SELF_EXEC_JOURNAL = journalFile;
        modeFile = path.join(path.dirname(journalFile), 'exec-mode.json');
        process.env.SELF_EXEC_MODE_FILE = modeFile;
        const { default: execRouter } = await import('../../server/routes/v1/exec.routes');
        const app = express();
        app.use(express.json());
        app.use('/v1/self/exec', execRouter);
        server = http.createServer(app);
        await new Promise<void>((r) => server.listen(0, r));
        port = (server.address() as any).port;
        // Probe the service's own isolation verdict (binary + sandbox root),
        // so the assertion matches the environment the service actually sees.
        const iso = await fetch(`http://127.0.0.1:${port}/v1/self/exec/isolation`).then((r) => r.json() as any);
        isolationReady = iso.available === true;
    });

    afterAll(() => {
        server?.close();
        delete process.env.SELF_EXEC_JOURNAL;
        delete process.env.SELF_EXEC_MODE_FILE;
    });

    it('tier1 read-only diagnostics run sandboxed, or report UNAVAILABLE without degrading', async () => {
        const { status, json } = await post('/run', { command: 'uname', args: ['-a'] });
        if (isolationReady) {
            expect(status).toBe(200);
            expect(json.status).toBe('executed');
            expect(json.exitCode).toBe(0);
            expect(json.outputTail).toMatch(/Linux|Darwin/);
            expect(json.outputSha).toMatch(/^[a-f0-9]{64}$/);
        } else {
            expect(status).toBe(503);
            expect(json.status).toBe('unavailable');
            expect(json.reason).toMatch(/bubblewrap|sandbox/);
        }
    });

    it('destructive, service-control and network commands are rejected outright', async () => {
        // F4 moved apt-family to operator-approved host mutation (tested
        // below); the truly destructive/control/network set stays hard-rejected.
        for (const cmd of ['rm', 'systemctl', 'curl', 'sudo', 'kill']) {
            const { status, json } = await post('/run', { command: cmd, args: [] });
            expect(status).toBe(403);
            expect(json.status).toBe('rejected');
        }
    });

    it('arguments touching data/, .env, /etc or .git are rejected', async () => {
        for (const args of [['data/memory.json'], ['.env'], ['/etc/hosts'], ['.git/config']]) {
            const { status } = await post('/run', { command: 'cat', args });
            expect(status).toBe(403);
        }
    });

    it('non-whitelist commands go pending and run only after operator approval', async () => {
        const req = await post('/run', { command: 'hostname', args: [] });
        expect(req.status).toBe(202);
        expect(req.json.status).toBe('pending_approval');

        const approved = await post('/approve', { id: req.json.id, approvedBy: 'operator-test' });
        if (isolationReady) {
            expect(approved.status).toBe(200);
            expect(approved.json.status).toBe('executed');
            expect(approved.json.approvedBy).toBe('operator-test');
        } else {
            expect(approved.status).toBe(503);
            expect(approved.json.status).toBe('unavailable');
        }

        const again = await post('/approve', { id: req.json.id, approvedBy: 'operator-test' });
        expect(again.status).toBe(404); // one-shot: approval cannot be replayed
    });

    it('operator rejection is journaled and final', async () => {
        const req = await post('/run', { command: 'hostname', args: ['-f'] });
        expect(req.status).toBe(202);
        const rej = await post('/reject', { id: req.json.id, approvedBy: 'operator-test' });
        expect(rej.status).toBe(200);
        expect(rej.json.status).toBe('rejected');
        const replay = await post('/approve', { id: req.json.id, approvedBy: 'operator-test' });
        expect(replay.status).toBe(404);
    });

    it('every decision lands in the journal with status and reason', async () => {
        const entries = (await (await fetch(`http://127.0.0.1:${port}/v1/self/exec/journal?limit=100`)).json() as any).entries;
        const statuses = new Set(entries.map((e: any) => e.status));
        expect(statuses.has('rejected')).toBe(true);
        expect(entries.some((e: any) => e.reason)).toBe(true);
        expect(entries.length).toBeGreaterThan(0);
    });

    it('gitdir binds: worktree pointer resolves read-only git dirs, crafted pointers are refused', async () => {
        const { commandExecService } = await import('../../services/commandExecService');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-binds-'));
        try {
            const allowed = path.join(root, 'repo', '.git');
            const wtGitdir = path.join(allowed, 'worktrees', 'selfwork');
            fs.mkdirSync(wtGitdir, { recursive: true });
            fs.writeFileSync(path.join(wtGitdir, 'commondir'), '../..\n');
            const wt = path.join(root, 'selfwork');
            fs.mkdirSync(wt, { recursive: true });
            fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGitdir}\n`);

            const binds = commandExecService.gitDirBinds(wt, allowed);
            expect(binds).toContain(wtGitdir);
            expect(binds).toContain(allowed);

            // crafted pointer outside the allowed root: refused
            fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /etc\n');
            expect(commandExecService.gitDirBinds(wt, allowed)).toEqual([]);

            // a real repo (directory .git) needs no extra binds
            const plainRepo = path.join(root, 'plain');
            fs.mkdirSync(path.join(plainRepo, '.git'), { recursive: true });
            expect(commandExecService.gitDirBinds(plainRepo, allowed)).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('execution mode: isolated by default, operator-only change, journaled', async () => {
        const iso0 = await get('/isolation');
        expect(iso0.json.mode).toBe('isolated');

        const noOperator = await post('/mode', { mode: 'full-access' });
        expect(noOperator.status).toBe(400);
        const badMode = await post('/mode', { mode: 'open', approvedBy: 'ci-operator' });
        expect(badMode.status).toBe(400);

        const set = await post('/mode', { mode: 'full-access', approvedBy: 'ci-operator' });
        expect(set.status).toBe(200);
        const iso1 = await get('/isolation');
        expect(iso1.json.mode).toBe('full-access');

        const j = await get('/journal');
        expect(j.json.entries.some((e: any) => e.command === 'mode:full-access' && e.approvedBy === 'ci-operator')).toBe(true);
    });

    it('full-access mode runs tier1 on the host (sandbox:false, mode recorded)', async () => {
        await post('/mode', { mode: 'full-access', approvedBy: 'ci-operator' });
        const { status, json } = await post('/run', { command: 'uname', args: ['-a'] });
        expect(status).toBe(200);
        expect(json.status).toBe('executed');
        expect(json.sandbox).toBe(false);
        expect(json.mode).toBe('full-access');
        expect(json.exitCode).toBe(0);
        await post('/mode', { mode: 'isolated', approvedBy: 'ci-operator' });
        const iso = await get('/isolation');
        expect(iso.json.mode).toBe('isolated');
    });

    it('environment mutation (apt) goes pending, never auto-runs, executes on host after approval', async () => {
        const run1 = await post('/run', { command: 'apt', args: ['list', '--installed'] });
        expect(run1.status).toBe(202);
        expect(run1.json.status).toBe('pending_approval');
        expect(run1.json.reason).toMatch(/host environment/);

        const ap = await post('/approve', { id: run1.json.id, approvedBy: 'ci-operator' });
        expect(ap.status).toBe(200);
        expect(ap.json.status).toBe('executed');
        expect(ap.json.sandbox).toBe(false);
        expect(ap.json.exitCode).toBe(0);
        expect(ap.json.outputSha).toMatch(/^[a-f0-9]{64}$/);
    });

    it('untrusted external context forces approval even for whitelisted commands', async () => {
        const { status, json } = await post('/run', { command: 'uname', args: ['-a'], untrustedContext: true });
        expect(status).toBe(202);
        expect(json.status).toBe('pending_approval');
        expect(json.reason).toMatch(/untrusted external content/);
        expect(json.untrustedContext).toBe(true);
    });

    it('source guards: bubblewrap is the only backend, no unsafe runner exists', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/commandExecService.ts'), 'utf8');
        expect(svc).toMatch(/--unshare-all/);
        expect(svc).toMatch(/--cap-drop', 'ALL/);
        expect(svc).not.toMatch(/node:vm|require\('vm'\)|from 'vm'/); // vm is not isolation
        expect(svc).not.toMatch(/shell:\s*true/); // no shell interpolation
    });
});
