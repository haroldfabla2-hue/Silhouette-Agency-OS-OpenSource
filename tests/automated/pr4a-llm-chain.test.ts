/**
 * [PR-4a] LLM chain repairs:
 * 1. Per-model provider health: a quota suspension on one Gemini model must
 *    not suspend the provider's other models (prod incident 2026-10-16: a
 *    429 with 12.4h Retry-After on one flash model killed a live lite model).
 * 2. Local Ollama out of the fallback chain by default (owner decision:
 *    server too small); honest degradation when no provider is left.
 * 3. Ollama Cloud (free tier) as a registered OpenAI-compatible provider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';

// Retain the actual graph before assertions can throw or reset can invalidate it.
async function ownedHealthGraph() {
    const health = await import('../../services/providerHealthManager');
    // Start ownership capture without waiting for core/initial or adding a
    // prerequisite hydration await before the existing eight synchronous calls.
    const graph = Promise.all([
        import('../../services/continuumMemory'),
        import('../../services/introspectionEngine'),
        import('../../services/redisClient')
    ]).then(([memory, initial, redis]) => ({ providerHealth: health.providerHealth,
        continuum: memory.continuum, introspection: initial.introspection,
        redisClient: redis.redisClient }));
    // Observe rejection now; retain the original owner for the hook below.
    void graph.catch(() => {});
    healthGraphs.push(graph);
    return health;
}

type HealthGraph = {
    providerHealth: typeof import('../../services/providerHealthManager').providerHealth;
    continuum: typeof import('../../services/continuumMemory').continuum;
    introspection: typeof import('../../services/introspectionEngine').introspection;
    redisClient: typeof import('../../services/redisClient').redisClient;
};
const healthGraphs: Promise<HealthGraph>[] = [];

async function settleHealthGraphs() {
    const failures: unknown[] = [];
    for (const owner of healthGraphs.splice(0)) {
        let graph: HealthGraph | undefined;
        try {
            graph = await owner;
            // Observe original core and initial owners independently. Initial
            // settlement alone does not include its post-store effect receipt.
            const bootstrap = await Promise.allSettled([graph.continuum.readyCore(), graph.introspection.readyInitial()]);
            for (const result of bootstrap) if (result.status === 'rejected') failures.push(result.reason);
            // Collect every reachable owner before validation/logging can throw.
            const effectOwner = graph.introspection.getInitialConceptEffectOwner();
            const effects = await Promise.allSettled([
                graph.providerHealth.settlePersistence(),
                graph.continuum.settleMemoryEffects(),
                ...(effectOwner ? [effectOwner] : [])
            ]);
            for (const result of effects) if (result.status === 'rejected') failures.push(result.reason);
            const core = graph.continuum.getCoreRecoveryReport();
            expect(core?.outcome).not.toBe('FAILED');
            // DEGRADED remains distinct and visible, not renamed COMPLETE.
            console.log('PR4A_CORE_RECOVERY:', core);
            const initial = graph.introspection.getInitialWorkStatus();
            expect(initial.concept.state).toBe('COMPLETE');
            expect(initial.goals.state).toBe('COMPLETE');
            expect(graph.continuum.getSnapshotOperations()).toEqual([]);
            expect(graph.continuum.getMemoryEffectOperations()).toEqual([]);
            expect(graph.providerHealth.getPersistenceStatus().operations).toEqual([]);
            if (effectOwner) expect((await effectOwner).state).toBe('COMPLETE');
        } catch (error) { failures.push(error); }
        finally {
            if (graph) {
                try { await graph.redisClient.disconnect(); }
                catch (error) { failures.push(error); }
            }
        }
    }
    if (failures.length) throw new AggregateError(failures, 'Actual health bootstrap/effects remained failed; no reset or persistence success implied');
}

describe('PR-4a per-model provider health', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(settleHealthGraphs);

    it('suspending one model leaves sibling models of the same provider available', async () => {
        const { providerHealth } = await ownedHealthGraph();
        providerHealth.suspendProvider('gemini:gemini-3.6-flash', 60_000, '429 quota');
        expect(providerHealth.isAvailable('gemini:gemini-3.6-flash')).toBe(false);
        expect(providerHealth.isAvailable('gemini:gemini-3.1-flash-lite')).toBe(true);
    });

    it('per-model failure tiers do not leak across models', async () => {
        const { providerHealth } = await ownedHealthGraph();
        const operations = [];
        for (let i = 0; i < 8; i++) {
            const operation = providerHealth.reportFailure('gemini:model-a', 'boom');
            expect(providerHealth.observePersistence(operation, 'test:pr4a')).toBe(true);
            operations.push(operation);
        }
        expect(new Set(operations.map(operation => operation.operationId)).size).toBe(8);
        expect(providerHealth.getPersistenceStatus().operations.filter(row =>
            operations.some(operation => operation.operationId === row.operationId)).every(row => row.state === 'PENDING')).toBe(true);
        const outcomes = await Promise.all(operations.map(operation => operation.completion));
        for (const outcome of outcomes) {
            expect(outcome.state).not.toBe('NOT_ADMITTED');
            expect(outcome.state).not.toBe('CANONICAL_FAILED_PARTIAL_POSSIBLE');
            expect(outcome.state).not.toBe('OBSERVATION_FAILED');
            expect(outcome.state).not.toBe('EFFECTS_FAILED');
            // STORE_RETURNED_UNCONFIRMED is retained, not mislabeled persisted.
        }
        expect(providerHealth.isAvailable('gemini:model-a')).toBe(false);
        expect(providerHealth.isAvailable('gemini:model-b')).toBe(true);
    });
});

describe('PR-4a provider registry', () => {
    const ORIG = { ...process.env };
    afterEach(() => { process.env = { ...ORIG }; vi.resetModules(); });

    it('registers Ollama Cloud as openai-compatible free-tier provider', async () => {
        const { builtInProviders } = await import('../../services/llm/providerRegistry');
        const oc = builtInProviders.find(p => p.id === 'OLLAMA_CLOUD');
        expect(oc).toBeDefined();
        expect(oc!.transport).toBe('openai-compatible');
        expect(oc!.baseUrl).toBe('https://ollama.com/v1');
        expect(oc!.apiKeyEnv).toBe('OLLAMA_CLOUD_API_KEY');
        expect(oc!.modelEnv).toBe('OLLAMA_CLOUD_MODEL');
        expect(oc!.model).toBe('gpt-oss:20b');
    });

    it('local Ollama is out of the chain by default', async () => {
        delete process.env.OLLAMA_LOCAL_ENABLED;
        vi.resetModules();
        const { builtInProviders } = await import('../../services/llm/providerRegistry');
        expect(builtInProviders.find(p => p.id === 'OLLAMA')).toBeUndefined();
    });

    it('local Ollama re-enters only with explicit OLLAMA_LOCAL_ENABLED=true', async () => {
        process.env.OLLAMA_LOCAL_ENABLED = 'true';
        vi.resetModules();
        const { builtInProviders } = await import('../../services/llm/providerRegistry');
        const local = builtInProviders.find(p => p.id === 'OLLAMA');
        expect(local).toBeDefined();
        expect(local!.model).toBe('qwen3:4b');
    });
});

describe('PR-4a source contracts', () => {
    it('geminiService tracks Gemini health per model, not per provider', () => {
        const src = fs.readFileSync('services/geminiService.ts', 'utf8');
        expect(src).toContain('`gemini:${negotiatedModel}`');
        expect(src).not.toContain("isAvailable('gemini')");
        expect(src).not.toContain("reportFailure('gemini',");
    });

    it('local hive mind is behind OLLAMA_LOCAL_ENABLED with honest degradation', () => {
        const src = fs.readFileSync('services/geminiService.ts', 'utf8');
        const i = src.indexOf('Switching to LOCAL HIVE MIND');
        expect(i).toBeGreaterThan(-1);
        const region = src.slice(Math.max(0, i - 900), i);
        expect(region).toContain("OLLAMA_LOCAL_ENABLED === 'true'");
        expect(src).toContain('Degrading honestly');
    });

    it('ollamaService has no hardcoded default model names', () => {
        const src = fs.readFileSync('services/ollamaService.ts', 'utf8');
        expect(src).not.toContain("'mamba_native'");
        expect(src).not.toContain("'glm4:light'");
        expect(src).toContain('OLLAMA_LOCAL_MODEL');
    });
});
