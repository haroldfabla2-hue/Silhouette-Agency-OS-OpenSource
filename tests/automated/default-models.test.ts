/**
 * Model defaults: registry, stream adapter and geminiService must all resolve
 * to the same live-verified defaults from services/llm/defaultModels.ts, and
 * env overrides must win. No network, no external services.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('default model resolution', () => {
    afterEach(() => {
        delete process.env.GEMINI_MODEL;
        delete process.env.GEMINI_EMBEDDING_MODEL;
        vi.resetModules();
    });

    it('ships the live-verified defaults', async () => {
        const m = await import('../../services/llm/defaultModels');
        expect(m.DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');
        expect(m.DEFAULT_GROQ_MODEL).toBe('openai/gpt-oss-120b');
        expect(m.DEFAULT_OPENROUTER_MODEL).toBe('nvidia/nemotron-3-super-120b-a12b:free');
        expect(m.DEFAULT_GEMINI_EMBEDDING_MODEL).toBe('gemini-embedding-001');
        expect(m.FALLBACK_GEMINI_EMBEDDING_MODEL).toBe('gemini-embedding-2');
        expect(m.GEMINI_EMBEDDING_DIMENSIONS).toBe(768);
    });

    it('GEMINI_MODEL env overrides the default', async () => {
        process.env.GEMINI_MODEL = 'gemini-3.5-flash';
        vi.resetModules();
        const m = await import('../../services/llm/defaultModels');
        expect(m.DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash');
    });

    it('blank GEMINI_MODEL falls back to the default', async () => {
        process.env.GEMINI_MODEL = '   ';
        vi.resetModules();
        const m = await import('../../services/llm/defaultModels');
        expect(m.DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');
    });

    it('GEMINI_EMBEDDING_MODEL env overrides the embedding default', async () => {
        process.env.GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2';
        vi.resetModules();
        const m = await import('../../services/llm/defaultModels');
        expect(m.DEFAULT_GEMINI_EMBEDDING_MODEL).toBe('gemini-embedding-2');
    });

    it('registry providers use the same defaults', async () => {
        const { builtInProviders } = await import('../../services/llm/providerRegistry');
        const m = await import('../../services/llm/defaultModels');
        const byId = Object.fromEntries(builtInProviders.map(p => [p.id, p]));
        expect(byId.GEMINI?.model).toBe(m.DEFAULT_GEMINI_MODEL);
        expect(byId.GROQ?.model).toBe(m.DEFAULT_GROQ_MODEL);
        expect(byId.OPENROUTER?.model).toBe(m.DEFAULT_OPENROUTER_MODEL);
    });

    it('gemini stream adapter falls back to DEFAULT_GEMINI_MODEL', async () => {
        const { geminiAdapter } = await import('../../services/llm/streamAdapters');
        const m = await import('../../services/llm/defaultModels');
        const adapter = geminiAdapter();
        expect(adapter.modelFor({} as any)).toBe(m.DEFAULT_GEMINI_MODEL);
        expect(adapter.modelFor({ model: 'explicit-model' } as any)).toBe('explicit-model');
    });
});
