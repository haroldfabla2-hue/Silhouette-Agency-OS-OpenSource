/** Proposed genuine composed identity/key/parser/SDK tests. NOT RUN.
 * Outer no-egress admission required. Authored keys are disposable, never output.
 * No mocks, provider modules, network TCP, production app boot or private state. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import express from 'express';

assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance');
assert.ok(process.env.SILHOUETTE_DB_PATH?.startsWith(process.cwd() + path.sep));
// No real credential: process-local authored test token.
const master = crypto.randomBytes(32).toString('hex');
process.env.SILHOUETTE_API_KEY = master;
const { authMiddleware, resetTokenCache } = await import('../../server/middleware/authMiddleware');
const { MCPWrapper, MCP_LIMITS } = await import('../../server/mcp/mcpServer');
const { apiKeyService } = await import('../../services/apiKeyService');
const { sqliteService } = await import('../../services/sqliteService');
resetTokenCache();
const a = apiKeyService.createApiKey({ name: 'authored-A', permissions: ['tools:read', 'tools:execute'] }, 'test-owner');
const b = apiKeyService.createApiKey({ name: 'authored-B', permissions: ['tools:read', 'tools:execute'] }, 'test-owner');
const wrapper = new MCPWrapper();
const app = express();
// Same ordering as production app: MCP excluded from general parser, unchanged
// identity middleware, synchronous wrapper mount, then terminal404.
const general = express.json({ limit: '10mb' });
app.use((req, res, next) => {
    const pathname = req.path.toLowerCase();
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) next();
    else general(req, res, next);
});
app.use(authMiddleware); wrapper.mount(app);
app.use((_req, res) => { res.status(404).json({ error: 'terminal fallback' }); });
const socketPath = path.resolve('m.sock');
const server = app.listen(socketPath); await once(server, 'listening');
const streams: Array<{ endpoint: string; messages: any[]; response: http.IncomingMessage; request: http.ClientRequest }> = [];
const headers = (key: string) => ({ Authorization: `Bearer ${master}`, 'x-mcp-api-key': key, Connection: 'close' });
function request(url: string, key: string | null, body?: string, extra: Record<string, string> = {}, useMaster = true): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ socketPath, path: url, method: body === undefined ? 'GET' : 'POST', headers: {
            ...(key ? headers(key) : {}), ...(!useMaster ? { Authorization: `Bearer ${key}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...extra
        } }, res => {
            let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode!, text })); res.on('error', reject);
        }); req.on('error', reject); req.end(body);
    });
}
async function open(key: string, extra: Record<string, string> = {}) {
    return new Promise<(typeof streams)[number]>((resolve, reject) => {
        const request = http.get({ socketPath, path: '/mcp/sse', headers: { ...headers(key), ...extra } }, response => {
            if (response.statusCode !== 200) { response.resume(); reject(new Error(`SSE ${response.statusCode}`)); return; }
            let buffer = ''; const item = { endpoint: '', messages: [] as any[], response, request };
            streams.push(item); response.setEncoding('utf8');
            response.on('data', chunk => {
                buffer += chunk;
                while (buffer.includes('\n\n')) {
                    const pos = buffer.indexOf('\n\n'); const frame = buffer.slice(0, pos); buffer = buffer.slice(pos + 2);
                    const data = frame.split('\n').find(l => l.startsWith('data: '))?.slice(6);
                    if (frame.startsWith('event: endpoint') && data) { item.endpoint = data; resolve(item); }
                    else if (frame.startsWith('event: message') && data) item.messages.push(JSON.parse(data));
                }
            }); response.on('error', reject);
        }); request.on('error', reject);
    });
}
async function until(predicate: () => boolean, ms = 3000) {
    const deadline = Date.now() + ms;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'deadline exceeded'); await new Promise(r => setTimeout(r, 10)); }
}
async function post(stream: (typeof streams)[number], key: string, id: number, method = 'ping', params?: object) {
    const reply = await request(stream.endpoint, key, JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }));
    assert.equal(reply.status, 202, reply.text); await until(() => stream.messages.some(m => m.id === id));
    return stream.messages.find(m => m.id === id);
}
try {
    assert.equal((await request('/mcp/sse', null)).status, 401);
    assert.equal((await request('/mcp/sse', a.key, undefined, {}, false)).status, 403, 'managed key alone does not bypass outer auth');
    assert.equal((await request('/mcp/sse', 'invalid-authored-key')).status, 403);
    const sa = await open(a.key), sb = await open(b.key);
    assert.notEqual(sa.endpoint, sb.endpoint);
    // Authored real identity rows, read by actual identityService, not a stub.
    const now = Date.now();
    sqliteService.db.prepare('INSERT INTO users (id,email,name,role,created_at,last_login) VALUES (?,?,?,?,?,?)')
        .run('authored-user', 'fixture@example.invalid', 'Fixture', 'USER', now, now);
    sqliteService.db.prepare('INSERT INTO devices (id,user_id,fingerprint,name,trusted,last_seen,created_at) VALUES (?,?,?,?,?,?,?)')
        .run('authored-device', 'authored-user', 'fixture', 'Fixture', 1, now, now);
    sqliteService.db.prepare('INSERT INTO sessions (id,user_id,device_id,expires_at,created_at) VALUES (?,?,?,?,?)')
        .run('authored-login', 'authored-user', 'authored-device', now + 60_000, now);
    const sc = await open(a.key, { Authorization: `Bearer ${a.key}`, 'x-session-id': 'authored-login' });
    assert.equal((await request(sc.endpoint, a.key, '{}')).status, 404, 'same key cannot cross identity boundary');
    const own = await request(sc.endpoint, a.key, '{"jsonrpc":"2.0","id":20,"method":"ping"}', { Authorization: `Bearer ${a.key}`, 'x-session-id': 'authored-login' });
    assert.equal(own.status, 202); await until(() => sc.messages.some(m => m.id === 20));
    sc.request.destroy(); sc.response.destroy(); await new Promise(r => setTimeout(r, 30));
    const init = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'authored', version: '1' } };
    assert.ok((await post(sa, a.key, 1, 'initialize', init)).result);
    assert.ok((await post(sb, b.key, 2, 'initialize', init)).result);
    await post(sa, a.key, 3); assert.equal(sb.messages.some(m => m.id === 3), false);
    await post(sb, b.key, 4); assert.equal(sa.messages.some(m => m.id === 4), false);
    assert.equal((await request(sa.endpoint, b.key, '{"jsonrpc":"2.0","id":5,"method":"ping"}')).status, 404);
    assert.equal((await request('/mcp/messages', a.key, '{}')).status, 404);
    assert.equal((await request('/mcp/messages?sessionId=missing', a.key, '{}')).status, 404);
    assert.equal((await request(sa.endpoint + '&sessionId=duplicate', a.key, '{}')).status, 404);
    assert.equal((await request(sa.endpoint, a.key, '{broken')).status, 400);
    assert.equal((await request(sa.endpoint, a.key, '[]')).status, 400);
    assert.equal((await request(sa.endpoint, a.key, JSON.stringify({ padding: 'x'.repeat(MCP_LIMITS.bodyBytes) }))).status, 413);
    assert.equal((await request(sa.endpoint, a.key, JSON.stringify({ many: Array(5000).fill(0) }))).status, 400);
    assert.equal((await request(sa.endpoint, a.key, '{}', { 'Content-Encoding': 'gzip' })).status, 415);
    await post(sa, a.key, 6); // malformed/limited bodies do not poison connection.
    // Explicit empty tools/list, never advertise excluded internal tools.
    assert.deepEqual((await post(sa, a.key, 7, 'tools/list')).result.tools, []);
    assert.ok((await post(sa, a.key, 9, 'tools/call', { name: 'shell', arguments: {} })).error);
    assert.equal((await request(sa.endpoint.replace('/mcp/', '/MCP/'), a.key, JSON.stringify({ padding: 'x'.repeat(MCP_LIMITS.bodyBytes) }))).status, 413);
    await open(a.key); await open(a.key); await open(a.key);
    assert.equal((await request('/mcp/sse', a.key)).status, 503, 'four sessions per key, no eviction');
    apiKeyService.revokeKey(a.id);
    assert.equal((await request(sa.endpoint, a.key, '{}')).status, 403);
    await until(() => sa.response.destroyed); assert.equal(sb.response.destroyed, false);
    await post(sb, b.key, 8);
    const capacityStreams: (typeof streams)[number][] = [];
    for (let n = 0; n < 8; n++) {
        const key = apiKeyService.createApiKey({ name: `capacity-${n}`, permissions: ['tools:read', 'tools:execute'] }, 'test-owner');
        for (let j = 0; j < (n === 7 ? 3 : 4); j++) capacityStreams.push(await open(key.key));
        if (n === 7) assert.equal((await request('/mcp/sse', key.key)).status, 503, '32 total, no oldest-client eviction');
    }
    assert.equal(sb.response.destroyed, false);
    for (const stream of capacityStreams) { stream.request.destroy(); stream.response.destroy(); }
    await new Promise(r => setTimeout(r, 30));
    const expiring = apiKeyService.createApiKey({ name: 'expiring', permissions: ['tools:read'] }, 'test-owner');
    const keys = sqliteService.getConfig('mcp_api_keys');
    keys.find((k: { id: string }) => k.id === expiring.id).expiresAt = Date.now() + 200;
    sqliteService.setConfig('mcp_api_keys', keys);
    const expiringStream = await open(expiring.key); await until(() => expiringStream.response.destroyed);
    assert.equal((await request('/mcp/sse', expiring.key)).status, 403);
    // Missing store => no valid key; malformed store =>503 and all streams close.
    const saved = sqliteService.getConfig('mcp_api_keys');
    sqliteService.setConfig('mcp_api_keys', { corrupt: true });
    assert.equal((await request('/mcp/sse', b.key)).status, 503);
    await until(() => sb.response.destroyed);
    sqliteService.setConfig('mcp_api_keys', saved);
    const last = await open(b.key); await wrapper.close(); await until(() => last.response.destroyed);
    assert.equal((await request('/mcp/sse', b.key)).status, 503);
    console.log(JSON.stringify({ actualAuth: true, actualKeyStore: true, actualSdk: true,
        composedBoundary: true, fullApplicationBoot: false, transport: 'AF_UNIX',
        disposableSqliteWrites: true, providerCalls: 0, executedTools: 0,
        provisionalUntilNaturalExitAndOuterCleanup: true }));
} finally {
    await wrapper.close();
    for (const s of streams) { s.request.destroy(); s.response.destroy(); }
    const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
    sqliteService.close();
    // Identity's private SQLite connection closes on natural process exit.
    // Parent removes authored DB/WAL/SHM/socket directory AFTER natural exit.
    assert.equal(fs.existsSync(process.env.SILHOUETTE_DB_PATH!), true);
}
