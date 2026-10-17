import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate persistence (tools.db lands in cwd/data) before importing the modules.
process.chdir(mkdtempSync(join(tmpdir(), 'awareness-test-')));

const { toolRegistry } = await import('../../services/tools/toolRegistry');
const { capabilityAwareness } = await import('../../services/capabilityAwareness');

describe('TOOL_CREATED propagation to CapabilityAwareness', () => {
    it('a newly registered enabled tool appears in getCapabilitySummary() without a restart', async () => {
        await toolRegistry.initialize();
        await capabilityAwareness.initialize();

        await toolRegistry.registerTool({
            id: 'tool_zz_vitest_probe',
            name: 'zz_vitest_probe',
            description: 'Temporary propagation probe (deleted in test)',
            parameters: { type: 'object', properties: { msg: { type: 'string', description: 'text' } }, required: ['msg'] } as any,
            handler: { type: 'BUILTIN', handlerName: 'handleZzVitestProbe' },
            category: 'UTILITY',
            createdBy: 'SILHOUETTE',
            enabled: true,
            usageCount: 0,
            successCount: 0,
            createdAt: Date.now(),
            version: '1.0.0'
        } as any);
        await new Promise(r => setTimeout(r, 100));

        const summary = capabilityAwareness.getCapabilitySummary();
        expect(summary).toContain('zz_vitest_probe');
        expect(summary).toContain('(msg)');

        const declarations = toolRegistry.getToolDeclarations();
        expect(declarations.some((d: any) => d.name === 'zz_vitest_probe')).toBe(true);

        const del = await toolRegistry.deleteTool('zz_vitest_probe', { force: true });
        expect(del.success).toBe(true);
    });
});
