import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Fase 0 — "observing must not act, writes must be real"
 *
 * R3: GET /v1/system/full-state and GET /v1/telemetry/brain used to call
 *     thoughtNarrator.generateNarrative() — opening the dashboard THOUGHT,
 *     spent LLM tokens and could queue actions. Now they serve a read-only
 *     snapshot (getLatestNarrative); only the daemon or the explicit
 *     POST /v1/system/narrative/trigger may run a cycle.
 *
 * R5 (scoped): the SQLite graph fallback treated ANY Cypher containing
 *     "fact" as a SELECT — including CREATE/SET/DELETE — so fact writes
 *     silently never happened while logging success. Now writes execute for
 *     real or throw an explicit unsupported error.
 *
 * R2 (scoped): zhipuService.isAvailable() consumed a local token per call
 *     (via findBestKey), so health checks drained capacity without any
 *     inference. Now it is a pure check.
 */

// ────────────────────────────────────────────────────────────────────────────
// R2: zhipuService.isAvailable must not consume tokens
// ────────────────────────────────────────────────────────────────────────────
describe('zhipuService.isAvailable is a pure health check', () => {
    beforeAll(() => {
        vi.resetModules();
        process.env.ZHIPU_API_KEY = 'test-key-fase0-not-a-real-key';
    });

    afterAll(() => {
        delete process.env.ZHIPU_API_KEY;
    });

    it('repeated isAvailable() calls consume zero tokens', async () => {
        const { zhipuService } = await import('../../services/zhipuService');
        const svc = zhipuService as any;
        expect(svc.keys.length).toBeGreaterThan(0);

        const before = svc.keys.map((k: any) => k.tokens);
        for (let i = 0; i < 10; i++) {
            expect(zhipuService.isAvailable('agents')).toBe(true);
        }
        const after = svc.keys.map((k: any) => k.tokens);
        expect(after).toEqual(before);
    });

    it('dispatch (findBestKey) still consumes exactly one token', async () => {
        const { zhipuService } = await import('../../services/zhipuService');
        const svc = zhipuService as any;

        const totalBefore = svc.keys.reduce((n: number, k: any) => n + k.tokens, 0);
        const key = svc.findBestKey();
        expect(key).not.toBeNull();
        const totalAfter = svc.keys.reduce((n: number, k: any) => n + k.tokens, 0);
        expect(totalAfter).toBe(totalBefore - 1);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// R5: SQLite graph fallback executes Fact writes for real, fails honestly
// ────────────────────────────────────────────────────────────────────────────
describe('graphService SQLite fallback: fact writes are real', () => {
    const FACT_ID = 'fase0-test-fact-0001';
    const USER_ID = 'fase0-test-user';

    afterAll(async () => {
        // Clean up everything this suite created
        const { sqliteService } = await import('../../services/sqliteService');
        sqliteService.db.prepare('DELETE FROM graph_edges WHERE source = ? OR target = ?').run(USER_ID, FACT_ID);
        sqliteService.db.prepare('DELETE FROM graph_nodes WHERE id IN (?, ?)').run(FACT_ID, USER_ID);
    });

    it('CREATE (:Fact) writes the node instead of faking a SELECT', async () => {
        const { graph } = await import('../../services/graphService');
        const result = await (graph as any).runSqliteQuery(`
            CREATE (f:Fact {
                id: $id,
                type: $type,
                content: $content,
                confidence: $confidence,
                createdAt: timestamp(),
                source: 'CONVERSATION'
            })
        `, {
            id: FACT_ID,
            type: 'PERSONAL',
            content: 'El perro de prueba se llama Inti',
            confidence: 0.95
        });

        expect(result[0].created).toBe(1);
        expect(result[0].backend).toBe('sqlite');

        const { sqliteService } = await import('../../services/sqliteService');
        const row = sqliteService.db.prepare('SELECT label, properties FROM graph_nodes WHERE id = ?').get(FACT_ID) as any;
        expect(row).toBeTruthy();
        expect(row.label).toBe('Fact');
        const props = JSON.parse(row.properties);
        expect(props.content).toBe('El perro de prueba se llama Inti');
        expect(props.type).toBe('PERSONAL');
    });

    it('MERGE User + HAS_FACT links the fact to its owner', async () => {
        const { graph } = await import('../../services/graphService');
        const result = await (graph as any).runSqliteQuery(`
            MERGE (u:User {id: $userId})
            WITH u
            MATCH (f:Fact {id: $factId})
            MERGE (u)-[:HAS_FACT]->(f)
        `, { userId: USER_ID, factId: FACT_ID });
        expect(result[0].created).toBe(1);

        const { sqliteService } = await import('../../services/sqliteService');
        const edge = sqliteService.db.prepare(
            "SELECT * FROM graph_edges WHERE source = ? AND target = ? AND type = 'HAS_FACT'"
        ).get(USER_ID, FACT_ID);
        expect(edge).toBeTruthy();
    });

    it('the HAS_FACT read query returns the written fact with real fields', async () => {
        const { graph } = await import('../../services/graphService');
        const rows = await (graph as any).runSqliteQuery(
            'MATCH (u:User {id: $userId})-[:HAS_FACT]->(f:Fact) RETURN f',
            { userId: USER_ID }
        );
        const mine = rows.find((r: any) => r.content === 'El perro de prueba se llama Inti');
        expect(mine).toBeTruthy();
        // Writer stores type/createdAt — reader must map them, not default to 'general'
        expect(mine.category).toBe('PERSONAL');
        expect(typeof mine.timestamp).toBe('number');
    });

    it('SET updates the fact for real', async () => {
        const { graph } = await import('../../services/graphService');
        const result = await (graph as any).runSqliteQuery(`
            MATCH (f:Fact {id: $id})
            SET f.content = $content,
                f.confidence = $confidence,
                f.updatedAt = timestamp()
        `, { id: FACT_ID, content: 'El perro de prueba se llama Inti Corazón', confidence: 0.99 });
        expect(result[0].updated).toBe(1);

        const { sqliteService } = await import('../../services/sqliteService');
        const row = sqliteService.db.prepare('SELECT properties FROM graph_nodes WHERE id = ?').get(FACT_ID) as any;
        expect(JSON.parse(row.properties).content).toBe('El perro de prueba se llama Inti Corazón');
    });

    it('DETACH DELETE removes the fact and its edges for real', async () => {
        const { graph } = await import('../../services/graphService');
        const result = await (graph as any).runSqliteQuery(
            'MATCH (f:Fact {id: $id}) DETACH DELETE f',
            { id: FACT_ID }
        );
        expect(result[0].deleted).toBe(1);

        const { sqliteService } = await import('../../services/sqliteService');
        expect(sqliteService.db.prepare('SELECT id FROM graph_nodes WHERE id = ?').get(FACT_ID)).toBeUndefined();
        expect(sqliteService.db.prepare('SELECT * FROM graph_edges WHERE target = ?').get(FACT_ID)).toBeUndefined();
    });

    it('MERGE linking a missing fact fails honestly instead of pretending', async () => {
        const { graph } = await import('../../services/graphService');
        await expect((graph as any).runSqliteQuery(`
            MERGE (u:User {id: $userId})
            WITH u
            MATCH (f:Fact {id: $factId})
            MERGE (u)-[:HAS_FACT]->(f)
        `, { userId: USER_ID, factId: 'fact-that-does-not-exist' })).rejects.toThrow(/does not exist/);
    });

    it('unsupported write statements throw instead of returning fake read results', async () => {
        const { graph } = await import('../../services/graphService');
        await expect((graph as any).runSqliteQuery(
            'MATCH (n:SomethingElse) SET n.touched = $ts RETURN n',
            { ts: 123 }
        )).rejects.toThrow(/does not support this write statement/);
    });

    it('read queries containing "fact" still work (no regression on reads)', async () => {
        const { graph } = await import('../../services/graphService');
        const rows = await (graph as any).runSqliteQuery(
            'MATCH (u:User {id: $userId})-[:HAS_FACT]->(f:Fact) RETURN f',
            { userId: USER_ID }
        );
        expect(Array.isArray(rows)).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// R3: GET endpoints serve snapshots; they never generate thought
// ────────────────────────────────────────────────────────────────────────────
describe('observability endpoints never generate thought', () => {
    it('getFullState calls getLatestNarrative, NOT generateNarrative', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const genSpy = vi.spyOn(thoughtNarrator, 'generateNarrative');
        const latestSpy = vi.spyOn(thoughtNarrator, 'getLatestNarrative');

        const { systemController } = await import('../../server/controllers/systemController');
        const res: any = {
            statusCode: 200,
            body: null as any,
            json(payload: any) { this.body = payload; return this; },
            status(code: number) { this.statusCode = code; return this; }
        };

        await systemController.getFullState({} as any, res);

        expect(genSpy).not.toHaveBeenCalled();
        expect(latestSpy).toHaveBeenCalled();
        expect(res.body).toBeTruthy();
        // Snapshot shape: narrative text or honest null, never a freshly generated one
        expect(res.body.telemetry.brain).toHaveProperty('latestNarrative');
        expect(res.body.telemetry.brain).toHaveProperty('latestNarrativeAt');

        genSpy.mockRestore();
        latestSpy.mockRestore();
    });

    it('GET /v1/telemetry/brain also stays read-only', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(path.resolve(__dirname, '../../server/routes/telemetry.ts'), 'utf8');
        expect(src).not.toMatch(/generateNarrative\(/);
        expect(src).toMatch(/getLatestNarrative\(/);
    });

    it('full-state GET route carries no generation; manual trigger is an explicit POST', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(path.resolve(__dirname, '../../server/routes/v1/system.routes.ts'), 'utf8');
        expect(src).toMatch(/router\.get\('\/full-state'/);
        expect(src).toMatch(/router\.post\('\/narrative\/trigger'/);
    });
});

describe('thoughtNarrator cycle discipline', () => {
    it('getLatestNarrative is null before any cycle (honest absence, no fake zero)', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        // Fresh process: nothing generated. Cold-start restore may find old
        // epiphanies in the shared dev DB, so accept null OR a restored record
        // — but it must NEVER have called the LLM to produce it.
        const genSpy = vi.spyOn(thoughtNarrator as any, 'runConsciousnessCycle');
        const result = await thoughtNarrator.getLatestNarrative();
        expect(genSpy).not.toHaveBeenCalled();
        if (result !== null) {
            expect(result).toHaveProperty('text');
            expect(result).toHaveProperty('timestamp');
        }
        genSpy.mockRestore();
    });

    it('concurrent generateNarrative calls share one cycle (single-flight)', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const narrator = thoughtNarrator as any;

        // Stub the senses: no stimulus => the cycle exits before any LLM call
        narrator.perceiveGraph = async () => ({ triangles: [], hubs: [], userFacts: [] });
        narrator.perceiveErrors = async () => ({ errors: [] });
        narrator.perceiveMemory = async () => ({ pressure: 0 });

        const cycleSpy = vi.spyOn(narrator, 'runConsciousnessCycle');
        const [a, b] = await Promise.all([
            thoughtNarrator.generateNarrative('manual'),
            thoughtNarrator.generateNarrative('manual')
        ]);
        expect(cycleSpy).toHaveBeenCalledTimes(1);
        expect(a).toBeNull(); // no stimulus => no thought, no LLM call
        expect(b).toBeNull();
        cycleSpy.mockRestore();
    });
});
