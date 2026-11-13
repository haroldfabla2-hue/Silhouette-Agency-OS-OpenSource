// Preparation only. Real loopback transport + auth + effect. No app mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
const effectPath = path.resolve('mcp-fixture-effect.txt');
const journalPath = path.resolve('effect-journal.jsonl');
// Sync append + fsync before any effect; no fixture payload can choose path.
const journal = (entry: Record<string, unknown>) => {
    const bytes = Buffer.from(JSON.stringify(entry) + '\n');
    assert.ok(bytes.length <= 65536);
    assert.ok(fsSync.statSync(journalPath).size + bytes.length <= 262144);
    const fd = fsSync.openSync(journalPath, 'a');
    try { fsSync.writeFileSync(fd, bytes); fsSync.fsyncSync(fd); }
    finally { fsSync.closeSync(fd); }
};
assert.equal(await fs.readFile('FIXTURE_ONLY', 'utf8'), 'MCP_EFFECT_ONLY');
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.NO_SANDBOX, undefined);
assert.equal(process.env.SILHOUETTE_API_KEY, 'fixture-local-system-token');
const { identityService } = await import('../../../services/identityService.ts');
const { mcpClient } = await import('../../../services/mcp/mcpClient.ts');
const { authMiddleware, resetTokenCache } = await import('../../../server/middleware/authMiddleware.ts');
const { default: autonomyRouter } = await import('../../../server/routes/v1/autonomy.routes.ts');
type ToolArgs = { text: string; requestLabel: string };
type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
type Confirmation = { id: string; action: { payload: { effect: string; args: ToolArgs } } };
const outcomes: Promise<Outcome>[] = [];
const calls: { rpcId: unknown; raw: string; args: unknown; valid: boolean }[] = [];
const requests: Promise<unknown>[] = [];
const serverErrors: unknown[] = [];
let sseCount = 0, discoveryCount = 0;
let mcpServer: Server | undefined, appServer: Server | undefined;
const handled = <T>(work: Promise<T>): Promise<T> => { void work.catch(() => undefined); return work; };
const listen = (server: Server) => new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        server.on('error', error => serverErrors.push(error));
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
});
const close = (server: Server | undefined) => !server ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
});
const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const getAbsent = async () => {
    try { await fs.stat(effectPath); assert.fail('Unexpected effect exists'); }
    catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT'); }
};
const effectCount = async (expected: number, bytes?: Buffer) => {
    assert.equal(calls.length, expected); assert.deepEqual(serverErrors, []);
    if (expected === 0) await getAbsent();
    else { assert.ok(bytes); assert.deepEqual(await fs.readFile(effectPath), bytes); }
};
let bodyDone = false;
try {
    mcpServer = http.createServer((req, res) => {
        const task = (async () => {
            if (req.method === 'GET' && req.url === '/sse') {
                ++sseCount;
                // Real finite SSE response. Actual client does not consume/cancel body.
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'close' });
                res.end('event: endpoint\ndata: /messages\n\n'); return;
            }
            assert.equal(req.method, 'POST'); assert.equal(req.url, '/messages');
            let raw = '';
            for await (const chunk of req) { raw += chunk.toString(); assert.ok(Buffer.byteLength(raw) < 65536); }
            const rpc: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } } = JSON.parse(raw);
            // Count every tools/call before validation/effect, including malformed/repeated.
            const row = rpc.method === 'tools/call' ? { rpcId: rpc.id, raw, args: rpc.params?.arguments, valid: false } : undefined;
            if (row) {
                calls.push(row);
                journal({ stage: 'CALL_RECEIVED', sequence: calls.length, rawRPC: raw, rpcId: rpc.id ?? null, args: rpc.params?.arguments ?? null });
            }
            assert.equal(rpc.jsonrpc, '2.0'); assert.equal(typeof rpc.id, 'string');
            let result: unknown;
            if (rpc.method === 'tools/list') {
                ++discoveryCount; assert.match(String(rpc.id), /^discover_\d+$/);
                result = { tools: [{ name: 'write_fixture', description: 'writes one fixed cwd fixture file', inputSchema: { type: 'object', properties: { text: { type: 'string' }, requestLabel: { type: 'string' } }, required: ['text','requestLabel'], additionalProperties: false } }] };
            } else {
                assert.ok(row); assert.equal(rpc.method, 'tools/call'); assert.match(String(rpc.id), /^exec_\d+$/);
                assert.equal(calls.length, 1); assert.equal(rpc.params?.name, 'write_fixture');
                const args = rpc.params?.arguments as ToolArgs;
                assert.deepEqual(Object.keys(args).sort(), ['requestLabel','text']);
                assert.equal(args.requestLabel, 'approved'); assert.equal(args.text, 'fixture actual write\n');
                row.valid = true;
                journal({ stage: 'CALL_VALIDATED', sequence: calls.length, rpcId: rpc.id, args });
                // Destination is NOT accepted from args. Real fs write/readback before response.
                await fs.writeFile(effectPath, args.text, { flag: 'wx' });
                const bytes = await fs.readFile(effectPath); assert.equal(bytes.toString(), args.text);
                result = { rpcId: rpc.id, requestLabel: args.requestLabel, checksum: sha(bytes), byteLength: bytes.length, content: bytes.toString() };
                journal({ stage: 'EFFECT_READBACK', sequence: calls.length, rpcId: rpc.id, receipt: result, readbackBase64: bytes.toString('base64') });
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
        })();
        handled(task); requests.push(task);
        void task.catch(error => { serverErrors.push(error); res.writeHead(500, { 'Connection': 'close' }); res.end('fixture failure'); });
    });
    const endpoint = await listen(mcpServer);
    mcpClient.registerServer({ name: 'fixture-local', url: endpoint, autoConnect: false });
    await identityService.init();
    const A = await identityService.upsertUser({ email: 'a@fixture.invalid', name: 'Fixture A' });
    const B = await identityService.upsertUser({ email: 'b@fixture.invalid', name: 'Fixture B' });
    const sessionA = identityService.createSession(A.id, identityService.registerDevice(A.id, 'fixture-A', 'A').id).id;
    const sessionB = identityService.createSession(B.id, identityService.registerDevice(B.id, 'fixture-B', 'B').id).id;
    resetTokenCache(); const app = express(); app.use(express.json()); app.use(authMiddleware);
    app.post('/fixture/start', (req, res) => {
        // Middleware supplies actual authenticated AsyncLocal principal. No manual context.
        const args: ToolArgs = { text: String(req.body.text), requestLabel: String(req.body.requestLabel) };
        const original = mcpClient.executeTool('fixture-local', 'write_fixture', args);
        // Attach rejection handler immediately, keep original outcome promise, no blocking before decision.
        const outcome = original.then<Outcome, Outcome>(value => ({ ok: true, value }), error => ({ ok: false, error }));
        outcomes.push(outcome); res.json({ index: outcomes.length - 1 });
    });
    app.use('/v1/autonomy', autonomyRouter); appServer = http.createServer(app);
    const base = await listen(appServer);
    const request = async (route: string, session: string | null, method = 'GET', body?: unknown) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Connection': 'close' };
        if (session) headers['x-session-id'] = session; else headers.Authorization = 'Bearer fixture-local-system-token';
        const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(2000) });
        const value: unknown = await response.json(); assert.equal(response.status, 200); return value;
    };
    const start = async (session: string | null, args: ToolArgs) => {
        const result = await request('/fixture/start', session, 'POST', args) as { index: number };
        assert.equal(typeof result.index, 'number'); assert.ok(outcomes[result.index]); return { index: result.index };
    };
    const list = async (session: string) => {
        const result = await request('/v1/autonomy/confirmations', session) as { success: boolean; confirmations: Confirmation[] };
        assert.equal(result.success, true); return result.confirmations;
    };
    const pending = async (label: string) => {
        const until = performance.now() + 2000;
        while (performance.now() < until) {
            const rows = await list(sessionA);
            if (rows.length) { assert.equal(rows.length, 1); assert.equal(rows[0].action.payload.effect, 'mcp_external:fixture-local:write_fixture'); assert.equal(rows[0].action.payload.args.requestLabel, label); return rows[0]; }
            await new Promise<void>(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Missing actual pending before deadline');
    };
    const decision = async (id: string, session: string, choice: 'approve' | 'reject', expected: boolean) => {
        const result = await request(`/v1/autonomy/confirmations/${id}/${choice}`, session, 'POST') as { success: boolean };
        assert.equal(result.success, expected);
    };
    const outcome = async (index: number) => {
        const result = await outcomes[index]; assert.equal(result.ok, true);
        if (result.ok === false) throw result.error; return result.value as Record<string, unknown>;
    };
    const noPrincipal = await start(null, { text: 'deny', requestLabel: 'system' });
    assert.equal((await outcome(noPrincipal.index)).blocked, true); await effectCount(0);
    assert.ok(sseCount >= 1); assert.ok(discoveryCount >= 1); assert.deepEqual(await list(sessionA), []);
    console.log('MCP_EFFECT_FIXTURE:' + JSON.stringify({ event: 'NO_PRINCIPAL_DENIED', calls: calls.length, effect: false, sseCount, discoveryCount }));
    const rejected = await start(sessionA, { text: 'deny', requestLabel: 'rejected' });
    const rejectPending = await pending('rejected'); assert.deepEqual(await list(sessionB), []);
    await effectCount(0); await decision(rejectPending.id, sessionB, 'approve', false); await effectCount(0);
    await decision(rejectPending.id, sessionB, 'reject', false); await effectCount(0);
    assert.equal((await list(sessionA))[0].id, rejectPending.id);
    await decision(rejectPending.id, sessionA, 'reject', true); assert.equal((await outcome(rejected.index)).blocked, true); await effectCount(0);
    console.log('MCP_EFFECT_FIXTURE:' + JSON.stringify({ event: 'WRONG_PRINCIPAL_AND_REJECT_DENIED', calls: calls.length, effect: false, pendingID: rejectPending.id }));
    const approvedArgs: ToolArgs = { text: 'fixture actual write\n', requestLabel: 'approved' };
    const approved = await start(sessionA, approvedArgs); const approvePending = await pending('approved');
    assert.notEqual(approvePending.id, rejectPending.id); assert.deepEqual(approvePending.action.payload.args, approvedArgs); await effectCount(0);
    await decision(approvePending.id, sessionA, 'approve', true); const receipt = await outcome(approved.index);
    const actualBytes = Buffer.from(approvedArgs.text); await effectCount(1, actualBytes);
    assert.equal(calls[0].valid, true); assert.equal(receipt.rpcId, calls[0].rpcId); assert.equal(receipt.checksum, sha(actualBytes)); assert.equal(receipt.byteLength, actualBytes.length); assert.equal(receipt.content, approvedArgs.text);
    await decision(approvePending.id, sessionA, 'approve', false); await effectCount(1, actualBytes);
    console.log('MCP_EFFECT_FIXTURE:' + JSON.stringify({ event: 'EXACT_PERMISSION_REAL_EFFECT', calls: calls.length, receipt, pendingID: approvePending.id }));
    const changed = await start(sessionA, { text: 'changed content', requestLabel: 'changed' }); const changedPending = await pending('changed');
    assert.notEqual(changedPending.id, approvePending.id); await effectCount(1, actualBytes);
    await decision(changedPending.id, sessionB, 'approve', false); await effectCount(1, actualBytes);
    await decision(changedPending.id, sessionA, 'reject', true); assert.equal((await outcome(changed.index)).blocked, true); await effectCount(1, actualBytes);
    assert.deepEqual(await list(sessionA), []); assert.deepEqual(await list(sessionB), []);
    await Promise.all(outcomes); await Promise.all(requests); assert.deepEqual(serverErrors, []);
    await fs.writeFile('effect-proof.json', JSON.stringify({ calls, receipt, sseCount, discoveryCount, exactBytesBase64: actualBytes.toString('base64') }));
    console.log('MCP_EFFECT_FIXTURE:' + JSON.stringify({ event: 'ASSERTIONS_DONE', calls: calls.length, receipt, changedPendingID: changedPending.id }));
    bodyDone = true;
} finally {
    // No private DB/server hooks. IdentityService offers no public close.
    mcpClient.disconnect('fixture-local');
    const closed = await Promise.allSettled([close(appServer), close(mcpServer)]);
    for (const result of closed) if (result.status === 'rejected') throw result.reason;
    await Promise.all(requests); assert.deepEqual(serverErrors, []);
    if (bodyDone) console.log('MCP_EFFECT_FIXTURE:' + JSON.stringify({ event: 'BODY_DONE', serversClosed: true }));
}
// Natural exit is a separate oracle. No process.exit, console suppression, timeout tuning or fake shutdown.
