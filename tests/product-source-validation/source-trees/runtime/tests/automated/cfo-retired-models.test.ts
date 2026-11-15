/**
 * CFO retired-models fix — regression tests.
 *
 * cfoService.negotiateModel hardcoded retired Gemini models
 * (gemini-2.0-flash, gemini-2.5-flash, gemini-1.5-pro, gemini-1.5-flash —
 * all 404 against the live API, verified 2026-10-15) and returned
 * 'abab-6.5s-chat' for code tasks whenever OpenRouter was configured, even
 * though geminiService routes any 'abab*' model to minimaxService, whose
 * key is empty in prod — a guaranteed failure for exactly the high-value
 * tasks.
 *
 * Fix: all Gemini picks go through DEFAULT_GEMINI_MODEL (env-driven via
 * GEMINI_MODEL); the OpenRouter/code branch falls back to that default;
 * 'abab-6.5s-chat' is returned ONLY when a Minimax key is actually
 * provisioned. Hermetic: configLoader / settingsManager / costEstimator /
 * systemBus are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    minimaxApiKey: undefined as string | undefined
}));

vi.mock('../../services/costEstimator', () => ({
    costEstimator: {
        getMetrics: () => ({ sessionCost: 0, dailyCost: 0 }),
        trackTransaction: vi.fn()
    }
}));
vi.mock('../../services/systemBus', () => ({
    systemBus: { emit: vi.fn(), on: vi.fn() }
}));
vi.mock('../../services/settingsManager', () => ({
    settingsManager: {
        getSettings: () => ({ registeredIntegrations: [] })
    }
}));
vi.mock('../../server/config/configLoader', () => ({
    configLoader: {
        getConfig: () => ({
            llm: { providers: { minimax: mocks.minimaxApiKey ? { apiKey: mocks.minimaxApiKey } : undefined } }
        })
    }
}));

import { CFOAgent } from '../../services/cfoService';
import { DEFAULT_GEMINI_MODEL } from '../../services/llm/defaultModels';

const RETIRED = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];

describe('CFO negotiateModel — no retired models, no keyless Minimax routing', () => {
    const cfo = CFOAgent.getInstance();
    const ENV_KEYS = ['OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'ZHIPU_API_KEY', 'ZHIPUAI_API_KEY'];
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
        mocks.minimaxApiKey = undefined;
    });
    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
        mocks.minimaxApiKey = undefined;
    });

    it('never returns a retired Gemini model across representative scenarios', () => {
        const scenarios: Array<[string, any]> = [
            ['hi', {}],
            ['write a function to fix this bug in typescript', { category: 'DEV' }],
            ['[VISION_REQUIRED] describe this image', { hasImage: true }],
            ['x'.repeat(1500), { category: 'SCIENCE' }]
        ];
        for (const [prompt, ctx] of scenarios) {
            const model = cfo.negotiateModel(prompt, DEFAULT_GEMINI_MODEL, ctx);
            expect(RETIRED).not.toContain(model);
        }
    });

    it('defaults to the env-driven Gemini default with no providers configured', () => {
        const model = cfo.negotiateModel('hello there', DEFAULT_GEMINI_MODEL, {});
        expect(model).toBe(DEFAULT_GEMINI_MODEL);
    });

    it('does NOT route code tasks to Minimax when only OpenRouter is configured', () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        const model = cfo.negotiateModel('implement a class in typescript', DEFAULT_GEMINI_MODEL, { category: 'DEV', agentName: 'DevAgent' });
        expect(model).toBe(DEFAULT_GEMINI_MODEL);
        expect(model.includes('abab')).toBe(false);
    });

    it('still routes high-value tasks to Minimax when its key IS provisioned', () => {
        mocks.minimaxApiKey = 'mm-key';
        const model = cfo.negotiateModel('implement a class in typescript', DEFAULT_GEMINI_MODEL, { category: 'DEV', agentName: 'DevAgent' });
        expect(model).toBe('abab-6.5s-chat');
    });

    it('routes vision tasks to the Gemini default even with Minimax provisioned', () => {
        mocks.minimaxApiKey = 'mm-key';
        const model = cfo.negotiateModel('[VISION_REQUIRED] what is in this image', DEFAULT_GEMINI_MODEL, { hasImage: true });
        expect(model).toBe(DEFAULT_GEMINI_MODEL);
    });

    it('getFallbackChain contains no retired Gemini models', () => {
        for (const t of ['CODE', 'CREATIVE', 'GENERAL'] as const) {
            for (const m of cfo.getFallbackChain(t)) {
                expect(RETIRED).not.toContain(m);
            }
        }
    });
});
