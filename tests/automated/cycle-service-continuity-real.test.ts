/** Proposed full actual service/router restart validation. NOT RUN.
 * Outer admission must provide no-egress sandbox and owned-process cleanup.
 * All state is newly authored test data. No private server state or mocks. */
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const script = path.resolve('tests/real-process/cycle-continuity-child.ts');
const loader = pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href;
function ownedCase(body: (root: string, dir: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
    const dir = path.join(root, 'cycles'); fs.mkdirSync(dir);
    try { body(root, dir); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function phase(root: string, dir: string, mode: string) {
    const result = spawnSync(process.execPath, ['--import', loader, script, mode], {
        cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, NODE_OPTIONS: '--max-old-space-size=2048', NODE_ENV: 'test', VITEST: 'true',
            SILHOUETTE_PROVIDERS: 'off', SILHOUETTE_BOOT_MODE: 'acceptance', SELFDEV_DIR: dir,
            SELF_REPO_PATH: path.join(root, 'no-repository'), SELF_WORKTREE_PATH: path.join(root, 'no-worktree') }
    });
    // A timeout, signal, forced child or missing raw completion is a failure.
    expect(result.error, result.stderr).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status, result.stderr).toBe(0);
    const rows = result.stdout.split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
    expect(rows.at(-1)).toMatchObject({ phase: mode, fullService: true, actualRouter: true,
        httpStatus: mode === 'unavailable' ? 503 : 200, providerMode: 'off', plannerInvoked: false,
        patchExecuted: false, applied: false });
}
function files(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (at: string) => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
            const p = path.join(at, entry.name);
            if (entry.isDirectory()) walk(p);
            else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        }
    }; walk(dir); return out;
}
it('preserves real service-created complete and active history over two natural process restarts and actual HTTP reads', () => ownedCase((root, dir) => {
    phase(root, dir, 'seed'); const before = files(dir);
    phase(root, dir, 'valid'); phase(root, dir, 'valid'); expect(files(dir)).toEqual(before);
}), 70000);
it('retains legacy minimal id plus known state unchanged across actual service and router restarts', () => ownedCase((root, dir) => {
    const bytes = JSON.stringify({ cycles: [{ id: 'legacy-completed', state: 'ABANDONED' }, { id: 'legacy-active', state: 'PLANNED' }] });
    fs.writeFileSync(path.join(dir, 'cycles.json'), bytes); fs.writeFileSync(path.join(root, 'expected-cycles.json'), bytes);
    const before = files(dir); phase(root, dir, 'valid'); phase(root, dir, 'valid'); expect(files(dir)).toEqual(before);
}), 50000);
it.each(['corrupt', 'journal-only', 'quarantine-only', 'request-only', 'result-only'])('keeps %s evidence unchanged across repeated full-service restarts and returns HTTP503, not empty success', kind => ownedCase((root, dir) => {
    if (kind === 'corrupt') fs.writeFileSync(path.join(dir, 'cycles.json'), '{corrupt original');
    if (kind === 'journal-only') fs.writeFileSync(path.join(dir, 'cycles.journal.jsonl'), '{"event":"CREATED","cycleId":"authored-existing"}\n');
    if (kind === 'quarantine-only') fs.writeFileSync(path.join(dir, 'cycles.json.corrupt-prior'), '{older preserved evidence');
    if (kind === 'request-only' || kind === 'result-only') {
        const folder = kind === 'request-only' ? 'pr-requests' : 'pr-results';
        fs.mkdirSync(path.join(dir, folder)); fs.writeFileSync(path.join(dir, folder, 'existing.json'), '{"cycleId":"authored-existing"}');
    }
    const before = files(dir); phase(root, dir, 'unavailable'); phase(root, dir, 'unavailable');
    expect(files(dir)).toEqual(before);
    // Constructor effects are explicit: both empty publisher dirs can be
    // created before detecting unavailable state; no publisher action occurs.
    expect(fs.statSync(path.join(dir, 'pr-requests')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(dir, 'pr-results')).isDirectory()).toBe(true);
}), 50000);
