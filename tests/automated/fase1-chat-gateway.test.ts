/**
 * FASE 1 (R1): Chat-gateway unification — REAL behavioral tests.
 *
 * Verifies the inference contract:
 * - The provider event names the provider THAT ANSWERED (never the attempted one).
 * - Fallback happens strictly before the first token.
 * - A mid-stream failure never concatenates another model after a partial response.
 * - Empty/silent completions are honest failures, not fake success.
 * - Errors are typed (InferenceError), never delivered as assistant text.
 * - Chat/agents/extraction no longer reach provider SDKs directly.
 *
 * Adapters are injected test doubles at the router boundary (the router is the
 * unit under test); no provider is mocked inside production code.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createAgentInferenceRouter, defaultChain } from '../../services/llm/agentInferenceRouter';
import { InferenceError, capabilitiesFromAgentCapabilities, type InferenceEvent } from '../../services/llm/inference';
import { ProviderRegistry } from '../../services/llm/providerRegistry';
import type { StreamAdapter } from '../../services/llm/streamAdapters';
import { AgentCapability } from '../../types';

function stubAdapter(id: string, opts: {
    available?: boolean;
    chunks?: string[];
    failBeforeToken?: Error;
    failAfterChunks?: Error;
    model?: string;
}): StreamAdapter & { calls: number } {
    const adapter = {
        id,
        calls: 0,
        isAvailable: () => opts.available !== false,
        modelFor: () => opts.model,
        stream: async function* () {
            adapter.calls++;
            if (opts.failBeforeToken) throw opts.failBeforeToken;
            const chunks = opts.chunks ?? [];
            for (let i = 0; i < chunks.length; i++) {
                yield chunks[i];
                if (opts.failAfterChunks && i === chunks.length - 1) throw opts.failAfterChunks;
            }
            if (opts.failAfterChunks && chunks.length === 0) throw opts.failAfterChunks;
        }
    };
    return adapter;
}

async function collect(stream: AsyncGenerator<InferenceEvent>): Promise<InferenceEvent[]> {
    const events: InferenceEvent[] = [];
    for await (const e of stream) events.push(e);
    return events;
}

const baseReq = {
    agentName: 'TestAgent',
    role: 'Tester',
    category: 'CORE',
    task: 'hola'
};

describe('R1: fallback chain order', () => {
    it('keeps ZHIPUAI first (free primary) and OLLAMA last (local survival), registry priority in between', () => {
        const registry = new ProviderRegistry();
        const adapterIds = new Set(['ZHIPUAI', 'GEMINI', 'GROQ', 'OLLAMA', 'NVIDIA', 'OPENROUTER']);
        const chain = defaultChain(registry, adapterIds);
        expect(chain[0]).toBe('ZHIPUAI');
        expect(chain[chain.length - 1]).toBe('OLLAMA');
        // Registry priorities: GEMINI 20 < GROQ 30 < NVIDIA 60 < OPENROUTER 70
        expect(chain.indexOf('GEMINI')).toBeLessThan(chain.indexOf('GROQ'));
        expect(chain.indexOf('GROQ')).toBeLessThan(chain.indexOf('NVIDIA'));
        expect(chain.indexOf('NVIDIA')).toBeLessThan(chain.indexOf('OPENROUTER'));
        // Providers without an adapter never enter the chain
        expect(chain).not.toContain('MINIMAX');
        expect(chain).not.toContain('DEEPSEEK');
    });
});

describe('R1: real provider attribution', () => {
    it('NVIDIA-only key: conversation streams natively and the provider event names NVIDIA', async () => {
        const router = createAgentInferenceRouter({
            adapters: [
                stubAdapter('ZHIPUAI', { available: false }),
                stubAdapter('GEMINI', { available: false }),
                stubAdapter('NVIDIA', { chunks: ['Hola', ' mundo'], model: 'nvidia/nemotron-3.5-lightning-30b-a3b' }),
                stubAdapter('OLLAMA', { available: false })
            ],
            chain: ['ZHIPUAI', 'GEMINI', 'NVIDIA', 'OLLAMA']
        });

        const events = await collect(router.stream({ ...baseReq }));

        const providerEvents = events.filter(e => e.type === 'provider');
        expect(providerEvents).toHaveLength(1);
        expect(providerEvents[0]).toMatchObject({ type: 'provider', provider: 'NVIDIA', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' });
        // Provider event arrives before the first text
        expect(events[0].type).toBe('provider');
        expect(events.filter(e => e.type === 'text').map(e => (e as any).text).join('')).toBe('Hola mundo');
    });

    it('pre-token failure falls back and reports the ANSWERING provider, not the attempted one', async () => {
        const zhipu = stubAdapter('ZHIPUAI', { failBeforeToken: new Error('connection refused') });
        const gemini = stubAdapter('GEMINI', { chunks: ['respuesta real'] });
        const router = createAgentInferenceRouter({
            adapters: [zhipu, gemini, stubAdapter('OLLAMA', { available: false })],
            chain: ['ZHIPUAI', 'GEMINI', 'OLLAMA']
        });

        const events = await collect(router.stream({ ...baseReq }));

        expect(zhipu.calls).toBe(1);
        expect(gemini.calls).toBe(1);
        expect(events[0]).toMatchObject({ type: 'provider', provider: 'GEMINI' });
        expect(events.filter(e => e.type === 'provider')).toHaveLength(1);
        expect(events.filter(e => e.type === 'text').map(e => (e as any).text).join('')).toBe('respuesta real');
    });

    it('preferredProvider is attempted first, fallback order preserved after it', async () => {
        const gemini = stubAdapter('GEMINI', { chunks: ['gemini'] });
        const nvidia = stubAdapter('NVIDIA', { chunks: ['nvidia'] });
        const router = createAgentInferenceRouter({
            adapters: [gemini, nvidia],
            chain: ['GEMINI', 'NVIDIA']
        });
        const events = await collect(router.stream({ ...baseReq, preferredProvider: 'NVIDIA' }));
        expect(nvidia.calls).toBe(1);
        expect(gemini.calls).toBe(0);
        expect(events[0]).toMatchObject({ type: 'provider', provider: 'NVIDIA' });
    });
});

describe('R1: never concatenate another model after a partial response', () => {
    it('mid-stream failure aborts with a typed error; no other provider emits', async () => {
        const gemini = stubAdapter('GEMINI', { chunks: ['parcial'], failAfterChunks: new Error('socket closed') });
        const ollama = stubAdapter('OLLAMA', { chunks: ['RESPUESTA-DE-OTRO-MODELO'] });
        const router = createAgentInferenceRouter({
            adapters: [gemini, ollama],
            chain: ['GEMINI', 'OLLAMA']
        });

        const events: InferenceEvent[] = [];
        let caught: any = null;
        try {
            for await (const e of router.stream({ ...baseReq })) events.push(e);
        } catch (e: any) { caught = e; }

        expect(caught).toBeInstanceOf(InferenceError);
        expect(caught.kind).toBe('mid-stream');
        expect(caught.provider).toBe('GEMINI');
        expect(ollama.calls).toBe(0); // never attempted after a partial response
        const texts = events.filter(e => e.type === 'text').map(e => (e as any).text);
        expect(texts).toEqual(['parcial']); // no concatenation
    });

    it('silent empty completion is an honest failure, not a fake success', async () => {
        const empty = stubAdapter('GEMINI', { chunks: [] });
        const real = stubAdapter('NVIDIA', { chunks: ['contenido'] });
        const router = createAgentInferenceRouter({
            adapters: [empty, real],
            chain: ['GEMINI', 'NVIDIA']
        });
        const events = await collect(router.stream({ ...baseReq }));
        expect(empty.calls).toBe(1);
        expect(events[0]).toMatchObject({ type: 'provider', provider: 'NVIDIA' });
        expect(events.filter(e => e.type === 'text').map(e => (e as any).text).join('')).toBe('contenido');
    });

    it('total failure throws a typed InferenceError, never assistant-shaped error text', async () => {
        const router = createAgentInferenceRouter({
            adapters: [
                stubAdapter('ZHIPUAI', { available: false }),
                stubAdapter('GEMINI', { failBeforeToken: new Error('HTTP 500') })
            ],
            chain: ['ZHIPUAI', 'GEMINI']
        });
        let caught: any = null;
        try { await collect(router.stream({ ...baseReq })); } catch (e: any) { caught = e; }
        expect(caught).toBeInstanceOf(InferenceError);
        expect(caught.kind).toBe('unavailable');
        expect(caught.message).toContain('GEMINI');
    });
});

describe('R1: capability mapping preserved', () => {
    it('maps legacy AgentCapability flags onto the inference contract', () => {
        const caps = capabilitiesFromAgentCapabilities([
            AgentCapability.TOOL_WEB_SEARCH,
            AgentCapability.TOOL_CODE_EXECUTION,
            AgentCapability.TOOL_IMAGE_GENERATION,
            AgentCapability.TOOL_MEMORY_WRITE,
            AgentCapability.RESEARCH
        ]);
        expect(caps).toEqual({ webSearch: true, codeExecution: true, imageGeneration: true, memoryWrite: true });
        expect(capabilitiesFromAgentCapabilities([])).toEqual({ webSearch: false, codeExecution: false, imageGeneration: false, memoryWrite: false });
    });
});

describe('R1: consumers go through the gateway (source contract)', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');

    it('chatController streams via the inference router and reports the answering provider', () => {
        const src = read('server/controllers/chatController.ts');
        expect(src).toContain('agentInferenceRouter.stream(');
        expect(src).not.toContain('geminiService.generateAgentResponseStream');
        // No more "attempted provider" guessing
        expect(src).not.toContain("providerHealth.isAvailable('gemini') ? 'gemini'");
    });

    it('agentStream streams via the inference router', () => {
        const src = read('services/agentStream.ts');
        expect(src).toContain('agentInferenceRouter.stream(');
        expect(src).not.toContain('generateAgentResponseStream');
    });

    it('fact extraction uses the unified chain instead of provider-specific fallbacks', () => {
        const src = read('services/factExtractor.ts');
        expect(src).toContain('agentInferenceRouter.completeText(');
        expect(src).not.toContain('geminiService');
    });

    it('no provider transport URLs/models remain hardcoded in the chat path', () => {
        const geminiSrc = read('services/geminiService.ts');
        // The dedicated chat/agent fallback chain is gone; the legacy stream entry
        // point delegates to the router. (generateText keeps its legacy chain for
        // ~30 non-chat internal consumers; their migration is follow-up work.)
        expect(geminiSrc).not.toContain('runUniversalFallback');
        expect(geminiSrc).toContain('agentInferenceRouter.stream(');
        const gatewaySrc = read('services/llmGateway.ts');
        expect(gatewaySrc).not.toContain('callGroqDirect');
        expect(gatewaySrc).not.toContain('https://api.groq.com');
    });

    it('the gateway GEMINI adapter uses the pure transport (attribution-safe)', () => {
        const gatewaySrc = read('services/llmGateway.ts');
        expect(gatewaySrc).toContain('generateGeminiTextPure');
        expect(gatewaySrc).not.toContain('geminiService.generateText');
    });
});
