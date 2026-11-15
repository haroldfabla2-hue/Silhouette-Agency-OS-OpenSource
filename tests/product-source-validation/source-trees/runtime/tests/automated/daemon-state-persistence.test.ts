/**
 * Daemon state persistence: the state file must never be left truncated.
 *
 * Root fix pinned here (observed in prod: 42x "[DAEMON] Failed to load
 * state: Unexpected end of JSON input" after unclean process exits):
 *  1. saveState writes a tmp sibling, fsyncs, then renames over the state
 *     file - an exit mid-write leaves the previous good file intact.
 *  2. loadState quarantines an unreadable file (.corrupt-<ts>) instead of
 *     deleting it or warning on every boot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../services/redisClient', () => ({
    redisClient: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'isConnected' || prop === 'isMock') return false;
            return async () => true;
        }
    })
}));

import { UnifiedDaemon } from '../../services/daemon/unifiedDaemon';

const tmpDirs: string[] = [];
afterEach(() => {
    tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});

function freshDaemon() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-state-'));
    tmpDirs.push(dir);
    const daemon = new UnifiedDaemon();
    const stateFile = path.join(dir, 'daemon_state.json');
    (daemon as any).STATE_FILE = stateFile;
    (daemon as any).tasks = [{
        name: 'ProbeTask',
        intervalMs: 60_000,
        enabled: true,
        lastRun: 1729000000000,
        runCount: 41,
        errCount: 3,
        execute: async () => {}
    }];
    return { daemon, stateFile, dir };
}

describe('daemon state persistence (real fs)', () => {
    it('save then load round-trips task stats', async () => {
        const { daemon, stateFile } = freshDaemon();
        await (daemon as any).saveState();

        const second = new UnifiedDaemon();
        (second as any).STATE_FILE = stateFile;
        (second as any).tasks = [{
            name: 'ProbeTask', intervalMs: 60_000, enabled: true, execute: async () => {}
        }];
        await (second as any).loadState();

        const t = (second as any).tasks[0];
        expect(t.lastRun).toBe(1729000000000);
        expect(t.runCount).toBe(41);
        expect(t.errCount).toBe(3);
    });

    it('save leaves valid JSON and no tmp residue', async () => {
        const { daemon, stateFile, dir } = freshDaemon();
        await (daemon as any).saveState();
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        expect(parsed.tasks.ProbeTask.runCount).toBe(41);
        expect(fs.existsSync(`${stateFile}.tmp`)).toBe(false);
        expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toHaveLength(0);
    });

    it('a truncated state file is quarantined, never deleted, and boot proceeds', async () => {
        const { daemon, stateFile, dir } = freshDaemon();
        fs.writeFileSync(stateFile, '{"tasks":{"ProbeTask":{"lastRun":1729', 'utf-8'); // truncated mid-write
        await (daemon as any).loadState(); // must not throw

        expect(fs.existsSync(stateFile)).toBe(false);
        const quarantined = fs.readdirSync(dir).filter(f => f.startsWith('daemon_state.json.corrupt-'));
        expect(quarantined).toHaveLength(1);
        const preserved = fs.readFileSync(path.join(dir, quarantined[0]), 'utf-8');
        expect(preserved).toBe('{"tasks":{"ProbeTask":{"lastRun":1729');

        // and the daemon recovers: next save writes a clean new state
        await (daemon as any).saveState();
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        expect(parsed.tasks.ProbeTask.runCount).toBe(41);
    });

    it('source guard: state writes go through tmp + rename, no direct overwrite', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../services/daemon/unifiedDaemon.ts'), 'utf-8');
        expect(src).not.toMatch(/writeFile\(this\.STATE_FILE/);
        expect(src).toContain('${this.STATE_FILE}.tmp');
        expect(src).toContain('.corrupt-');
    });
});
