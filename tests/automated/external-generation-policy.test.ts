/**
 * ExternalGenerationPolicy - the REAL implementation, no doubles.
 *
 * Asserts the hard block holds under every env condition a boolean-override
 * design would have honored: the (removed) legacy allow flag set, a provider
 * key present, and quota-budget env present. Presence of keys/budgets is not
 * entitlement and a boolean is not monetary authority. No real API calls;
 * placeholder values only (no real secrets); env is snapshotted and restored.
 *
 * Scope: policy unit only. This is NOT an end-to-end proof - route + real
 * service + gate together are exercised separately (declared doubles there).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    assertCampaignLlmGenerationAllowed,
    ExternalGenerationDeniedError
} from '../../services/security/externalGenerationPolicy';

const ENV_VARS = [
    'CAMPAIGN_LLM_GENERATION',
    'GEMINI_API_KEY',
    'API_KEY',
    'QUOTA_DAILY_BUDGET_GEMINI_GEMINI_3_8_FLASH',
    'QUOTA_DAILY_BUDGET_GEMINI',
    'QUOTA_DAILY_BUDGET'
] as const;

const snapshot: Record<string, string | undefined> = {};
for (const k of ENV_VARS) snapshot[k] = process.env[k];

afterEach(() => {
    for (const k of ENV_VARS) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
    }
});

function expectDenied() {
    try {
        assertCampaignLlmGenerationAllowed();
        expect.unreachable('gate must deny');
    } catch (e: any) {
        expect(e).toBeInstanceOf(ExternalGenerationDeniedError);
        expect(e.code).toBe('EXTERNAL_GENERATION_DENIED');
    }
}

describe('externalGenerationPolicy (real implementation, hard block)', () => {
    it('denies under default env (no flag, no key, no budget)', () => {
        for (const k of ENV_VARS) delete process.env[k];
        expectDenied();
    });

    it('denies even with the legacy allow flag set (a boolean is not monetary authority)', () => {
        process.env.CAMPAIGN_LLM_GENERATION = 'allow';
        expectDenied();
    });

    it('denies even with a provider key present (presence is not entitlement)', () => {
        process.env.GEMINI_API_KEY = 'test-presence-only-placeholder';
        expectDenied();
    });

    it('denies even with quota-budget env present (budget is accounting, not authorization)', () => {
        process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_3_8_FLASH = '15';
        process.env.QUOTA_DAILY_BUDGET_GEMINI = '50';
        process.env.QUOTA_DAILY_BUDGET = '100';
        expectDenied();
    });

    it('denies with ALL of the above combined', () => {
        process.env.CAMPAIGN_LLM_GENERATION = 'allow';
        process.env.GEMINI_API_KEY = 'test-presence-only-placeholder';
        process.env.QUOTA_DAILY_BUDGET = '100';
        expectDenied();
    });
});
