import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate persistence (tools.db lands in cwd/data) before importing the modules.
process.chdir(mkdtempSync(join(tmpdir(), 'tool-createdat-')));

const { toolRegistry } = await import('../../services/tools/toolRegistry');
const { toolPersistence } = await import('../../services/tools/toolPersistence');
const { toolEvolver } = await import('../../services/tools/toolEvolver');

const probe: any = {
    id: 'tool_zz_touch_probe',
    name: 'zz_touch_probe',
    description: 'probe',
    parameters: { type: 'object', properties: {} },
    handler: { type: 'BUILTIN', handlerName: 'h' },
    category: 'UTILITY',
    createdBy: 'SILHOUETTE',
    enabled: true,
    usageCount: 0,
    successCount: 0,
    createdAt: Date.now() - 9 * 24 * 60 * 60 * 1000, // 9 days old
    version: '1.0.0'
};

describe('creation time persistence (unused-sweep data survives restarts)', () => {
    it('every registered tool is stamped into the stats store at boot', async () => {
        await toolRegistry.initialize();
        const row = await toolPersistence.loadByName('web_search');
        expect(row).not.toBeNull(); // never used in this temp env, yet present
        expect(row!.usageCount).toBe(0);
    });

    it('touchIfAbsent never clobbers existing stats or creation time', async () => {
        await toolPersistence.touchIfAbsent(probe);
        await toolPersistence.recordUsageStats(probe, true);
        const first = await toolPersistence.loadByName('zz_touch_probe');
        expect(first!.usageCount).toBe(1);
        expect(first!.createdAt).toBe(probe.createdAt);

        // A later boot re-touches with a FRESH createdAt: must be a no-op.
        await toolPersistence.touchIfAbsent({ ...probe, createdAt: Date.now() });
        const second = await toolPersistence.loadByName('zz_touch_probe');
        expect(second!.createdAt).toBe(probe.createdAt);
        expect(second!.usageCount).toBe(1);
        await toolPersistence.delete('zz_touch_probe');
    });

    it('a 9-day-old never-used tool is flagged by the evolver (leg b reachable)', async () => {
        toolRegistry.registerTool({ ...probe, name: 'zz_unused_probe', id: 'tool_zz_unused_probe' });
        const report = await toolEvolver.analyzeTool('zz_unused_probe');
        expect(report).not.toBeNull();
        expect(report!.needsOptimization).toBe(true);
        expect(report!.issues.join(' ')).toContain('Unused for over 7 days');
    });

    it('registry stamps tools before loading persisted rows (source audit)', () => {
        const src = readFileSync(join(__dirname, '../../services/tools/toolRegistry.ts'), 'utf8');
        expect(src).toContain('touchIfAbsent(tool)');
        expect(src.indexOf('touchIfAbsent(tool)')).toBeLessThan(src.indexOf('toolPersistence.loadAll()'));
    });
});
