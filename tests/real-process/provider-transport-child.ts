/** Actual local HTTP transport and process-start OFF denial. No mocked fetch,
 * real provider, credentials or payment. Must run inside network isolation. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { OpenAICompatibleClient } from '../../services/llm/openAICompatible';
import { externalProvidersDisabled } from '../../services/security/bootMode';
let calls = 0;
const receiver = http.createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, 'Bearer fixture-only-not-a-real-key');
    assert.equal(req.url, '/v1/chat/completions');
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'local fixture response' }, finish_reason: 'stop' }], model: 'fixture' }));
});
receiver.listen(0, '127.0.0.1');
await once(receiver, 'listening');
try {
    const port = (receiver.address() as { port: number }).port;
    const provider = { id: 'LOCAL_FIXTURE', transport: 'openai-compatible' as const, model: 'fixture', apiKeyEnv: 'EXPLICIT_FIXTURE_KEY', baseUrl: `http://127.0.0.1:${port}/v1` };
    const client = new OpenAICompatibleClient({ EXPLICIT_FIXTURE_KEY: 'fixture-only-not-a-real-key' });
    if (externalProvidersDisabled()) {
        assert.equal(client.configured(provider), false);
        await assert.rejects(() => client.complete(provider, [{ role: 'user', content: 'fixture' }]), /credential not configured/);
        assert.equal(calls, 0);
    } else {
        assert.equal(client.configured(provider), true);
        const result = await client.complete(provider, [{ role: 'user', content: 'fixture' }]);
        assert.equal(result.text, 'local fixture response');
        assert.equal(calls, 1);
    }
    console.log(JSON.stringify({ mode: externalProvidersDisabled() ? 'providers-off' : 'providers-on', actual_loopback_requests: calls, mocked_fetch: false, real_provider_or_charge: false }));
} finally {
    receiver.closeAllConnections();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
}
