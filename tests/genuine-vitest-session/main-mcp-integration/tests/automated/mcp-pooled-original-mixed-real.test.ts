import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

it('real pooled-original-mixed MCP client must preserve isolation and revocation without retry', () => {
    const script = path.resolve('tests/real-process/mcp-pooled-original-mixed-child.ts');
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
        let postPhase: { schema: number; ordinal: number; phase: string; status: number;
            errorName: string; errorCode: string; origin: string; ingress: boolean; fidelity: boolean } | null = null;
        let postState: 'ABSENT' | 'VALID' | 'INVALID_OR_OVERFLOW' = 'ABSENT';
        let postCount = 0;
        let outerFailure: 'NONE' | 'ASSERTION' | 'OTHER' | 'INVALID_OR_DUPLICATE' = 'NONE';
        for (const line of result.stdout.split('\n')) {
            if (line.startsWith('MCP_OUTER_FAILURE ')) {
                const value = line.slice('MCP_OUTER_FAILURE '.length);
                outerFailure = outerFailure === 'NONE' && (value === 'ASSERTION' || value === 'OTHER') ? value : 'INVALID_OR_DUPLICATE';
            }
            if (!line.startsWith('MCP_POST_PHASE ')) continue;
            postCount++;
            if (postState === 'INVALID_OR_OVERFLOW' || postCount > 64 || line.length > 384) {
                postState = 'INVALID_OR_OVERFLOW'; postPhase = null; continue;
            }
            try {
                const v: unknown = JSON.parse(line.slice('MCP_POST_PHASE '.length));
                if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
                const k = v as Record<string, unknown>;
                if (Object.keys(k).sort().join(',') !== 'errorCode,errorName,fidelity,ingress,ordinal,origin,phase,schema,status' || k.schema !== 1 ||
                    typeof k.ingress !== 'boolean' || typeof k.fidelity !== 'boolean' || typeof k.origin !== 'string' ||
                    !['NOT_RECEIVED','WRAPPER_BOUNDED','WRAPPER_PARSER','SDK_MESSAGE_SCHEMA','SDK_NO_STREAM','SDK_ACCEPTED','PRE_EXPRESS_400_CANDIDATE','UNKNOWN'].includes(k.origin) ||
                    typeof k.ordinal !== 'number' || !Number.isInteger(k.ordinal) || k.ordinal < 0 || k.ordinal > 8 ||
                    typeof k.status !== 'number' || !Number.isInteger(k.status) || !(k.status === 0 || k.status >= 100 && k.status <= 599) ||
                    typeof k.phase !== 'string' || !['REQUEST_START','REQUEST_ERROR','HTTP_REPLY','HTTP_STATUS_ASSERTION','SSE_WAIT','SSE_WAIT_ERROR','SSE_REPLY'].includes(k.phase) ||
                    typeof k.errorName !== 'string' || !['NONE','UNKNOWN','Error','AssertionError','TypeError','RangeError','AbortError'].includes(k.errorName) ||
                    typeof k.errorCode !== 'string' || !['NONE','UNKNOWN','ERR_ASSERTION','ECONNRESET','ECONNREFUSED','EPIPE','ENOENT','EACCES','EPERM','ETIMEDOUT','ENOBUFS','ERR_STREAM_PREMATURE_CLOSE','ERR_HTTP_HEADERS_SENT'].includes(k.errorCode)) throw new Error();
                postPhase = { schema: 1, ordinal: k.ordinal, phase: k.phase, status: k.status,
                    errorName: k.errorName, errorCode: k.errorCode, origin: k.origin, ingress: k.ingress, fidelity: k.fidelity }; postState = 'VALID';
            } catch { postState = 'INVALID_OR_OVERFLOW'; postPhase = null; }
        }
        let nodeState: 'ABSENT' | 'VALID' | 'INVALID_OR_OVERFLOW' = 'ABSENT';
        let nodeCount = 0;
        let nodeStart: { ordinal: number; host: string } | null = null;
        let nodeError: { ordinal: number; code: string } | null = null;
        for (const line of result.stdout.split('\n')) {
            if (!line.startsWith('MCP_NODE_OBSERVATION ')) continue;
            if (++nodeCount > 128 || line.length > 256 || nodeState === 'INVALID_OR_OVERFLOW') { nodeState = 'INVALID_OR_OVERFLOW'; nodeStart = null; nodeError = null; continue; }
            try {
                const v: unknown = JSON.parse(line.slice('MCP_NODE_OBSERVATION '.length));
                if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
                const k = v as Record<string, unknown>;
                if (Object.keys(k).sort().join(',') !== 'code,host,kind,ordinal,schema' || k.schema !== 1 ||
                    typeof k.ordinal !== 'number' || !Number.isInteger(k.ordinal) || k.ordinal < 0 || k.ordinal > 8 ||
                    typeof k.kind !== 'string' || !['REQUEST_START','SOCKET_ERROR'].includes(k.kind) ||
                    typeof k.host !== 'string' || !['PRESENT','ABSENT','UNKNOWN'].includes(k.host) ||
                    typeof k.code !== 'string' || !['NONE','UNKNOWN','HPE_INVALID_METHOD','HPE_INVALID_URL','HPE_INVALID_VERSION','HPE_INVALID_HEADER_TOKEN','HPE_INVALID_CONTENT_LENGTH','HPE_UNEXPECTED_CONTENT_LENGTH','HPE_INVALID_CHUNK_SIZE','HPE_INVALID_EOF_STATE','HPE_CLOSED_CONNECTION','HPE_HEADER_OVERFLOW','HPE_CHUNK_EXTENSIONS_OVERFLOW','ERR_HTTP_REQUEST_TIMEOUT','ECONNRESET','EPIPE'].includes(k.code)) throw new Error();
                if (k.kind === 'REQUEST_START') nodeStart = { ordinal: k.ordinal, host: k.host };
                // Retain first error in current ordinal rather than overwrite a
                // parser error with a later cleanup ECONNRESET.
                if (k.kind === 'SOCKET_ERROR' && (!nodeError || nodeError.ordinal !== k.ordinal)) nodeError = { ordinal: k.ordinal, code: k.code };
                nodeState = 'VALID';
            } catch { nodeState = 'INVALID_OR_OVERFLOW'; nodeStart = null; nodeError = null; }
        }
        let lineageState: 'ABSENT' | 'VALID' | 'INVALID_OR_DUPLICATE' = 'ABSENT';
        let lineage: { clientPost8UsesA: boolean | null; serverParserErrorUsesA: boolean | null } | null = null;
        for (const line of result.stdout.split('\n')) {
            if (!line.startsWith('MCP_SOCKET_LINEAGE ')) continue;
            if (lineageState !== 'ABSENT' || line.length > 192) { lineageState = 'INVALID_OR_DUPLICATE'; lineage = null; continue; }
            try {
                const v: unknown = JSON.parse(line.slice('MCP_SOCKET_LINEAGE '.length));
                if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
                const k = v as Record<string, unknown>;
                if (Object.keys(k).sort().join(',') !== 'clientPost8UsesA,schema,serverParserErrorUsesA' || k.schema !== 1 ||
                    !(k.clientPost8UsesA === null || typeof k.clientPost8UsesA === 'boolean') ||
                    !(k.serverParserErrorUsesA === null || typeof k.serverParserErrorUsesA === 'boolean')) throw new Error();
                lineage = { clientPost8UsesA: k.clientPost8UsesA, serverParserErrorUsesA: k.serverParserErrorUsesA }; lineageState = 'VALID';
            } catch { lineageState = 'INVALID_OR_DUPLICATE'; lineage = null; }
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
            checkpoints: checkpointIds, checkpointOverflow, shapeState, toolDenialShape, postState, postPhase, outerFailure, nodeState, nodeStart, nodeError, lineageState, lineage });
        // The diagnostic contains only constants and bounded numbers, <= 1536
        // bytes by construction (128 two-digit IDs plus fixed-schema enums).
        expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(1536);
        expect(result.error === undefined, diagnostic).toBe(true);
        expect(result.signal === null, diagnostic).toBe(true);
        expect(result.status === 0, diagnostic).toBe(true);
        expect(nodeState === 'VALID', diagnostic).toBe(true);
        expect(lineageState === 'VALID', diagnostic).toBe(true);
        expect(postState === 'VALID' && postPhase?.phase === 'SSE_REPLY' && postPhase.origin === 'SDK_ACCEPTED' && postPhase.ingress && postPhase.fidelity && outerFailure === 'NONE', diagnostic).toBe(true);
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
