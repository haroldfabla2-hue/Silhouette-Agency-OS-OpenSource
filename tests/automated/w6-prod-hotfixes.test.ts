/**
 * W6 prod hotfixes — regression tests for the two hotfixes applied live
 * during the W6 factory re-test night (2026-10-15) and reconciled here:
 *
 *  1. services/llm/streamAdapters.ts
 *     - geminiAdapter honors GEMINI_STREAM_MODEL (streaming quota drains
 *       independently from non-streaming, so the stream transport gets its
 *       own env-driven model).
 *     - chunk.text SDK compatibility: current @google/genai exposes
 *       chunk.text as a getter PROPERTY; older versions expose it as a
 *       FUNCTION; last resort is the candidates shape. The old code called
 *       it unconditionally as a function and crashed every stream thread.
 *
 *  2. services/backgroundLLMService.ts
 *     - Gemini fallback (GEMINI_BACKGROUND_MODEL, env-driven) runs before
 *       Ollama when DeepSeek/ZhipuAI are unavailable; the chain degrades
 *       honestly to Ollama when Gemini also fails.
 *
 * All tests are hermetic: provider SDKs and services are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (shared by both services under test)
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
    const generateGeminiTextPure = vi.fn();
    const generateTextWithCloudFallbacks = vi.fn();
    const generateContentStream = vi.fn();
    return {
        generateGeminiTextPure,
        generateTextWithCloudFallbacks,
        generateContentStream,
        geminiClient: { models: { generateContentStream } },
        zhipuIsAvailable: vi.fn(),
        zhipuGenerate: vi.fn(),
        ollamaIsAvailable: vi.fn(),
        ollamaGenerateCompletion: vi.fn(),
        ollamaGenerateChatStream: vi.fn(),
        deepSeekIsAvailable: vi.fn()
    };
});

vi.mock('../../services/geminiService', () => ({
    getGeminiClient: () => mocks.geminiClient,
    hasGeminiKey: () => true,
    generateGeminiTextPure: mocks.generateGeminiTextPure,
    generateTextWithCloudFallbacks: mocks.generateTextWithCloudFallbacks
}));

vi.mock('../../services/zhipuService', () => ({
    zhipuService: {
        isAvailable: mocks.zhipuIsAvailable,
        generateCompletion: mocks.zhipuGenerate
    }
}));

vi.mock('../../services/ollamaService', () => ({
    ollamaService: {
        isAvailable: mocks.ollamaIsAvailable,
        generateCompletion: mocks.ollamaGenerateCompletion,
        generateChatStream: mocks.ollamaGenerateChatStream
    }
}));

vi.mock('../../services/deepSeekService', () => ({
    deepSeekService: {
        isAvailable: mocks.deepSeekIsAvailable,
        generateCompletion: vi.fn()
    }
}));

vi.mock('../../services/costEstimator', () => ({
    costEstimator: { trackTransaction: vi.fn() }
}));

import { geminiAdapter } from '../../services/llm/streamAdapters';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_BACKGROUND_MODEL } from '../../services/llm/defaultModels';
import { backgroundLLM } from '../../services/backgroundLLMService';

const preparedBase: any = {
    systemPrompt: 'sys',
    chatHistory: [],
    task: 'ping',
    relevantMemory: '',
    capabilities: { webSearch: false, codeExecution: false },
    maxTokens: 64,
    temperature: 0.1,
    level: 'INTERNAL',
    category: 'GENERAL',
    agentName: 'TestAgent'
};

async function* fakeStream(chunks: any[]) {
    for (const c of chunks) yield c;
}

describe('W6 hotfix — streamAdapters geminiAdapter', () => {
    const ENV_KEY = 'GEMINI_STREAM_MODEL';
    let saved: string | undefined;

    beforeEach(() => {
        saved = process.env[ENV_KEY];
        mocks.generateContentStream.mockReset();
    });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV_KEY];
        else process.env[ENV_KEY] = saved;
    });

    it('modelFor honors GEMINI_STREAM_MODEL over the default model', () => {
        process.env[ENV_KEY] = 'gemini-test-stream';
        const adapter = geminiAdapter();
        expect(adapter.modelFor!(preparedBase)).toBe('gemini-test-stream');
    });

    it('modelFor falls back to DEFAULT_GEMINI_MODEL when the env var is unset or blank', () => {
        delete process.env[ENV_KEY];
        expect(geminiAdapter().modelFor!(preparedBase)).toBe(DEFAULT_GEMINI_MODEL);
        process.env[ENV_KEY] = '   ';
        expect(geminiAdapter().modelFor!(preparedBase)).toBe(DEFAULT_GEMINI_MODEL);
    });

    it('an explicit prepared.model always wins over the env override', () => {
        process.env[ENV_KEY] = 'gemini-test-stream';
        const adapter = geminiAdapter();
        expect(adapter.modelFor!({ ...preparedBase, model: 'gemini-explicit' })).toBe('gemini-explicit');
    });

    it('stream() extracts text from function, property and candidates chunk shapes', async () => {
        process.env[ENV_KEY] = 'gemini-test-stream';
        mocks.generateContentStream.mockResolvedValue(fakeStream([
            { text: () => 'A' },                                                  // legacy SDK: function
            { text: 'B' },                                                        // current SDK: getter property
            { candidates: [{ content: { parts: [{ text: 'C' }] } }] },            // raw candidates shape
            { text: () => '' },                                                   // empty chunk: skipped
            { other: true }                                                       // unknown shape: skipped
        ]));

        const adapter = geminiAdapter();
        let out = '';
        for await (const piece of adapter.stream(preparedBase)) out += piece;

        expect(out).toBe('ABC');
        expect(mocks.generateContentStream).toHaveBeenCalledTimes(1);
        const callArg = mocks.generateContentStream.mock.calls[0][0];
        expect(callArg.model).toBe('gemini-test-stream');
    });
});

describe('W6 hotfix — backgroundLLMService Gemini fallback', () => {
    const ENV_KEY = 'GEMINI_BACKGROUND_MODEL';
    let saved: string | undefined;

    beforeEach(() => {
        saved = process.env[ENV_KEY];
        mocks.generateGeminiTextPure.mockReset();
        mocks.generateTextWithCloudFallbacks.mockReset();
        mocks.zhipuIsAvailable.mockReset().mockReturnValue(false);
        mocks.ollamaIsAvailable.mockReset();
        mocks.ollamaGenerateCompletion.mockReset();
        mocks.deepSeekIsAvailable.mockReset().mockReturnValue(false);
    });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV_KEY];
        else process.env[ENV_KEY] = saved;
    });

    it('falls back to the cloud failover chain when DeepSeek/ZhipuAI are unavailable', async () => {
        mocks.generateTextWithCloudFallbacks.mockResolvedValue('cloud-ok');
        mocks.ollamaIsAvailable.mockResolvedValue(true);

        const result = await backgroundLLM.generate('do something', { taskType: 'GENERAL' });

        expect(result).toBe('cloud-ok');
        expect(mocks.generateTextWithCloudFallbacks).toHaveBeenCalledWith(
            'do something',
            expect.objectContaining({ maxTokens: expect.any(Number), temperature: expect.any(Number) })
        );
        // Cloud chain answered: Ollama must never be touched
        expect(mocks.ollamaGenerateCompletion).not.toHaveBeenCalled();
    });

    it('defaults the background model to gemini-3.1-flash-lite when the env var is unset', () => {
        // Per-model quota buckets drain independently (verified live 2026-10-15:
        // gemini-3.5-flash non-stream 429s while lite answers 200 on the same key),
        // so the background default is the lite model, not the exhausted 3.5-flash.
        delete process.env[ENV_KEY];
        expect(DEFAULT_GEMINI_BACKGROUND_MODEL).toBe('gemini-3.1-flash-lite');
    });

    it('degrades honestly to Ollama (default qwen3:4b) when the whole cloud chain fails', async () => {
        mocks.generateTextWithCloudFallbacks.mockRejectedValue(new Error('all clouds failed'));
        mocks.ollamaIsAvailable.mockResolvedValue(true);
        mocks.ollamaGenerateCompletion.mockResolvedValue('local-ok');

        const result = await backgroundLLM.generate('p', { taskType: 'GENERAL' });

        expect(result).toBe('local-ok');
        expect(mocks.ollamaGenerateCompletion).toHaveBeenCalledTimes(1);
        // 5th arg = model; default is qwen3:4b (glm4:light was never provisioned)
        expect(mocks.ollamaGenerateCompletion.mock.calls[0][4]).toBe('qwen3:4b');
    });

    it('honors OLLAMA_BACKGROUND_MODEL for the local fallback', async () => {
        process.env['OLLAMA_BACKGROUND_MODEL'] = 'qwen3:4b-instruct';
        try {
            mocks.generateTextWithCloudFallbacks.mockRejectedValue(new Error('all clouds failed'));
            mocks.ollamaIsAvailable.mockResolvedValue(true);
            mocks.ollamaGenerateCompletion.mockResolvedValue('local-ok');

            await backgroundLLM.generate('p', { taskType: 'GENERAL' });

            expect(mocks.ollamaGenerateCompletion.mock.calls[0][4]).toBe('qwen3:4b-instruct');
        } finally {
            delete process.env['OLLAMA_BACKGROUND_MODEL'];
        }
    });
});
