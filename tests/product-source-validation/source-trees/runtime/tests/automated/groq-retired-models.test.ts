/**
 * Regression (found live in production logs during the autonomous-cycle test):
 * the Groq fallback chain called RETIRED models on every fallback:
 *   [GROQ] Fallback failed: 404 - The model `llama-3.3-70b-versatile` does not exist
 * With OpenRouter over its free daily quota (429) and Ollama not deployed,
 * this produced "All AI Circuits Failed" and degraded a whole workflow cycle.
 *
 * Verified live against GET https://api.groq.com/openai/v1/models with the
 * account key on 2026-10-14: openai/gpt-oss-120b and openai/gpt-oss-20b exist
 * (context_window 131072); llama-3.3-70b-versatile, llama-3.1-8b-instant and
 * llama-3.2-90b-vision-preview do NOT. The account has no vision model, so
 * the image branch must honestly skip Groq instead of calling a retired model.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const GEMINI_SVC = fs.readFileSync(path.resolve(__dirname, '../../services/geminiService.ts'), 'utf-8');
const CATALOG = fs.readFileSync(path.resolve(__dirname, '../../services/modelCatalog.ts'), 'utf-8');

const RETIRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.2-90b-vision-preview'];

describe('Groq retired models (production 404 regression)', () => {
    it('geminiService has no retired Groq model literals', () => {
        for (const m of RETIRED) expect(GEMINI_SVC).not.toContain(m);
    });

    it('geminiService Groq fallback uses DEFAULT_GROQ_MODEL', () => {
        expect(GEMINI_SVC).toContain('const modelToUse = DEFAULT_GROQ_MODEL');
        expect(GEMINI_SVC).toContain('model: DEFAULT_GROQ_MODEL');
    });

    it('image branch honestly skips Groq (account has no vision model)', () => {
        expect(GEMINI_SVC).toContain('Vision fallback unavailable');
    });

    it('modelCatalog lists only live-verified Groq models', () => {
        for (const m of RETIRED) expect(CATALOG).not.toContain(m);
        expect(CATALOG).toContain("id: 'openai/gpt-oss-120b'");
        expect(CATALOG).toContain("id: 'openai/gpt-oss-20b'");
    });

    it('DEFAULT_GROQ_MODEL is the live-verified model', async () => {
        const { DEFAULT_GROQ_MODEL } = await import('../../services/llm/defaultModels');
        expect(DEFAULT_GROQ_MODEL).toBe('openai/gpt-oss-120b');
    });
});
