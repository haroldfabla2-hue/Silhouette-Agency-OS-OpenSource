/**
 * Tanda 1 truthfulness remediation tests.
 *
 * Guards against re-introducing fabricated data paths:
 *  A1 - dashboard token history comes from real telemetry samples
 *  A2 - video worker reports UNAVAILABLE instead of a fake result
 *  B1 - no personal email hardcoded as CREATOR default
 *  A4 - install scan is derived from the real filesystem / routes / schema
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildTokenHistory } from '../../services/telemetryHistory';
import { extractRoutePaths, listFrontendComponents, listBackendEndpoints, buildSystemMap } from '../../server/lib/installScanner';

describe('A1: buildTokenHistory (real telemetry bucketing)', () => {
    const now = 1_800_000_000_000;
    it('returns [] when there are no samples (honest empty state)', () => {
        expect(buildTokenHistory([], now)).toEqual([]);
    });
    it('computes per-minute deltas from a cumulative counter', () => {
        const minute = 60_000;
        const samples = [
            { ts: now - 3 * minute, totalTokens: 1000, totalCost: 0 },
            { ts: now - 2 * minute, totalTokens: 1300, totalCost: 0 },
            { ts: now - 1 * minute, totalTokens: 1750, totalCost: 0 },
        ];
        const history = buildTokenHistory(samples, now, 10);
        expect(history).toHaveLength(11);
        expect(history.find(p => p.time === '-2m')?.tokens).toBe(300);
        expect(history.find(p => p.time === '-1m')?.tokens).toBe(450);
        expect(history.reduce((a, p) => a + p.tokens, 0)).toBe(750);
    });
    it('clamps counter resets (restart) to zero instead of negative traffic', () => {
        const minute = 60_000;
        const samples = [
            { ts: now - 2 * minute, totalTokens: 5000, totalCost: 0 },
            { ts: now - 1 * minute, totalTokens: 50, totalCost: 0 }, // reset
        ];
        const history = buildTokenHistory(samples, now, 10);
        expect(history.find(p => p.time === '-1m')?.tokens).toBe(0);
    });
});

describe('A2: video worker honesty without a provider key', () => {
    beforeEach(() => {
        vi.resetModules();
        delete process.env.REPLICATE_API_TOKEN;
    });
    it('emits INCIDENT_REPORT with UNAVAILABLE and never a fake TASK_COMPLETION', async () => {
        const { systemBus } = await import('../../services/systemBus');
        const { SystemProtocol } = await import('../../types');
        const { videoWorker } = await import('../../services/workers/videoWorker');
        const incidents: any[] = [];
        const completions: any[] = [];
        systemBus.subscribe(SystemProtocol.INCIDENT_REPORT, (e: any) => incidents.push(e.payload ?? e));
        systemBus.subscribe(SystemProtocol.TASK_COMPLETION, (e: any) => completions.push(e.payload ?? e));
        await (videoWorker as any).processVideoJob({ prompt: 'a neon shoe ad', jobId: 'job-test', agentId: 'agent-test' });
        expect(completions).toHaveLength(0);
        expect(incidents.length).toBeGreaterThan(0);
        expect(String(incidents[0].error)).toContain('UNAVAILABLE');
        expect(String(incidents[0].error)).toContain('REPLICATE_API_TOKEN');
    });
});

describe('B1: no personal email baked into identity defaults', () => {
    it('identityService source contains no hardcoded personal email default', () => {
        const source = readFileSync(join(process.cwd(), 'services', 'identityService.ts'), 'utf-8');
        expect(source).not.toContain('alberto.farah.b@gmail.com');
        expect(source).toMatch(/process\.env\.CREATOR_EMAILS \|\| ''/);
    });
});

describe('A4: install scanner reads the real filesystem', () => {
    it('extracts route paths from router definitions', () => {
        const src = `
            router.get('/telemetry', (req, res) => c.getTelemetry(req, res));
            router.post('/install/handover', (req, res) => c.installHandover(req, res));
        `;
        expect(extractRoutePaths(src, '/v1/system')).toEqual([
            'GET /v1/system/telemetry',
            'POST /v1/system/install/handover',
        ]);
    });
    it('lists real components and endpoints from a temp tree', () => {
        const root = mkdtempSync(join(tmpdir(), 'scan-'));
        try {
            mkdirSync(join(root, 'components'), { recursive: true });
            mkdirSync(join(root, 'server', 'routes', 'v1'), { recursive: true });
            writeFileSync(join(root, 'components', 'Dashboard.tsx'), 'export default 1;');
            writeFileSync(join(root, 'components', 'README.md'), 'not a component');
            writeFileSync(join(root, 'server', 'routes', 'v1', 'system.routes.ts'),
                "router.get('/status', (req, res) => x(req, res));");
            expect(listFrontendComponents(join(root, 'components'))).toEqual(['Dashboard.tsx']);
            expect(listBackendEndpoints(join(root, 'server', 'routes', 'v1'))).toEqual(['GET /v1/system/status']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('buildSystemMap reports real repo data (not a hardcoded map)', async () => {
        const map = await buildSystemMap({ rootDir: process.cwd() });
        // The real repo has far more than the 7 components the old fake map claimed
        expect(map.frontendComponents.length).toBeGreaterThan(20);
        expect(map.frontendComponents).toContain('Dashboard.tsx');
        expect(map.backendEndpoints.length).toBeGreaterThan(50);
        expect(map.backendEndpoints.some(e => e.includes('/v1/system/telemetry'))).toBe(true);
        expect(map.scanTimestamp).toBeGreaterThan(0);
    });
});

describe('A1b: sqlite telemetry samples round-trip', () => {
    it('records and reads back real samples', async () => {
        const { sqliteService } = await import('../../services/sqliteService');
        const base = Date.now() - 60_000;
        sqliteService.recordTelemetrySample(100, 0.1, base);
        sqliteService.recordTelemetrySample(250, 0.2, base + 30_000);
        const rows = sqliteService.getTelemetrySamples(base - 1000)
            .filter(r => r.ts >= base && r.ts <= base + 30_000);
        expect(rows.length).toBeGreaterThanOrEqual(2);
        const ours = rows.slice(-2);
        expect(ours[0].totalTokens).toBe(100);
        expect(ours[1].totalTokens).toBe(250);
    });
});
