/**
 * STREAM ADAPTERS (R1: chat-gateway unification)
 *
 * One exclusive adapter per provider. Each adapter owns its provider's
 * transport and nothing else: no fallback inside an adapter, ever. Fallback
 * policy lives in agentInferenceRouter. Availability checks are pure: they
 * never consume quota, never reserve capacity.
 */

import { CommunicationLevel, SystemProtocol } from '../../types';
import { systemBus } from '../systemBus';
import { InferenceError, type PreparedAgentRequest } from './inference';
import type { ProviderDefinition } from './providerRegistry';
import { OpenAICompatibleClient, type ChatMessage } from './openAICompatible';
import { DEFAULT_GEMINI_MODEL } from './defaultModels';

export interface StreamAdapter {
    readonly id: string;
    /** Pure availability check (no quota consumption, no reservation). */
    isAvailable(): boolean | Promise<boolean>;
    /** Model this adapter would use for the request, when knowable before streaming. */
    modelFor?(prepared: PreparedAgentRequest): string | undefined;
    stream(prepared: PreparedAgentRequest): AsyncGenerator<string, void, unknown>;
}

// --- ZHIPUAI: non-streaming cloud, primary free tier ---
export function zhipuAdapter(): StreamAdapter {
    return {
        id: 'ZHIPUAI',
        isAvailable: async () => {
            // Lazy import so this module never forces the service (and its timers) into test workers
            const { zhipuService } = await import('../zhipuService');
            return zhipuService.isAvailable('agents');
        },
        async *stream(prepared) {
            const { zhipuService } = await import('../zhipuService');
            // ZhipuAI doesn't support streaming - yield the complete response
            // For USER_FACING, add explicit instruction to respond in natural language (not JSON)
            const outputInstruction = prepared.level === CommunicationLevel.USER_FACING
                ? '\n\n[CRITICAL: Respond in natural conversational language. Do NOT output JSON, code blocks, or structured data unless explicitly asked.]'
                : '';
            const history = prepared.chatHistory.length
                ? `\n\nChat History:\n${prepared.chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')}`
                : '';
            const fullPrompt = `${prepared.systemPrompt}${outputInstruction}\n\nContext:\n${prepared.relevantMemory}${history}\n\nUser: ${prepared.task}`;

            const response = await zhipuService.generateCompletion(fullPrompt, {
                maxTokens: prepared.maxTokens,
                temperature: prepared.temperature,
                signal: prepared.signal
            }, 'agents', prepared.lane);

            if (!response) throw new InferenceError('ZHIPUAI', 'invalid-response', 'empty completion');
            yield response;
        }
    };
}

// --- GEMINI: native SDK streaming with native tools (googleSearch / codeExecution) ---
export function geminiAdapter(): StreamAdapter {
    // [Hotfix W6] Per-transport model: streaming quota drains separately
    // from non-streaming. GEMINI_STREAM_MODEL overrides the default for
    // this streaming adapter only. PR to follow.
    const DEFAULT_MODEL = process.env.GEMINI_STREAM_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    return {
        id: 'GEMINI',
        isAvailable: async () => {
            const { hasGeminiKey } = await import('../geminiService');
            return hasGeminiKey();
        },
        modelFor: prepared => prepared.model || DEFAULT_MODEL,
        async *stream(prepared) {
            const { getGeminiClient } = await import('../geminiService');
            const ai = getGeminiClient();
            if (!ai) throw new InferenceError('GEMINI', 'unavailable', 'API key not configured');

            const nativeTools: any[] = [];
            if (prepared.capabilities.webSearch) nativeTools.push({ googleSearch: {} });
            if (prepared.capabilities.codeExecution) nativeTools.push({ codeExecution: {} });

            const contents = [
                ...(prepared.systemPrompt ? [{ role: 'user', parts: [{ text: prepared.systemPrompt }] }] : []),
                ...prepared.chatHistory.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                })),
                { role: 'user', parts: [{ text: prepared.task }] }
            ];

            const stream = await ai.models.generateContentStream({
                model: prepared.model || DEFAULT_MODEL,
                contents,
                tools: nativeTools.length > 0 ? nativeTools : undefined,
                config: { temperature: prepared.temperature, maxOutputTokens: 8192 }
            } as any);

            for await (const chunk of stream) {
                // SDK compat: chunk.text is a getter property in current
                // @google/genai, a function in older versions; fall back to
                // the candidates shape. (Hotfix W6 — PR to follow.)
                const c: any = chunk;
                const text: string = typeof c.text === 'function' ? c.text()
                    : (typeof c.text === 'string' ? c.text
                    : (c.candidates?.[0]?.content?.parts?.[0]?.text ?? ''));
                if (text) yield text;
            }
        }
    };
}

// --- OpenAI-compatible providers (NVIDIA, OPENROUTER, GROQ): registry-driven transport ---
export function openAICompatibleAdapter(definition: ProviderDefinition, client: OpenAICompatibleClient): StreamAdapter {
    return {
        id: definition.id,
        isAvailable: () => client.configured(definition),
        modelFor: prepared => client.model(definition, prepared.model),
        async *stream(prepared) {
            const messages: ChatMessage[] = [
                { role: 'system', content: prepared.systemPrompt },
                ...prepared.chatHistory.map(m => ({
                    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
                    content: m.content
                })),
                { role: 'user', content: prepared.task }
            ];
            await client.discover(definition);
            for await (const event of client.stream(definition, messages, {
                model: prepared.model,
                temperature: prepared.temperature,
                maxTokens: prepared.maxTokens,
                signal: prepared.signal
            })) {
                if (event.type === 'text') yield event.text;
                else if (event.type === 'tool') {
                    // The agent route uses textual tools; a structured tool delta here means the
                    // provider answered outside the contract. Fail loudly instead of dropping it.
                    throw new InferenceError(definition.id, 'invalid-response', 'unexpected tool call delta (no tools were requested)');
                }
            }
        }
    };
}

