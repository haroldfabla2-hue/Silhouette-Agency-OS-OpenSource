import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'crypto';

// R6 root fix: backend failures went to console only, self-healing declared
// "healthy" when its log file was missing, and the narrator silently mapped
// every perception failure to "zero incidents". Pinned contracts:
// 1. Durable incident registry: one open incident per episode, recovery
//    resolves the SAME incident.
// 2. Narrator perception distinguishes SENSE UNAVAILABLE from zero, and a new
//    verified fact reaches it from the durable repository with Neo4j down.
// 3. Self-healing never conflates a missing log source with zero errors.

import { incidentRegistry } from '../../services/incidentRegistry';
import { factRepository } from '../../services/memory/factRepository';
import fs from 'fs';
import path from 'path';

// factRepository -> continuumMemory boots dreamer/redis at import; drain and
// close deterministically (same pattern as memory-stats-route.test.ts).
afterAll(async () => {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    mod.dreamer?.stopDreamingLoop();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect();
});

describe('R6 incident registry', () => {
    it('one episode = one incident; repeats bump the counter; recovery resolves the same incident', () => {
        const source = `test-src-${crypto.randomUUID()}`;
        const first = incidentRegistry.recordIncident(source, 'outage', 'backend down');
        expect(first.created).toBe(true);

        const repeat = incidentRegistry.recordIncident(source, 'outage', 'backend down');
        expect(repeat.id).toBe(first.id);
        expect(repeat.created).toBe(false);

        let open = incidentRegistry.getOpenIncidents().filter(i => i.source === source);
        expect(open).toHaveLength(1);
        expect(open[0].occurrenceCount).toBe(2);

        const closed = incidentRegistry.resolveIncidents(source);
        expect(closed).toBe(1);

        open = incidentRegistry.getOpenIncidents().filter(i => i.source === source);
        expect(open).toHaveLength(0);

        // the row survives as resolved history (evidence, not erasure)
        const recent = incidentRegistry.getRecentIncidents(50).filter(i => i.source === source);
        expect(recent).toHaveLength(1);
        expect(recent[0].status).toBe('resolved');
        expect(recent[0].resolvedAt).not.toBeNull();
    });

    it('resolve with kind filter only closes that kind', () => {
        const source = `test-src-${crypto.randomUUID()}`;
        incidentRegistry.recordIncident(source, 'outage', 'backend down');
        incidentRegistry.recordIncident(source, 'error', 'query failed');
        const closed = incidentRegistry.resolveIncidents(source, 'outage');
        expect(closed).toBe(1);
        const open = incidentRegistry.getOpenIncidents().filter(i => i.source === source);
        expect(open).toHaveLength(1);
        expect(open[0].kind).toBe('error');
        incidentRegistry.resolveIncidents(source);
    });
});

describe('R6 narrator perception: unavailable is not zero', () => {
    it('a new verified fact reaches the narrator from the durable repository even with Neo4j down', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const marker = `perception-marker-${crypto.randomUUID()}`;
        await factRepository.addFact({
            type: 'FACT', content: marker, source: 'USER_STATED',
            quote: marker, status: 'verified', confidence: 0.9
        }, `narrator-test-${crypto.randomUUID()}`);

        const sensory: any = await (thoughtNarrator as any).perceiveGraph();
        // facts arrive from SQLite regardless of graph availability
        expect(sensory.userFacts.some((f: any) => f.content === marker)).toBe(true);
        // and graph availability is a declared boolean, never a silent zero
        expect(typeof sensory.available).toBe('boolean');
    });

    it('open incidents reach the narrator as pain signals', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const source = `test-src-${crypto.randomUUID()}`;
        incidentRegistry.recordIncident(source, 'outage', 'backend down');

        const sensory: any = await (thoughtNarrator as any).perceiveErrors();
        expect(sensory.available).toBe(true);
        expect(sensory.errors.some((e: any) => e.message.includes('OPEN INCIDENT') && e.message.includes(source))).toBe(true);

        incidentRegistry.resolveIncidents(source);
        const after: any = await (thoughtNarrator as any).perceiveErrors();
        expect(after.errors.some((e: any) => e.message.includes(source))).toBe(false);
    });

    it('buildSensoryReport declares a lost sense explicitly instead of reporting zero', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const report = (thoughtNarrator as any).buildSensoryReport(
            { triangles: [], hubs: [], userFacts: [], smallWorldSigma: 0, available: false },
            { errors: [], available: false },
            { pressure: 0, total: 0, deepCount: 0, available: false }
        );
        expect(report).toContain('SENSE UNAVAILABLE');
        expect(report).toContain('NOT zero connections');
        expect(report).toContain('NOT zero errors');
    });
});

describe('R6 self-healing honesty (source contract)', () => {
    it('missing log file is declared an unavailable source, never "System healthy"', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../services/daemon/selfHealingTask.ts'), 'utf8');
        expect(src).toContain('NOT the same as zero errors');
        expect(src).not.toContain('No error log found. System healthy.');
    });

    it('open incidents are fed to the learning pipeline even with an empty log', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../services/daemon/selfHealingTask.ts'), 'utf8');
        expect(src).toContain('incidentRegistry.getOpenIncidents()');
        expect(src).toContain('SYSTEM_INCIDENT');
    });
});
