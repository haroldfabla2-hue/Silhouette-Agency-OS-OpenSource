import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// R11 root fix: memory stats came from snapshots and definitions that could
// disagree - a 30s cache served stale counts after writes, deep was counted
// from a different source than the node listing (raw Qdrant count vs deduped
// merge), avgHealth was a fixed 100, and the UI compared mixed revisions.
// Pinned contracts: revision-bumped invalidation, one dedup definition for
// listing AND stats, measured health or null, snapshot carries revision+date.

import { continuum } from '../../services/continuumMemory';
import { MemoryTier } from '../../types';

afterAll(async () => {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    mod.dreamer?.stopDreamingLoop();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect();
});

const ROOT = path.resolve(__dirname, '..', '..');

describe('R11 stats snapshot consistency', () => {
    it('stats carry revision + timestamp and invalidate on write', async () => {
        const before = await continuum.getStats();
        expect(typeof before.revision).toBe('number');
        expect(typeof before.timestamp).toBe('number');

        await continuum.store(`r11-marker-${Date.now()}`, MemoryTier.LONG, ['r11-test']);
        const after = await continuum.getStats();

        // a write must be visible immediately - no 30s stale window
        expect(after.revision).toBeGreaterThan(before.revision);
        expect(after.total).toBe(before.total + 1);
        // cleanup: remove the marker (also bumps revision)
        const nodes = await continuum.getAllNodes();
        const marker = (nodes[MemoryTier.LONG] || []).find((n: any) => n.content.includes('r11-marker-'));
        if (marker) await continuum.deleteNode(marker.id);
    });

    it('health is measured from real nodes, never a fixed 100', async () => {
        const stats = await continuum.getStats();
        // null (nothing to measure) or an average of real decayHealth values
        if (stats.avgHealth !== null) {
            expect(stats.avgHealth).toBeGreaterThanOrEqual(0);
            expect(stats.avgHealth).toBeLessThanOrEqual(100);
        }
        const src = fs.readFileSync(path.join(ROOT, 'services/continuumMemory.ts'), 'utf8');
        expect(src).not.toContain('avgHealth: 100,');
    });

    it('deep uses the same dedup definition as the node listing', async () => {
        const src = fs.readFileSync(path.join(ROOT, 'services/continuumMemory.ts'), 'utf8');
        // stats no longer read the raw vector count as the deep total
        expect(src).not.toContain('deep: vectorStats.count,');
        expect(src).toContain('deepMap.set(v.id, v)');
        // raw qdrant total stays visible under its own honest name
        const stats = await continuum.getStats();
        expect(typeof stats.deep).toBe('number');
        expect(typeof stats.deepVectors).toBe('number');
    });

    it('/v1/memory/state returns one snapshot with shared revision + timestamp', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/routes/v1/memory.routes.ts'), 'utf8');
        expect(src).toContain('revision: stats.revision');
        expect(src).toContain('timestamp: stats.timestamp');
    });
});
