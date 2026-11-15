/** Proposed actual-service child. NOT EXECUTED under design-only admission.
 * Requires outer no-egress sandbox. No mocks, credentials, planner or patch.
 * Natural return only; a supervisor timeout/kill invalidates this phase. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import http from 'node:http';

const phase = process.argv[2];
assert.ok(['seed', 'valid', 'unavailable'].includes(phase));
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance');
assert.ok(process.env.SELFDEV_DIR);
const dir = process.env.SELFDEV_DIR!;
const snapshot = path.join(dir, 'cycles.json');
const digest = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const { selfDevCycleService: service } = await import('../../services/selfdev/cycleService');
const { default: router } = await import('../../server/routes/v1/selfdev.routes');
const app = express(); app.use(express.json()); app.use('/v1/self/dev', router);
// Short private path stays below Unix socket path length on the deep runner root.
const socketPath = path.join(dir, 'a.sock');
const server = app.listen(socketPath); await once(server, 'listening');
function request(method: 'GET' | 'POST', payload?: object): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const body = payload ? JSON.stringify(payload) : undefined;
        const req = http.request({ socketPath, path: '/v1/self/dev/cycles', method, headers: { Connection: 'close',
            ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, response => {
            let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
            response.on('end', () => { try { resolve({ status: response.statusCode!, body: JSON.parse(text) }); } catch (error) { reject(error); } });
            response.on('error', reject);
        });
        req.on('error', reject); req.end(body);
    });
}
try {
    assert.equal(server.address(), socketPath);
    if (phase === 'seed') {
        const done = service.create({ issue: 'Preserve completed operator history', scope: ['src'], acceptance: { kind: 'vitest', target: 'tests/history.test.ts' } });
        service.abandon(done.id, 'Authored continuity fixture, no execution');
        const active = service.create({ issue: 'Preserve active ordinary task', scope: ['src'], acceptance: { kind: 'vitest', target: 'tests/active.test.ts' } });
        assert.equal(active.state, 'PLANNED');
        fs.writeFileSync(path.resolve('expected-cycles.json'), fs.readFileSync(snapshot));
    } else if (phase === 'valid') {
        const original = fs.readFileSync(path.resolve('expected-cycles.json'));
        assert.deepEqual(fs.readFileSync(snapshot), original);
        const stored = JSON.parse(original.toString());
        assert.deepEqual(service.list().map(c => c.id), stored.cycles.map((c: { id: string }) => c.id));
        for (const c of stored.cycles) assert.deepEqual(service.refresh(c.id), c);
        assert.throws(() => service.create({ issue: 'Must not replace active task', scope: ['src'], acceptance: { kind: 'vitest', target: 'tests/new.test.ts' } }), /already active/);
        assert.deepEqual(fs.readFileSync(snapshot), original);
    } else {
        assert.throws(() => service.list(), (e: unknown) => (e as { statusCode?: number }).statusCode === 503);
        assert.throws(() => service.create({ issue: 'Must not forget prior work', scope: ['src'], acceptance: { kind: 'vitest', target: 'tests/new.test.ts' } }), /SELFDEV_CONTINUITY_UNKNOWN/);
        const post = await request('POST', { issue: 'HTTP admission stays closed', scope: ['src'], acceptance: { kind: 'vitest', target: 'tests/new.test.ts' } });
        assert.equal(post.status, 503); assert.equal(post.body.success, false); assert.match(post.body.error, /SELFDEV_CONTINUITY_UNKNOWN/);
    }
    const response = await request('GET');
    assert.equal(response.status, phase === 'unavailable' ? 503 : 200);
    const body = response.body; assert.equal(body.success, phase !== 'unavailable');
    if (phase === 'unavailable') { assert.equal('cycles' in body, false); assert.match(body.error, /SELFDEV_CONTINUITY_UNKNOWN/); }
    else assert.equal(body.cycles.length, 2);
    console.log(JSON.stringify({ phase, fullService: true, actualRouter: true, httpTransport: 'AF_UNIX', httpStatus: response.status,
        snapshotSha256: fs.existsSync(snapshot) ? digest(snapshot) : null,
        providerMode: 'off', plannerInvoked: false, patchExecuted: false, applied: false,
        childAcceptanceProvisionalUntilNaturalExitAndOuterCleanup: true }));
} finally {
    const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
// No process.exit. Natural exit and all descendants/cleanup remain outer gates.
