import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { Ollama } from 'ollama';
import { OllamaService } from '../../services/ollamaService';

// HTTP protocol fixture only. No model, queue, Redis or provider is started.
const mode = process.argv[2];
assert.equal(mode, 'listing');
const failures: unknown[] = [];
let listener: http.Server | undefined;
let payload: unknown = null;
const requests: string[] = [];
async function bounded<T>(label: string, promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Local deadline: ${label}`)), 1500);
        })]);
    } finally { if (timer) clearTimeout(timer); }
}
try {
    // Mixed permits the health transport only in this isolated fixture. It is
    // not permission for local inference; no generation API is called here.
    process.env.SILHOUETTE_INFERENCE_MODE = 'mixed';
    listener = http.createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);
        res.writeHead(req.method === 'GET' && req.url === '/api/tags' ? 200 : 404,
            { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    });
    const server = listener;
    await bounded('listen', new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    }));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    // Genuine SDK+fetch HTTP. Signal is owned by this test, not a production
    // timeout change and not a replacement response or module mock.
    const client = new Ollama({ host: `http://127.0.0.1:${address.port}`,
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(1000) }) });
    const service = new OllamaService(client);
    for (const malformed of [null, {}, { models: null }, { models: {} }, { models: 'not-array' }]) {
        payload = malformed;
        assert.equal(await bounded('malformed listing', service.checkStatus()), false);
    }
    payload = { models: [] };
    assert.equal(await bounded('reachable listing', service.checkStatus()), true);
    assert.deepEqual(requests, Array(6).fill('GET /api/tags'));
    // Listener is still live: count must not change under policy denial.
    process.env.SILHOUETTE_INFERENCE_MODE = 'cloud-only';
    assert.equal(await bounded('policy denial', service.checkStatus()), false);
    assert.equal(requests.length, 6);
    process.env.SILHOUETTE_INFERENCE_MODE = 'mixed';
    await bounded('close before network error', new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    }));
    assert.equal(await bounded('network error', service.checkStatus()), false);

} catch (error) { failures.push(error); }
finally {
    try {
        if (listener?.listening) {
            const server = listener;
            await bounded('cleanup close', new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
            }));
        } else listener?.closeAllConnections();
    } catch (error) { failures.push(error); }
}
if (failures.length) { console.error(new AggregateError(failures, 'Listing contract failed including cleanup')); process.exitCode = 1; }
else fs.writeFileSync('receipt.json', JSON.stringify({ mode, passed: true, cleanup: true }));
// Natural exit required by the parent. No force-exit-to-success.
