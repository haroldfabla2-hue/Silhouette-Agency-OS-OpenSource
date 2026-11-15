import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { boundedMessage, sessionExpired, MCP_LIMITS } from '../../server/mcp/mcpServer';

it('bounds a single object, depth and nodes, rejecting legacy batches', () => {
    expect(boundedMessage({ jsonrpc: '2.0', method: 'ping', id: 1 })).toBe(true);
    expect(boundedMessage([])).toBe(false);
    expect(boundedMessage({ a: Array(5000).fill(0) })).toBe(false);
    let deep: object = {};
    for (let i = 0; i < 66; i++) deep = { a: deep };
    expect(boundedMessage(deep)).toBe(false);
});
it('expires absolute and idle deadlines at the boundary without resetting birth on activity', () => {
    expect(sessionExpired(MCP_LIMITS.idleMs - 1, 0, 0)).toBe(false);
    expect(sessionExpired(MCP_LIMITS.idleMs, 0, 0)).toBe(true);
    expect(sessionExpired(MCP_LIMITS.lifetimeMs, 0, MCP_LIMITS.lifetimeMs - 1)).toBe(true);
});
it('runs actual composed identity/key/parser/two-client SDK behavior in a fresh natural child', () => {
    const script = path.resolve('tests/real-process/mcp-boundary-child.ts');
    const loader = pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
    try {
        const result = spawnSync(process.execPath, ['--import', loader, script], {
            cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
            env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, NODE_ENV: 'test',
                SILHOUETTE_PROVIDERS: 'off', SILHOUETTE_BOOT_MODE: 'acceptance',
                SILHOUETTE_HOST: '127.0.0.1', SILHOUETTE_DB_PATH: path.join(root, 'authored.sqlite') }
        });
        expect(result.error, result.stderr).toBeUndefined();
        expect(result.signal).toBeNull(); expect(result.status, result.stderr).toBe(0);
        const rows = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
        expect(rows.at(-1)).toMatchObject({ actualAuth: true, actualKeyStore: true,
            actualSdk: true, keyStoreKind: 'fresh-exclusive-ephemeral-sqlite', productionCredentialPersistenceVerified: false, composedBoundary: true, fullApplicationBoot: false,
            transport: 'AF_UNIX', disposableSqliteWrites: true, providerCalls: 0, executedTools: 0 });
    } finally {
        // Includes SQLite+WAL+SHM and any UNIX socket. A timed-out child fails
        // above, never counts as PASS. Outer sandbox must establish no residuals.
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 40_000);
