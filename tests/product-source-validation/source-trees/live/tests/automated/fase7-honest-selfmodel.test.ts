import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// R9 root fix: circuits, hardware, swarm counts, provider states and versions
// were fabricated - HEALTHY-by-default, invented RAM/GPU, fixed "131 agents",
// "OPTIMAL"/"RTX 3050"/"12GB" strings, three disagreeing version numbers.
// Pinned contracts: measured or declared-unknown, never invented.

import { providerHealth } from '../../services/providerHealthManager';
import { BUILD_VERSION } from '../../constants/buildVersion';

// providerHealthManager -> continuumMemory boots dreamer/redis at import;
// drain and close deterministically (same pattern as memory-stats-route).
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

describe('R9 provider circuit states are measured, not assumed', () => {
    it('a never-measured provider is UNKNOWN, never HEALTHY', () => {
        const stats = providerHealth.getHealthStats();
        for (const [_id, s] of Object.entries(stats)) {
            expect(['VERIFIED', 'REACHABLE', 'UNKNOWN', 'NOT_CONFIGURED', 'SUSPENDED']).toContain(s.status);
            expect(s.status).not.toBe('HEALTHY');
        }
        expect((providerHealth as any).getOrInitState(`never-seen-${Date.now()}`).status).toBe('UNKNOWN');
    });

    it('VERIFIED only after a real success; SUSPENDED after failures', () => {
        const id = `test-provider-${Date.now()}`;
        providerHealth.reportSuccess(id);
        expect(providerHealth.getHealthStats()[id].status).toBe('VERIFIED');

        providerHealth.suspendProvider(id, 60_000, 'test suspension');
        expect(providerHealth.getHealthStats()[id].status).toBe('SUSPENDED');
        expect(providerHealth.isAvailable(id)).toBe(false);
        expect(providerHealth.getBackoffTime(id)).toBeGreaterThan(0);
    });

    it('enriched stats mark providers without credentials NOT_CONFIGURED', async () => {
        delete process.env.GROQ_API_KEY; // ensure unconfigured for the check
        const stats = await providerHealth.getEnrichedHealthStats();
        expect(stats['groq']?.status).toBe('NOT_CONFIGURED');
        // every entry carries an honest measured state
        for (const s of Object.values(stats)) {
            expect(s.status).not.toBe('HEALTHY');
        }
    });
});

describe('R9 no fabricated hardware / swarm / status anywhere', () => {
    it('getResources error path declares unavailability instead of simulated metrics', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/controllers/systemController.ts'), 'utf8');
        expect(src).not.toContain('simulated metrics as fallback');
        expect(src).toContain("'Hardware metrics unavailable'");
        // no invented RAM/VRAM defaults in telemetry
        expect(src).not.toContain('total: 16 * 1024 * 1024 * 1024 };');
        expect(src).not.toContain('let vramTotal = 4096');
    });

    it('UI carries no invented GPU model, agent count, or status', () => {
        const sidebar = fs.readFileSync(path.join(ROOT, 'components/Sidebar.tsx'), 'utf8');
        // rendered JSX text, not comments documenting the fix
        expect(sidebar).not.toMatch(/>\s*RTX 3050\s*</);
        expect(sidebar).not.toContain("label: 'Agent Swarm (131)'");
        expect(sidebar).not.toMatch(/>\s*OPTIMAL\s*</);
        const dashboard = fs.readFileSync(path.join(ROOT, 'components/Dashboard.tsx'), 'utf8');
        expect(dashboard).not.toContain('VRAM: 12GB');
    });

    it('provider status endpoint is catalog-driven with no HEALTHY default', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/controllers/chatController.ts'), 'utf8');
        expect(src).not.toContain("|| 'HEALTHY'");
        expect(src).toContain('getEnrichedHealthStats()');
    });
});

describe('R9 single build version', () => {
    it('BUILD_VERSION matches package.json and prompts use it', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(BUILD_VERSION).toBe(pkg.version);
        const compiler = fs.readFileSync(path.join(ROOT, 'services/promptCompiler.ts'), 'utf8');
        expect(compiler).not.toContain('(v2.0)');
        expect(compiler).toContain('${BUILD_VERSION}');
    });
});
