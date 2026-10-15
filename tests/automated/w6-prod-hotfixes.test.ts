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
    const generateContentStream = vi.fn();
    return {
        generateGeminiTextPure,
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
    generateGeminiTextPure: mocks.generateGeminiTextPure
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
import { DEFAULT_GEMINI_MODEL } from '../../services/llm/defaultModels';
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
        mocks.zhipuIsAvailable.mockReset().mockReturnValue(false);
        mocks.ollamaIsAvailable.mockReset();
        mocks.ollamaGenerateCompletion.mockReset();
        mocks.deepSeekIsAvailable.mockReset().mockReturnValue(false);
    });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV_KEY];
        else process.env[ENV_KEY] = saved;
    });

    it('falls back to Gemini with the env-driven background model when DeepSeek/ZhipuAI are unavailable', async () => {
        process.env[ENV_KEY] = 'gemini-test-bg';
        mocks.generateGeminiTextPure.mockResolvedValue('gemini-ok');
        mocks.ollamaIsAvailable.mockResolvedValue(true);

        const result = await backgroundLLM.generate('do something', { taskType: 'GENERAL' });

        expect(result).toBe('gemini-ok');
        expect(mocks.generateGeminiTextPure).toHaveBeenCalledWith('do something', 'gemini-test-bg');
        // Gemini answered: Ollama must never be touched
        expect(mocks.ollamaGenerateCompletion).not.toHaveBeenCalled();
    });

    it('defaults the background model to gemini-3.5-flash when the env var is unset', async () => {
        delete process.env[ENV_KEY];
        mocks.generateGeminiTextPure.mockResolvedValue('gemini-ok');
        mocks.ollamaIsAvailable.mockResolvedValue(false);

        await backgroundLLM.generate('p', { taskType: 'GENERAL' });

        expect(mocks.generateGeminiTextPure).toHaveBeenCalledWith('p', 'gemini-3.5-flash');
    });

    it('degrades honestly to Ollama when the Gemini fallback also fails', async () => {
        process.env[ENV_KEY] = 'gemini-test-bg';
        mocks.generateGeminiTextPure.mockRejectedValue(new Error('429 quota'));
        mocks.ollamaIsAvailable.mockResolvedValue(true);
        mocks.ollamaGenerateCompletion.mockResolvedValue('local-ok');

        const result = await backgroundLLM.generate('p', { taskType: 'GENERAL' });

        expect(result).toBe('local-ok');
        expect(mocks.ollamaGenerateCompletion).toHaveBeenCalledTimes(1);
    });
});
