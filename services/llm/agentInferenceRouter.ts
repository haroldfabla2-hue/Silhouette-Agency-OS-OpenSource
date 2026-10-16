/**
 * AGENT INFERENCE ROUTER (R1: chat-gateway unification)
 *
 * The single entry point for conversational/agent inference. Owns ALL
 * fallback policy; adapters own transports; neither leaks into the other.
 *
 * Guarantees:
 * - Provider attribution is real: the `provider` event names the provider
 *   THAT ANSWERED, emitted only when its first token/completion arrives.
 * - Fallback happens strictly BEFORE the first token. A provider that fails
 *   mid-stream aborts the request with a typed InferenceError('mid-stream'):
 *   another model is never concatenated after a partial response.
 * - Errors are typed (InferenceError) and travel out of band, never as
 *   assistant text.
 */

import { CommunicationLevel, SystemProtocol } from '../../types';
import { systemBus } from '../systemBus';
import { InferenceError, type AgentInferenceRequest, type InferenceCompletion, type InferenceEvent, type PreparedAgentRequest } from './inference';
import { prepareAgentRequest } from './agentPrompt';
import { ProviderRegistry } from './providerRegistry';
import { OpenAICompatibleClient } from './openAICompatible';
import { geminiAdapter, ollamaAdapter, openAICompatibleAdapter, zhipuAdapter, type StreamAdapter } from './streamAdapters';

export interface AgentInferenceRouterDeps {
    adapters?: StreamAdapter[];
    /** Explicit fallback chain (provider ids). Defaults to defaultChain(registry). */
    chain?: string[];
    registry?: ProviderRegistry;
}

/**
 * Default fallback chain. ZHIPUAI stays first (free primary, previous chat
 * behavior); the rest follow the provider registry priorities merged in #63
 * (single routing policy for the whole system); OLLAMA closes as the local
 * survival tier. Providers without a stream adapter are skipped.
 */
export function defaultChain(registry: ProviderRegistry, adapterIds: Set<string>): string[] {
    const prioritized = registry.order().filter(id => adapterIds.has(id) && id !== 'OLLAMA' && id !== 'ZHIPUAI');
    return ['ZHIPUAI', ...prioritized, 'OLLAMA'].filter(id => adapterIds.has(id));
}

export function createAgentInferenceRouter(deps: AgentInferenceRouterDeps = {}) {
    const registry = deps.registry ?? ProviderRegistry.fromEnvironment();
    const adapters = deps.adapters ?? buildDefaultAdapters(registry);
    const chain = deps.chain ?? defaultChain(registry, new Set(adapters.map(a => a.id)));

    function emitThoughts(state: { buffer: string; emitted: Set<string> }, text: string, agentName: string) {
        // Real-time Thought Extractor (previously only on the Gemini path; now uniform)
        state.buffer += text;
        const thoughtRegex = /<(?:thought|think)>(.*?)<\/(?:thought|think)>/gs;
        let match;
        while ((match = thoughtRegex.exec(state.buffer)) !== null) {
            const content = match[1].trim();
            if (!state.emitted.has(content)) {
                systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: [content] }, agentName);
                state.emitted.add(content);
            }
        }
    }

    async function* stream(req: AgentInferenceRequest): AsyncGenerator<InferenceEvent, void, unknown> {
        const prepared = await prepareAgentRequest(req);
        yield* streamPrepared(prepared, req.preferredProvider);
    }

    async function* streamPrepared(prepared: PreparedAgentRequest, preferredProvider?: string): AsyncGenerator<InferenceEvent, void, unknown> {
        const order = preferredProvider
            ? [preferredProvider, ...chain.filter(id => id !== preferredProvider)]
            : chain;

        const failures: string[] = [];
        for (const id of order) {
            const adapter = adapters.find(a => a.id === id);
            if (!adapter) continue;

            try {
                if (!(await adapter.isAvailable())) { failures.push(`${id}: unavailable`); continue; }
            } catch (e: any) {
                failures.push(`${id}: availability check failed (${e?.message || e})`);
                continue;
            }

            let emitted = false;
            const thoughts = { buffer: '', emitted: new Set<string>() };
            // [MODEL LEAK FIX] A model id is provider-specific: a Gemini id sent to
            // Groq/Ollama Cloud 404s the whole leg. Strip the override when this
            // provider is not the one the caller scoped it to.
            const effectivePrepared = prepared.model && prepared.modelProvider && prepared.modelProvider !== id
                ? { ...prepared, model: undefined }
                : prepared;
            try {
                for await (const text of adapter.stream(effectivePrepared)) {
                    if (!emitted) {
                        emitted = true;
                        yield { type: 'provider', provider: id, model: adapter.modelFor?.(effectivePrepared) };
                    }
                    if (!text) continue;
                    emitThoughts(thoughts, text, prepared.agentName);
                    yield { type: 'text', text };
                }
                if (!emitted) {
                    // Silent empty completion: honest failure, try the next provider
                    failures.push(`${id}: empty response`);
                    continue;
                }
                return; // Success
            } catch (e: any) {
                if (emitted) {
                    // NEVER concatenate another model after a partial response.
                    throw e instanceof InferenceError ? e : new InferenceError(id, 'mid-stream', e?.message || 'stream failed', { cause: e });
                }
                failures.push(`${id}: ${e?.message || e}`);
                console.warn(`[INFERENCE ROUTER] ${id} failed before first token, trying next...`, e?.message || e);
            }
        }

        throw new InferenceError('router', 'unavailable', `All inference providers failed: ${failures.join('; ') || 'no providers configured'}`);
    }

    async function complete(req: AgentInferenceRequest): Promise<InferenceCompletion> {
        let text = '';
        let provider = '';
        let model: string | undefined;
        for await (const event of stream(req)) {
            if (event.type === 'provider') { provider = event.provider; model = event.model; }
            else text += event.text;
        }
        return { text, provider, model };
    }

    /**
     * Simple prompt completion through the same chain (fact extraction and other
     * internal consumers). Bypasses agent prompt assembly: the prompt travels as
     * the raw user task, exactly as the legacy generateText chain delivered it.
     */
    async function completeText(prompt: string, options: { temperature?: number; maxTokens?: number; lane?: 'conversational' | 'background' } = {}): Promise<string> {
        const prepared: PreparedAgentRequest = {
            agentName: 'InternalCompletion',
            category: 'CORE',
            level: CommunicationLevel.TECHNICAL,
            systemPrompt: '',
            task: prompt,
            chatHistory: [],
            relevantMemory: '',
            capabilities: { webSearch: false, codeExecution: false, imageGeneration: false, memoryWrite: false },
            temperature: options.temperature ?? 0.3,
            maxTokens: options.maxTokens ?? 1024,
            lane: options.lane ?? 'background'
        };
        let text = '';
        for await (const event of streamPrepared(prepared)) {
            if (event.type === 'text') text += event.text;
        }
        return text;
    }

    return { stream, complete, completeText, chain: [...chain] };
}

function buildDefaultAdapters(registry: ProviderRegistry): StreamAdapter[] {
    const client = new OpenAICompatibleClient();
    const adapters: StreamAdapter[] = [zhipuAdapter(), geminiAdapter(), ollamaAdapter()];
    for (const definition of registry.list()) {
        if (definition.transport === 'openai-compatible') adapters.push(openAICompatibleAdapter(definition, client));
    }
    return adapters;
}

export type AgentInferenceRouter = ReturnType<typeof createAgentInferenceRouter>;

export const agentInferenceRouter = createAgentInferenceRouter();
