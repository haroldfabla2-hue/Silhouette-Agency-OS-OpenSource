import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OpenAICompatibleClient } from '../../services/llm/openAICompatible';
import { ProviderRegistry, type ProviderDefinition } from '../../services/llm/providerRegistry';
import { LLMGatewayService } from '../../services/llmGateway';
let server: Server, provider: ProviderDefinition, client: OpenAICompatibleClient;
let requests: { path: string; body: any; auth?: string }[], mode: string;
beforeEach(async () => {
    requests = []; mode = 'ok';
    server = createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({ path: req.url!, body, auth: req.headers.authorization });
        if (mode === 'timeout') return;
        if (mode === 'error') { res.writeHead(429); res.end('private body secret-test'); return; }
        if (req.url === '/v1/models') {
            if (mode === 'unsupported') { res.writeHead(404); res.end(); return; }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: [{ id: 'new-model-2026' }, { id: 'new-model-2026' }, { id: 'another' }] })); return;
        }
        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            const payload = ': keepalive\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: { content: 'héllo' } }] }) + '\r\n\r\n';
            // Split bytes and event boundaries across actual network writes.
            const bytes = Buffer.from(payload);
            for (let i = 0; i < bytes.length; i++) res.write(bytes.subarray(i, i + 1));
            if (mode === 'truncated') { res.end(); return; }
            if (mode === 'toolstream') res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] } }] }) + '\n\n');
            res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); return;
        }
        res.setHeader('Content-Type', 'application/json');
        if (mode === 'malformed') { res.end('{'); return; }
        const message = mode === 'tool' ? { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"LICENSE"}' } }] } : { content: 'hello' };
        res.end(JSON.stringify({ model: body.model, choices: [{ message, finish_reason: mode === 'tool' ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    provider = { id: 'TEST', transport: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: 'TEST_KEY', model: 'configured', discovery: true, priority: 1 };
    client = new OpenAICompatibleClient({ TEST_KEY: 'secret-test' });
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const messages = [{ role: 'user' as const, content: 'public generic test' }];
describe('configurable OpenAI-compatible HTTP transport', () => {
    it('sends real HTTP auth/model/options and normalizes usage', async () => {
        const result = await client.complete(provider, messages, { model: 'brand-new-id', temperature: 0, maxTokens: 9 });
        expect(result).toMatchObject({ text: 'hello', model: 'brand-new-id', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } });
        expect(requests[0]).toMatchObject({ path: '/v1/chat/completions', auth: 'Bearer secret-test', body: { model: 'brand-new-id', max_tokens: 9, temperature: 0, stream: false, messages } });
    });
    it('supports per-model parameter/role profiles without code changes', async () => {
        provider.profiles = { reasoning: { tokenParameter: 'max_completion_tokens', omitTemperature: true, systemRole: 'developer' } };
        await client.complete(provider, [{ role: 'system', content: 'generic' }, ...messages], { model: 'reasoning', maxTokens: 8, temperature: 1 });
        expect(requests[0].body.max_completion_tokens).toBe(8); expect(requests[0].body.temperature).toBeUndefined(); expect(requests[0].body.messages[0].role).toBe('developer');
    });
    it('returns structured tool calls and preserves tool response messages', async () => {
        mode = 'tool';
        const result = await client.complete(provider, [...messages, { role: 'tool', content: 'MIT', tool_call_id: 'earlier' }], { tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }], toolChoice: 'required' });
        expect(result.toolCalls[0].function.name).toBe('read_file'); expect(requests[0].body.tool_choice).toBe('required'); expect(requests[0].body.messages[1].tool_call_id).toBe('earlier');
    });
    it('discovers/deduplicates unseen IDs, caches and refreshes without inventing capabilities', async () => {
        expect(await client.discover(provider)).toEqual({ ids: ['new-model-2026', 'another'], source: 'remote', capabilities: 'unknown' });
        await client.discover(provider); expect(requests.length).toBe(1); await client.discover(provider, true); expect(requests.length).toBe(2);
    });
    it('degrades gracefully on missing /models but still completes configured model', async () => {
        mode = 'unsupported'; expect(await client.discover(provider)).toMatchObject({ ids: ['configured'], source: 'configured', error: expect.any(String) });
        expect((await client.complete(provider, messages)).text).toBe('hello');
    });
    it('never automatically changes selected model after discovery', async () => {
        await client.discover(provider); await client.complete(provider, messages); expect(requests[1].body.model).toBe('configured');
    });
    it('streams real SSE including unicode, CRLF and tool deltas', async () => {
        mode = 'toolstream'; const events = []; for await (const event of client.stream(provider, messages)) events.push(event);
        expect(events).toContainEqual({ type: 'text', text: 'héllo' }); expect(events.some(e => e.type === 'tool')).toBe(true); expect(events.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
    });
    it('fails explicitly on truncated SSE', async () => {
        mode = 'truncated'; await expect(async () => { for await (const _ of client.stream(provider, messages)) { /* consume */ } }).rejects.toThrow('truncated');
    });
    it('redacts vendor response bodies in errors', async () => {
        mode = 'error'; await expect(client.complete(provider, messages)).rejects.toThrow('HTTP 429');
        try { await client.complete(provider, messages); } catch (e) { expect(String(e)).not.toContain('secret-test'); }
    });
    it('rejects malformed responses', async () => { mode = 'malformed'; await expect(client.complete(provider, messages)).rejects.toThrow(); });
    it('enforces request deadlines', async () => { mode = 'timeout'; await expect(client.complete(provider, messages, { timeout: 30 })).rejects.toThrow(); });
    it('requires configured key and does not send unauthorized requests', async () => {
        await expect(new OpenAICompatibleClient({}).complete(provider, messages)).rejects.toThrow('credential not configured'); expect(requests).toHaveLength(0);
    });
    it('registers new providers as data and routes gateway complete/chat/stream', async () => {
        const registry = new ProviderRegistry([]); registry.register(provider);
        const gateway = new LLMGatewayService(registry, client);
        expect((await gateway.complete('generic', { preferredProvider: 'TEST' })).text).toBe('hello');
        mode = 'tool'; expect((await gateway.chat('TEST', messages)).toolCalls).toHaveLength(1);
        mode = 'ok'; let output = ''; for await (const text of gateway.stream('generic')) output += text; expect(output).toBe('héllo');
        expect(gateway.getProviderHealth().TEST.totalCalls).toBe(2);
    });
    it('does not splice fallback text after a stream has emitted output', async () => {
        const second = { ...provider, id: 'SECOND', priority: 2 };
        const gateway = new LLMGatewayService(new ProviderRegistry([provider, second]), client); mode = 'truncated';
        await expect(async () => { for await (const _ of gateway.stream('generic')) { /* consume */ } }).rejects.toThrow('truncated'); expect(requests.filter(r => r.path.endsWith('/chat/completions'))).toHaveLength(1);
    });
    it('rejects tools in text APIs before sending or falling back', async () => {
        const gateway = new LLMGatewayService(new ProviderRegistry([provider]), client);
        const tools = [{ type: 'function' as const, function: { name: 'read_file', parameters: {} } }];
        await expect(gateway.complete('generic', { tools })).rejects.toThrow('structured tools');
        await expect(async () => { for await (const _ of gateway.stream('generic', { tools })) { /* consume */ } }).rejects.toThrow('structured tools');
        expect(requests).toHaveLength(0);
    });
    it('honors external cancellation', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(client.complete(provider, messages, { signal: controller.signal })).rejects.toThrow();
        expect(requests).toHaveLength(0);
    });
    it('records real failures and opens/reset circuits', async () => {
        const gateway = new LLMGatewayService(new ProviderRegistry([provider]), client); mode = 'error';
        for (let i = 0; i < 3; i++) await expect(gateway.complete('generic')).rejects.toThrow('All LLM providers failed');
        expect(gateway.getProviderHealth().TEST.circuitOpen).toBe(true);
        mode = 'ok'; gateway.resetCircuit('TEST'); expect((await gateway.complete('generic')).text).toBe('hello');
    });
    it('retains legacy provider order and rejects overwriting native paths', () => {
        const registry = new ProviderRegistry(); expect(registry.order().slice(0, 5)).toEqual(['MINIMAX', 'GEMINI', 'GROQ', 'DEEPSEEK', 'OLLAMA']);
        expect(() => registry.register({ ...provider, id: 'GEMINI' })).toThrow('Cannot replace'); expect(registry.get('ZHIPUAI')).toBeDefined();
    });
});
