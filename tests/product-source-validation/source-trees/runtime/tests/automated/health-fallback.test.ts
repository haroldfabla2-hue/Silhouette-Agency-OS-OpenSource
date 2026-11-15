import { describe, it, expect } from 'vitest';
import { checkGraphHealth } from '../../server/routes/health';

type B = 'neo4j' | 'sqlite-fallback' | 'disabled';
const fake = (backend: B, run: () => Promise<unknown> = async () => [{ ping: 1 }]) => ({
    getBackendStatus: () => ({ backend, connected: backend === 'neo4j' }),
    runQuery: async (_q: string) => run(),
});

describe('health: dependency with a fallback reports the REAL backend', () => {
    it('SQLite fallback serving => degraded, never "up" (this was the lie)', async () => {
        let probed = false;
        const c = await checkGraphHealth(fake('sqlite-fallback', async () => { probed = true; return []; }));
        expect(c.status).toBe('degraded');
        expect(c.backend).toBe('sqlite-fallback');
        expect(c.note).toMatch(/SQLite fallback/);
        expect(probed).toBe(false); // must not run a fallback-answered query that would look like success
    });

    it('real Neo4j answering => up with latency', async () => {
        const c = await checkGraphHealth(fake('neo4j'));
        expect(c.status).toBe('up');
        expect(c.backend).toBe('neo4j');
        expect(typeof c.latencyMs).toBe('number');
    });

    it('Neo4j connected but probe fails => degraded with the error', async () => {
        const c = await checkGraphHealth(fake('neo4j', async () => { throw new Error('boom'); }));
        expect(c.status).toBe('degraded');
        expect(c.error).toBe('boom');
    });

    it('graph disabled by config (Lite Mode) => up, labelled disabled (not an outage)', async () => {
        const c = await checkGraphHealth(fake('disabled'));
        expect(c.status).toBe('up');
        expect(c.backend).toBe('disabled');
    });

    it('real graphService without a reachable Neo4j reports sqlite-fallback', async () => {
        const { graph } = await import('../../services/graphService');
        const s = graph.getBackendStatus();
        expect(['sqlite-fallback', 'disabled']).toContain(s.backend);
        expect(s.connected).toBe(false);
    });
});