// --- OLLAMA: local survival tier with the JSON RE-ACT tool protocol preserved verbatim ---
export function ollamaAdapter(): StreamAdapter {
    const TOOL_PROTOCOL = `
[SYSTEM PROTOCOL: UNIVERSAL TOOL USE]
You are running in OFFLINE MODE. You have access to the following local tools:
1. generate_video(prompt: string, engine?: 'WAN'|'SVD', duration?: number) - Use for any video request.
2. generate_image(prompt: string, style: 'PHOTOREALISTIC'|'ILLUSTRATION', aspectRatio?: '16:9'|'1:1'|'9:16') - Use for image requests.
3. list_visual_assets(filter_type?: 'video'|'image') - Use to find files.

To use a tool, you MUST output valid JSON ONLY in this format:
{
  "thought": "Rationale...",
  "tool": "tool_name",
  "args": { ... }
}

If no tool is needed, respond with normal text.
DO NOT hallucinate fake media urls. Use the tool.
`;
    return {
        id: 'OLLAMA',
        isAvailable: async () => {
            const { ollamaService } = await import('../ollamaService');
            return ollamaService.isAvailable();
        },
        modelFor: prepared => prepared.model
            || ((prepared.category === 'DEV' || prepared.category === 'SCIENCE' || prepared.category === 'PLANNING') ? 'glm4:light' : 'llama3.2:light'),
        async *stream(prepared) {
            const { ollamaService } = await import('../ollamaService');
            const { toolHandler } = await import('../tools/toolHandler');

            // [PA-041] HYBRID INTELLIGENCE ROUTING
            // Llama 3.2 (Motor) -> Fast, Reflexive, Tools
            // GLM-4 (Cortex) -> Complex reasoning, Science, Coding
            const localModel = prepared.model
                || ((prepared.category === 'DEV' || prepared.category === 'SCIENCE' || prepared.category === 'PLANNING')
                    ? 'glm4:light'
                    : 'llama3.2:light');

            // Notify UI of mode switch
            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: ["⚠️ Cloud Disconnected. Activating Local Neural Pathways (Universal Fallback)."] }, prepared.agentName);

            // [PA-039] ROBUST CONTEXT INJECTION
            // Instead of a single string, we use the proper Chat format to preserve history.
            const messages = [
                // 1. SYSTEM IDENTITY + TOOLS
                { role: 'system', content: `${prepared.systemPrompt}\n\n${TOOL_PROTOCOL}` },

                // 2. RETRIEVED MEMORY (Injected as verifyable context)
                { role: 'system', content: `[MEMORY ACCESS DECK]:\n${prepared.relevantMemory || "No relevant memories."}` },

                // 3. CHAT HISTORY (The "Stream of Consciousness")
                ...prepared.chatHistory.map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'assistant', // Map strictly to valid roles
                    content: msg.content
                })),

                // 4. CURRENT TASK
                { role: 'user', content: prepared.task }
            ];

            // We capture the stream to buffer it for JSON detection
            let buffer = "";
            let isToolCall = false;

            const stream = ollamaService.generateChatStream(messages, localModel);

            for await (const chunk of stream) {
                buffer += chunk;
                // Heuristic: If buffer starts with { and looks like JSON, we might hush stdout until complete.
                // Simplified Approach: Buffer the first 50 chars. If it starts with {, assume JSON and don't yield yet.
                if (buffer.length < 50) {
                    // Wait to decide
                } else if (buffer.trim().startsWith('{')) {
                    isToolCall = true;
                    // Don't yield chunk, we are buffering for execution
                } else {
                    // Not a tool call, flush buffer and stream normally
                    if (buffer.length > 0) {
                        yield buffer;
                        buffer = ""; // Clear so we don't yield duplicate
                    }
                }
            }

            // End of stream. If tool call, execute.
            if (isToolCall) {
                try {
                    // Try to find the JSON block
                    const jsonMatch = buffer.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const payload = JSON.parse(jsonMatch[0]);
                        if (payload.tool && payload.args) {
                            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: [`[Universal Fallback] 🛠️ Local Tool Call: ${payload.tool}`] }, prepared.agentName);

                            // Execute
                            const toolResult = await toolHandler.handleFunctionCall(payload.tool, payload.args, prepared.toolCaller);

                            // Report back
                            const output = JSON.stringify(toolResult, null, 2);
                            yield `\n\n[SYSTEM]: Tool Executed.\nResult: ${output}`;
                        }
                    } else {
                        // Failed to parse, yield raw buffer
                        yield buffer;
                    }
                } catch (e) {
                    console.error("[Universal Fallback] JSON Parse Error:", e);
                    yield buffer; // Yield original messed up text
                }
            } else if (buffer.length > 0) {
                // Yield remaining buffer if not flushed
                yield buffer;
            }
        }
    };
}
