import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// R8 root fix: backend returned {thoughts, layer, activeConcepts, isDreaming}
// while the UI read {recentThoughts, consciousnessMetrics, narrativeState,
// temporalContext} - every conditional UI update silently never fired, fixed
// version "v2.1.0" posed as build truth, socketConnected was never updated,
// and absent data rendered as fake zeros/VOID. Pinned contracts: one common
// typed snapshot, per-source availability, real link state, absent = N/A.

const ROOT = path.resolve(__dirname, '..', '..');

// behavioral imports pull continuumMemory (dreamer/redis): drain and close
afterAll(async () => {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    mod.dreamer?.stopDreamingLoop();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect();
});

describe('R8 common introspection snapshot', () => {
    it('backend serves the field names the UI actually consumes, with availability', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/controllers/systemController.ts'), 'utf8');
        for (const field of ['recentThoughts', 'intuition', 'consciousnessMetrics', 'narrativeState', 'temporalContext', 'available', 'timestamp', 'source', 'version']) {
            expect(src).toContain(field);
        }
        // narrative read must be the non-triggering one (fase0 contract holds)
        expect(src).toContain('getLatestNarrative()');
        expect(src).not.toContain('generateNarrative()');
        // legacy alias kept in sync for older consumers
        expect(src).toContain('snapshot.thoughts = snapshot.recentThoughts');
    });

    it('consciousness engine exposes real metrics for the snapshot', async () => {
        const { consciousness } = await import('../../services/consciousnessEngine');
        const metrics = consciousness.getMetrics();
        expect(metrics).toBeTruthy();
        expect(typeof metrics.phiScore).toBe('number');
        expect(typeof metrics.emergenceIndex).toBe('number');
    });

    it('narrator latest narrative is readable without triggering a cycle', async () => {
        const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const narrative = await thoughtNarrator.getLatestNarrative();
        // null (no narrative yet) or a shaped object - never a thrown cycle
        if (narrative !== null) {
            expect(typeof narrative.text).toBe('string');
            expect(typeof narrative.timestamp).toBe('number');
        }
    });
});

describe('R8 UI renders real state only', () => {
    it('no fixed version string; link state follows the poll', () => {
        const src = fs.readFileSync(path.join(ROOT, 'components/IntrospectionHub.tsx'), 'utf8');
        expect(src).not.toContain('v2.1.0');
        expect(src).toContain('APP_VERSION');
        expect(src).toContain('setSocketConnected(true)');
        expect(src).toContain('setSocketConnected(false)');
    });

    it('absent metrics render N/A, not fabricated zeros or VOID', () => {
        const src = fs.readFileSync(path.join(ROOT, 'components/IntrospectionHub.tsx'), 'utf8');
        expect(src).not.toContain('(conscMetrics?.phiScore || 0)');
        expect(src).not.toContain('(conscMetrics?.emergenceIndex || 0)');
        expect(src).not.toContain("(conscMetrics?.selfRecognition || 0)");
        expect(src).not.toContain("'VOID'");
        expect(src).toContain("'N/A'");
    });
});
