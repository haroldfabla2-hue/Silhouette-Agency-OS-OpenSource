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
        // Fixed-schema diagnostics only. Never forward stdout/stderr, Error
        // messages/stacks, paths, spawnargs, environment or credential prefixes.
        const allowed = ['MCP_CHECKPOINT {"id":1}', 'MCP_CHECKPOINT {"id":2}', 'MCP_CHECKPOINT {"id":3}', 'MCP_CHECKPOINT {"id":4}', 'MCP_CHECKPOINT {"id":5}', 'MCP_CHECKPOINT {"id":6}', 'MCP_CHECKPOINT {"id":7}', 'MCP_CHECKPOINT {"id":8}', 'MCP_CHECKPOINT {"id":9}', 'MCP_CHECKPOINT {"id":10}', 'MCP_CHECKPOINT {"id":11}', 'MCP_CHECKPOINT {"id":12}', 'MCP_CHECKPOINT {"id":13}', 'MCP_CHECKPOINT {"id":14}', 'MCP_CHECKPOINT {"id":15}', 'MCP_CHECKPOINT {"id":16}', 'MCP_CHECKPOINT {"id":17}', 'MCP_CHECKPOINT {"id":18}', 'MCP_CHECKPOINT {"id":19}', 'MCP_CHECKPOINT {"id":20}', 'MCP_CHECKPOINT {"id":21}', 'MCP_CHECKPOINT {"id":22}', 'MCP_CHECKPOINT {"id":23}', 'MCP_CHECKPOINT {"id":24}', 'MCP_CHECKPOINT {"id":25}', 'MCP_CHECKPOINT {"id":26}', 'MCP_CHECKPOINT {"id":27}', 'MCP_CHECKPOINT {"id":28}', 'MCP_CHECKPOINT {"id":29}', 'MCP_CHECKPOINT {"id":30}', 'MCP_CHECKPOINT {"id":31}', 'MCP_CHECKPOINT {"id":32}', 'MCP_CHECKPOINT {"id":33}', 'MCP_CHECKPOINT {"id":34}', 'MCP_CHECKPOINT {"id":35}'] as const;
        const checkpointIds: number[] = [];
        let checkpointOverflow = false;
        // Only a closed, reconstructed shape can cross into the report.
        let toolDenialShape: { schema: number; rpcError: boolean; resultObject: boolean;
            isError: string; contentArray: boolean; contentSize: string; firstType: string } | null = null;
        let shapeState: 'ABSENT' | 'VALID' | 'INVALID_OR_DUPLICATE' = 'ABSENT';
        for (const line of result.stdout.split('\n')) {
            if (!line.startsWith('MCP_TOOL_DENIAL_SHAPE ')) continue;
            if (shapeState !== 'ABSENT' || line.length > 384) { shapeState = 'INVALID_OR_DUPLICATE'; toolDenialShape = null; continue; }
            try {
                const v: unknown = JSON.parse(line.slice('MCP_TOOL_DENIAL_SHAPE '.length));
                if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
                const k = v as Record<string, unknown>;
                if (Object.keys(k).sort().join(',') !== 'contentArray,contentSize,firstType,isError,resultObject,rpcError,schema' ||
                    k.schema !== 1 || typeof k.rpcError !== 'boolean' || typeof k.resultObject !== 'boolean' || typeof k.contentArray !== 'boolean' ||
                    typeof k.isError !== 'string' || !['TRUE','FALSE','ABSENT_OR_OTHER'].includes(k.isError) ||
                    typeof k.contentSize !== 'string' || !['ZERO','ONE','MANY','ABSENT_OR_OTHER'].includes(k.contentSize) ||
                    typeof k.firstType !== 'string' || !['TEXT','ABSENT_OR_OTHER'].includes(k.firstType)) throw new Error();
                toolDenialShape = { schema: 1, rpcError: k.rpcError, resultObject: k.resultObject,
                    isError: k.isError, contentArray: k.contentArray, contentSize: k.contentSize, firstType: k.firstType };
                shapeState = 'VALID';
            } catch { shapeState = 'INVALID_OR_DUPLICATE'; toolDenialShape = null; }
        }
        for (const line of result.stdout.split('\n')) {
            const index = (allowed as readonly string[]).indexOf(line);
            if (index < 0) continue; // Arbitrary product logs are not evidence fields.
            if (checkpointIds.length < 128) checkpointIds.push(index + 1);
            else checkpointOverflow = true;
        }
        const enumField = (value: unknown, values: readonly string[]) =>
            typeof value === 'string' && values.includes(value) ? value : 'UNKNOWN';
        const e = result.error;
        const errno = e && 'errno' in e ? e.errno : undefined;
        const code = e && 'code' in e ? e.code : undefined;
        const syscall = e && 'syscall' in e ? e.syscall : undefined;
        const diagnostic = JSON.stringify({ schema: 1, label: 'MCP_NESTED_SPAWN_FIXED_SCHEMA',
            errorPresent: e !== undefined,
            errorName: e ? enumField(e.name, ['Error', 'TypeError', 'RangeError', 'AbortError']) : 'NONE',
            errorCode: e ? enumField(code, ['ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES', 'EPERM', 'EAGAIN', 'ENOMEM', 'E2BIG', 'ENOTDIR', 'EINVAL', 'EIO']) : 'NONE',
            errno: e ? (typeof errno === 'number' && Number.isInteger(errno) && errno >= -4096 && errno <= 4096 ? errno : 'UNKNOWN') : 'NONE',
            syscall: e ? (syscall === `spawnSync ${process.execPath}` ? 'spawnSync-execPath' : 'UNKNOWN') : 'NONE',
            signal: result.signal === null ? 'NONE' : enumField(result.signal, ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'SIGILL', 'SIGINT', 'SIGQUIT', 'SIGPIPE', 'SIGXCPU', 'SIGXFSZ']),
            status: result.status === null ? 'NONE' : (Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : 'UNKNOWN'),
            checkpoints: checkpointIds, checkpointOverflow, shapeState, toolDenialShape });
        // The diagnostic contains only constants and bounded numbers, <= 1536
        // bytes by construction (128 two-digit IDs plus fixed-schema enums).
        expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(1536);
        expect(result.error === undefined, diagnostic).toBe(true);
        expect(result.signal === null, diagnostic).toBe(true);
        expect(result.status === 0, diagnostic).toBe(true);
        expect(shapeState === 'VALID', diagnostic).toBe(true);
        expect(toolDenialShape, diagnostic).toEqual({ schema: 1, rpcError: false,
            resultObject: true, isError: 'TRUE', contentArray: true, contentSize: 'ONE', firstType: 'TEXT' });
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
