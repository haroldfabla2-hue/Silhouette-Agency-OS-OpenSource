/**
 * Unit: a request-scoped model override must not leak across providers in the
 * fallback chain. Regression for 2026-10-16: chat pinned a Gemini model id and
 * the router sent it verbatim to GROQ and OLLAMA_CLOUD, which 404'd — the legs
 * died even though both providers were healthy with their own models.
 */
import { describe, it, expect } from 'vitest';
import { createAgentInferenceRouter } from '../../services/llm/agentInferenceRouter';

function stubAdapter(id: string, seen: Record<string, string | undefined>, fail = false) {
    return {
        id,
        isAvailable: async () => true,
        modelFor: (p: any) => p.model,
        async *stream(prepared: any) {
            seen[id] = prepared.model;
            if (fail) throw new Error(`${id} simulated failure`);
            yield `${id}-answer`;
        },
    };
}

function makeRouter(seen: Record<string, string | undefined>, geminiFails: boolean) {
    return createAgentInferenceRouter({
        adapters: [stubAdapter('GEMINI', seen, geminiFails) as any, stubAdapter('GROQ', seen) as any],
        chain: ['GEMINI', 'GROQ'],
    });
}

const baseReq = {
    agentName: 'T', role: 'T', category: 'CORE', task: 'hola',
    model: 'gemini-2.5-flash', modelProvider: 'GEMINI',
} as any;

describe('model override scoping across the fallback chain', () => {
    it('strips a foreign model id on fallback providers', async () => {
        const seen: Record<string, string | undefined> = {};
        const router = makeRouter(seen, true); // GEMINI fails -> fallback to GROQ
        let text = '';
        for await (const ev of router.stream(baseReq)) { if (ev.type === 'text') text += ev.text; }
        expect(text).toBe('GROQ-answer');
        expect(seen.GEMINI).toBe('gemini-2.5-flash'); // own provider keeps the override
        expect(seen.GROQ).toBeUndefined();            // fallback gets its own configured model
    });

    it('legacy behavior preserved when modelProvider is unset', async () => {
        const seen: Record<string, string | undefined> = {};
        const router = makeRouter(seen, true);
        const req = { ...baseReq }; delete req.modelProvider;
        for await (const ev of router.stream(req)) { void ev; }
        expect(seen.GROQ).toBe('gemini-2.5-flash'); // unchanged legacy semantics
    });

    it('chatController scopes its override to GEMINI', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(__dirname, '..', '..', 'server', 'controllers', 'chatController.ts'), 'utf8');
        const block = src.slice(src.indexOf('model: modelOverride') - 100, src.indexOf('model: modelOverride') + 120);
        expect(block).toContain("modelProvider: 'GEMINI'");
    });
});
