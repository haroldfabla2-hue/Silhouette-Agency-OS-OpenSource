import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '../../services/llm/providerRegistry';
import { OpenAICompatibleClient } from '../../services/llm/openAICompatible';

const SRC = readFileSync(join(__dirname, '../../services/geminiService.ts'), 'utf8');

describe('cloud fallback chain - NVIDIA NIM leg', () => {
    it('orders the legs gemini-bg -> groq -> nvidia -> openrouter', () => {
        const g = SRC.indexOf('✅ Gemini background model responded');
        const q = SRC.indexOf('✅ Groq responded');
        const n = SRC.indexOf('✅ NVIDIA NIM responded');
        const o = SRC.indexOf('✅ OpenRouter responded');
        expect(g).toBeGreaterThan(-1);
        expect(q).toBeGreaterThan(g);
        expect(n).toBeGreaterThan(q);
        expect(o).toBeGreaterThan(n);
    });

    it('skips the NVIDIA leg without NVIDIA_API_KEY, guarded by the circuit breaker', () => {
        expect(SRC).toContain("process.env.NVIDIA_API_KEY?.trim() && providerHealth.isAvailable('nvidia')");
        expect(SRC).toContain("'nvidia: no key'");
        expect(SRC).toContain("'nvidia: circuit open'");
        expect(SRC).toContain("reportFailure('nvidia'");
    });
});

describe('NVIDIA NIM transport (OpenAICompatibleClient, stubbed fetch)', () => {
    const definition = ProviderRegistry.fromEnvironment().get('NVIDIA')!;

    it('is registered as an openai-compatible provider keyed by NVIDIA_API_KEY', () => {
        expect(definition).toBeDefined();
        expect(definition.transport).toBe('openai-compatible');
        expect(definition.apiKeyEnv).toBe('NVIDIA_API_KEY');
        expect(definition.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    });

    it('complete() returns the model text and honors NVIDIA_MODEL override', async () => {
        const calls: any[] = [];
        const fetcher = async (url: any, init: any) => {
            calls.push({ url: String(url), body: JSON.parse(init.body) });
            return new Response(JSON.stringify({
                model: 'nvidia/test-model',
                choices: [{ message: { role: 'assistant', content: 'nv-ok' }, finish_reason: 'stop' }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        const client = new OpenAICompatibleClient({ NVIDIA_API_KEY: 'k', NVIDIA_MODEL: 'nvidia/test-model' } as any, fetcher as any);
        const result = await client.complete(definition, [{ role: 'user', content: 'hi' }], { maxTokens: 32 });
        expect(result.text).toBe('nv-ok');
        expect(calls[0].url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
        expect(calls[0].body.model).toBe('nvidia/test-model');
    });

    it('throws on empty content so the chain moves to the next leg', async () => {
        const fetcher = async () => new Response(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'length' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        const client = new OpenAICompatibleClient({ NVIDIA_API_KEY: 'k' } as any, fetcher as any);
        await expect(client.complete(definition, [{ role: 'user', content: 'hi' }], {})).rejects.toThrow('empty response');
    });

    it('is not configured without a key', () => {
        const client = new OpenAICompatibleClient({} as any, (async () => { throw new Error('no fetch'); }) as any);
        expect(client.configured(definition)).toBe(false);
    });
});
