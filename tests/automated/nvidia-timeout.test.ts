import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../services/llm/providerRegistry';

describe('NVIDIA provider timeout', () => {
    it('allows 90s per call: the NIM free tier queues under load (measured 56.6s live)', () => {
        const def = ProviderRegistry.fromEnvironment().get('NVIDIA');
        expect(def).toBeDefined();
        expect(def!.timeoutMs).toBe(90000);
    });
});
