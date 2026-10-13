/**
 * [R12] Plugin discovery under ESM.
 *
 * Root cause: integrationHub scanned services/plugins/custom with
 * require('fs')/require('path') inside a "type": "module" package, catching
 * the failure and merely registering inert WEBHOOK descriptors - no plugin
 * was ever loaded, validated, or executed, and arbitrary files were
 * auto-enabled.
 *
 * Now: services/plugins/discovery.ts discovers candidates, dynamically
 * imports them (real ESM load), validates the IPlugin contract (identity,
 * author/origin, tool shapes, permissions allowlist), and only valid
 * plugins reach the PluginRegistry. Invalid files stay DEACTIVATED with a
 * recorded reason.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverCustomPlugins, validatePlugin } from '../../services/plugins/discovery';

let fixtureDir: string;

const VALID_PLUGIN = `
export const state = { initialized: false, handlerCalls: 0 };
const plugin = {
    id: 'fixture-echo',
    name: 'Fixture Echo',
    version: '1.0.0',
    description: 'Innocuous fixture plugin for discovery tests',
    author: 'silhouette-tests',
    permissions: ['tools'],
    tools: [{
        name: 'echo',
        description: 'Echoes its input',
        category: 'UTILITY',
        parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } } },
        handler: async (args) => { state.handlerCalls++; return { echoed: args?.text ?? null }; }
    }],
    async onInit() { state.initialized = true; }
};
export default plugin;
`;

const INVALID_NO_AUTHOR = `
export default {
    id: 'fixture-anonymous',
    name: 'Anonymous Plugin',
    version: '1.0.0',
    description: 'Declares no author/origin',
    author: '',
    tools: []
};
`;

const INVALID_BAD_TOOL = `
export default {
    id: 'fixture-badtool',
    name: 'Bad Tool Plugin',
    version: '1.0.0',
    description: 'Tool without executable handler',
    author: 'silhouette-tests',
    tools: [{ name: 'broken', description: 'no handler', category: 'UTILITY', parameters: {} }]
};
`;

const BROKEN_IMPORT = `
throw new Error('this module always fails to load');
export default {};
`;

describe('R12: custom plugin discovery (ESM)', () => {
    beforeAll(() => {
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-plugins-'));
        fs.writeFileSync(path.join(fixtureDir, 'echo-fixture.ts'), VALID_PLUGIN);
        fs.writeFileSync(path.join(fixtureDir, 'anonymous.ts'), INVALID_NO_AUTHOR);
        fs.writeFileSync(path.join(fixtureDir, 'bad-tool.ts'), INVALID_BAD_TOOL);
        fs.writeFileSync(path.join(fixtureDir, 'always-broken.ts'), BROKEN_IMPORT);
        fs.writeFileSync(path.join(fixtureDir, 'not-a-plugin.txt'), 'ignore me');
        fs.writeFileSync(path.join(fixtureDir, 'types.d.ts'), 'export {};');
    });

    afterAll(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('discovers and really loads a valid fixture plugin; invalid ones stay deactivated with a reason', async () => {
        const results = await discoverCustomPlugins(fixtureDir);

        // non-code files are not candidates
        expect(results.find(r => r.file === 'not-a-plugin.txt')).toBeUndefined();
        expect(results.find(r => r.file === 'types.d.ts')).toBeUndefined();

        const valid = results.find(r => r.file === 'echo-fixture.ts');
        expect(valid?.status).toBe('ACTIVATED');
        expect(valid?.pluginId).toBe('fixture-echo');
        expect(valid?.plugin).toBeDefined();

        const anonymous = results.find(r => r.file === 'anonymous.ts');
        expect(anonymous?.status).toBe('DEACTIVATED');
        expect(anonymous?.reason).toContain('author');

        const badTool = results.find(r => r.file === 'bad-tool.ts');
        expect(badTool?.status).toBe('DEACTIVATED');
        expect(badTool?.reason).toContain('handler');

        const broken = results.find(r => r.file === 'always-broken.ts');
        expect(broken?.status).toBe('DEACTIVATED');
        expect(broken?.reason).toContain('import failed');

        // the valid plugin is REALLY loaded: execute its lifecycle + tool
        const plugin = valid!.plugin!;
        await plugin.onInit!();
        const mod = await import(path.join(fixtureDir, 'echo-fixture.ts'));
        expect(mod.state.initialized).toBe(true);

        const out = await plugin.tools[0].handler({ text: 'hola' });
        expect(out).toEqual({ echoed: 'hola' });
        expect(mod.state.handlerCalls).toBe(1);
    });

    it('returns empty when the custom dir does not exist', async () => {
        const results = await discoverCustomPlugins(path.join(fixtureDir, 'does-not-exist'));
        expect(results).toEqual([]);
    });

    it('rejects plugins requesting unvetted permissions', () => {
        expect(validatePlugin({
            id: 'p', name: 'P', version: '1.0.0', description: 'd', author: 'a',
            tools: [], permissions: ['kernel-access']
        })).toContain("unvetted permission 'kernel-access'");

        expect(validatePlugin({
            id: 'p', name: 'P', version: '1.0.0', description: 'd', author: 'a',
            tools: [], permissions: ['tools', 'monitoring']
        })).toBeNull();
    });

    it('loadCustomPlugins registers valid plugins so their tools are executable via the registry', async () => {
        const { loadCustomPlugins } = await import('../../services/plugins/discovery');
        const { pluginRegistry } = await import('../../services/plugins/pluginRegistry');

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-load-'));
        fs.writeFileSync(path.join(dir, 'echo2.ts'), VALID_PLUGIN.replace("id: 'fixture-echo'", "id: 'fixture-echo-2'"));
        try {
            const results = await loadCustomPlugins(dir);
            expect(results).toHaveLength(1);
            expect(results[0].status).toBe('ACTIVATED');

            const handler = pluginRegistry.getToolHandler('fixture-echo-2', 'echo');
            expect(handler).toBeDefined();
            const out = await handler!({ text: 'via registry' });
            expect(out).toEqual({ echoed: 'via registry' });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
