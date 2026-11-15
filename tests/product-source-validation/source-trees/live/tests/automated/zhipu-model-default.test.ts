/**
 * Zhipu model default fix — 'glm-4-flash' returns API 1211 (model does not
 * exist), verified live 2026-10-15; 'glm-4.5-flash' answers HTTP 200 on the
 * free tier; glm-4.5 requires paid balance. The default is now env-driven
 * (ZHIPU_MODEL) with 'glm-4.5-flash' as the verified fallback.
 * Hermetic: constructor-injected fetcher and env.
 */

import { describe, it, expect } from 'vitest';
import { ZhipuService } from '../../services/zhipuService';

const FAST: any = {
    MAX_CONCURRENT_PER_KEY: 1,
    SUSPENSION_THRESHOLD: 3,
    SUSPENSION_BASE_MS: 50,
    SUSPENSION_MAX_MS: 100,
    STARVATION_OVERRIDE_MS: 200,
    QUEUE_MAX_SIZE: 10,
    QUEUE_SOFT_LIMIT: 5,
    QUEUE_HARD_LIMIT: 8,
    QUEUE_TIMEOUT_MS: 30000,
    CONVERSATIONAL_STREAK_LIMIT: 3,
    QUEUE_RETRY_MS: 20
};

function makeFetcher(calls: any[]) {
    return (async (_url: any, init: any) => {
        calls.push(JSON.parse(init.body));
        return new Response(JSON.stringify({
            choices: [{ message: { content: 'ok' } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
}

describe('Zhipu model default', () => {
    it('defaults to glm-4.5-flash (verified live) when ZHIPU_MODEL is unset', async () => {
        const calls: any[] = [];
        const svc = new ZhipuService(FAST, { ZHIPU_API_KEYS: 'k1' } as any, makeFetcher(calls));
        const out = await svc.generateCompletion('ping', { maxTokens: 4 }, 'agents');
        expect(out).toBe('ok');
        expect(calls[0].model).toBe('glm-4.5-flash');
    });

    it('honors ZHIPU_MODEL env override', async () => {
        const calls: any[] = [];
        const svc = new ZhipuService(FAST, { ZHIPU_API_KEYS: 'k1', ZHIPU_MODEL: 'glm-custom' } as any, makeFetcher(calls));
        await svc.generateCompletion('ping', { maxTokens: 4 }, 'agents');
        expect(calls[0].model).toBe('glm-custom');
    });

    it('an explicit options.model always wins', async () => {
        const calls: any[] = [];
        const svc = new ZhipuService(FAST, { ZHIPU_API_KEYS: 'k1', ZHIPU_MODEL: 'glm-custom' } as any, makeFetcher(calls));
        await svc.generateCompletion('ping', { model: 'glm-explicit', maxTokens: 4 }, 'agents');
        expect(calls[0].model).toBe('glm-explicit');
    });
});
