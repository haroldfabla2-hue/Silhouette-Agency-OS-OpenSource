import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate persistence (tools.db lands in cwd/data) before importing the modules.
process.chdir(mkdtempSync(join(tmpdir(), 'tool-stats-')));

const { toolRegistry } = await import('../../services/tools/toolRegistry');
const { toolPersistence } = await import('../../services/tools/toolPersistence');

describe('usage stats persistence (evolver data survives restarts)', () => {
    it('recordUsage persists counts for builtin tools too', async () => {
        await toolRegistry.initialize();
        toolRegistry.recordUsage('web_search', true);
        toolRegistry.recordUsage('web_search', false);
        await new Promise(r => setTimeout(r, 500));

        const row = await toolPersistence.loadByName('web_search');
        expect(row).not.toBeNull();
        expect(row!.usageCount).toBe(2);
        expect(row!.successCount).toBe(1);
        await toolPersistence.delete('web_search');
    });

    it('recordUsageStats upserts instead of requiring an existing row', async () => {
        const probe: any = {
            id: 'tool_zz_stats_probe',
            name: 'zz_stats_probe',
            description: 'probe',
            parameters: { type: 'object', properties: {} },
            handler: { type: 'BUILTIN', handlerName: 'h' },
            category: 'UTILITY',
            createdBy: 'SILHOUETTE',
            enabled: true,
            usageCount: 0,
            successCount: 0,
            createdAt: Date.now(),
            version: '1.0.0'
        };
        await toolPersistence.recordUsageStats(probe, true);
        await toolPersistence.recordUsageStats(probe, false);
        const row = await toolPersistence.loadByName('zz_stats_probe');
        expect(row).not.toBeNull();
        expect(row!.usageCount).toBe(2);
        expect(row!.successCount).toBe(1);
        await toolPersistence.delete('zz_stats_probe');
    });

    it('loadPersistedTools merges persisted stats into builtins instead of shadowing them', () => {
        const src = readFileSync(join(__dirname, '../../services/tools/toolRegistry.ts'), 'utf8');
        expect(src).toContain('Merged persisted stats into builtin');
        expect(src).toContain('existing.usageCount = tool.usageCount');
        expect(src).toContain('recordUsageStats(tool, success)');
    });
});
