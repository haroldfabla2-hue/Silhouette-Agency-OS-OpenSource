import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Neo4j is unreachable in CI (no server), so the real graphService runs on its SQLite fallback.
// Regressions covered:
//  1. getRelatedConcepts / findOpenTriangles / getUserFacts returned [] in fallback mode (guard used the method reference
//     `this.isConnected`, always truthy, plus `!this.driver`) although the fallback implements those queries.
//  2. every graph query while Neo4j was down blocked ~6 s (3 retries with backoff) and re-fired a CRITICAL alert.
//  3. the nervous system's truthful neo4j check was overwritten by an always-healthy one after the first connect.
//  4. the WebSocket graph.health reported 'connected' regardless of backend.

const P = `t_gr_${Date.now()}_`;
const ids = { a: `${P}a`, b: `${P}b`, c: `${P}c`, u: `${P}u`, f: `${P}f` };
let sqlite: any;
let graph: any;

beforeAll(async () => {
    process.env.NEO4J_URI = 'bolt://127.0.0.1:1'; // guaranteed unreachable
    process.env.GRAPH_CONNECT_COOLDOWN_MS = '60000';
    ({ sqliteService: sqlite } = await import('../../services/sqliteService'));
    ({ graph } = await import('../../services/graphService'));
    const now = Date.now();
    const node = (id: string, label: string, name: string, props: any) =>
        sqlite.db.prepare('INSERT OR REPLACE INTO graph_nodes (id,label,name,properties,last_updated) VALUES (?,?,?,?,?)')
            .run(id, label, name, JSON.stringify({ id, name, ...props }), now);
    const edge = (s: string, t: string, type: string) =>
        sqlite.db.prepare('INSERT OR REPLACE INTO graph_edges (source,target,type,properties,last_updated) VALUES (?,?,?,?,?)')
            .run(s, t, type, '{}', now);
    node(ids.a, 'Concept', 'A', {}); node(ids.b, 'Concept', 'B', {}); node(ids.c, 'Concept', 'C', {});
    edge(ids.a, ids.c, 'RELATED'); edge(ids.b, ids.c, 'RELATED'); // A-C-B open triangle, A and B not related
    node(ids.u, 'User', 'U', {});
    node(ids.f, 'Fact', 'F', { category: 'pref', content: 'prefiere espanol', confidence: 0.8, timestamp: now });
    edge(ids.u, ids.f, 'HAS_FACT');
});

afterAll(() => {
    for (const id of Object.values(ids)) sqlite?.db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(id);
});

describe('graph in SQLite-fallback mode keeps its capabilities', () => {
    it('getRelatedConcepts returns neighbours from the fallback (was always [])', async () => {
        const r = await graph.getRelatedConcepts([ids.a]);
        expect(r.some((x: any) => x.relatedId === ids.c)).toBe(true);
    }, 30000);

    it('findOpenTriangles finds the A-C-B triangle with the shape callers read (was always [])', async () => {
        const t = await graph.findOpenTriangles(50);
        const mine = t.find((x: any) => x.bridge?.id === ids.c);
        expect(mine).toBeTruthy();
        expect([mine.nodeA.id, mine.nodeB.id].sort()).toEqual([ids.a, ids.b].sort());
    }, 30000);

    it('getUserFacts returns the stored fact from the fallback (was []), and nothing for an unknown user (negative)', async () => {
        const facts = await graph.getUserFacts(ids.u);
        expect(facts.map((f: any) => f.content)).toContain('prefiere espanol');
        expect(await graph.getUserFacts(`${P}nobody`)).toEqual([]);
    }, 30000);
});

describe('circuit breaker: Neo4j down must not stall every query', () => {
    it('after one failed connect, the next queries answer immediately and no new alert fires', async () => {
        const { systemBus } = await import('../../services/systemBus');
        const alerts: any[] = [];
        systemBus.subscribe('PROTOCOL_SYSTEM_ALERT' as any, (e: any) => { if (e?.payload?.component === 'Neo4j') alerts.push(e); });
        await graph.getRelatedConcepts([ids.a]); // may pay the first (and only) retry cost
        const t0 = Date.now();
        for (let i = 0; i < 5; i++) await graph.getRelatedConcepts([ids.a]);
        expect(Date.now() - t0).toBeLessThan(1500); // 5 queries, previously ~30 s
        const afterBurst = alerts.length;
        await graph.getRelatedConcepts([ids.a]);
        expect(alerts.length).toBe(afterBurst);
        expect(afterBurst).toBeLessThanOrEqual(1);
    }, 60000);

    it('force=true bypasses the cooldown (nervous-system reconnect still really retries)', async () => {
        const t0 = Date.now();
        const ok = await graph.connect(1, 10, true);
        expect(ok).toBe(false);
        expect(Date.now() - t0).toBeLessThan(5000);
        expect((graph as any).connectCooldownUntil).toBeGreaterThan(Date.now()); // cooldown re-armed after the failed forced attempt
    }, 30000);
});

describe('nervous system sees the real state', () => {
    it('probeHealth is false while Neo4j is down in fallback (the old check was always true)', async () => {
        expect(graph.getBackendStatus().connected).toBe(false);
        expect(await graph.probeHealth()).toBe(false);
    });

    it('an on-purpose idle close is not an outage (healthy), an unreachable server is', async () => {
        (graph as any).idleClosed = true;
        expect(await graph.probeHealth()).toBe(true);
        (graph as any).idleClosed = false;
        expect(await graph.probeHealth()).toBe(false);
    });

    it('graphService does not overwrite an existing neo4j registration', async () => {
        const { nervousSystem } = await import('../../services/connectionNervousSystem');
        const marker = async () => true;
        nervousSystem.register({ id: 'neo4j', name: 'Neo4j Graph', type: 'DATABASE', isRequired: false, checkHealth: marker, reconnect: async () => true } as any);
        (graph as any).isRegistered = false;
        (graph as any).registerWithNervousSystem();
        expect((nervousSystem as any).connections.get('neo4j').checkHealth).toBe(marker);
    });

    it('boot registration uses the real probe, not isConnected-or-true', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../services/connectionNervousSystem.ts'), 'utf8');
        expect(src).toMatch(/checkHealth:\s*\(\)\s*=>\s*graph\.probeHealth\(\)/);
        const g = fs.readFileSync(path.resolve(__dirname, '../../services/graphService.ts'), 'utf8');
        expect(g).not.toMatch(/_isConnected \|\| true/);
        expect(g).not.toMatch(/!this\.isConnected\s*\|\|/);
    });
});

describe('websocket graph.health tells the truth', () => {
    it('is derived from getBackendStatus, not the always-true isConnectedStatus', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../server/gateway/wsGateway.ts'), 'utf8');
        const block = src.slice(src.indexOf("case 'graph.health'"), src.indexOf("case 'graph.health'") + 900);
        expect(block).toMatch(/getBackendStatus\(\)/);
        expect(block).not.toMatch(/isConnectedStatus/);
        expect(block).toMatch(/'degraded'/);
    });
});
