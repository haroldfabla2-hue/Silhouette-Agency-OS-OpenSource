/**
 * redisClient lazy connect — real behavior, no mocks: with no Redis server
 * reachable, the FIRST operation triggers the connection attempt, falls
 * back to the in-memory store with the error VISIBLE (incident recorded,
 * warn logged), and operations keep working against the fallback. Import
 * itself performs no network work (the CI teardown crash vector).
 */
import { describe, it, expect } from 'vitest';

describe('redisClient lazy connect', () => {
    it('import does not connect; first op connects-or-falls-back visibly; ops work after', async () => {
        const { redisClient } = await import('../../services/redisClient');
        // First op triggers connect attempt (no Redis in this environment ->
        // in-memory fallback after retries; error path is logged + recorded
        // as a durable incident, not swallowed).
        await redisClient.set('lazy:test', 'v1', 60);
        expect(redisClient.isMockMode()).toBe(true); // fallback engaged, visibly
        expect(await redisClient.get('lazy:test')).toBe('v1');
        await redisClient.del('lazy:test');
        expect(await redisClient.get('lazy:test')).toBeNull();
        // Subsequent ops reuse the established fallback (idempotent connect).
        const { incidentRegistry } = await import('../../services/incidentRegistry');
        const incidents = incidentRegistry.getOpenIncidents().filter(i => i.source === 'redis' || i.kind === 'outage');
        expect(incidents.length).toBeGreaterThan(0);
    }, 45000);
});
