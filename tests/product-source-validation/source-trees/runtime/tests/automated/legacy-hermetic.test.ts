import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chronos } from '../../services/chronosService';
import { modelCatalog, getModelsByProvider, getModelsByCapability } from '../../services/modelCatalog';

describe('ported manual checks against production modules, without external calls', () => {
    it('verify_chronos: uses the real clock and temporal context', () => {
        const before = Date.now();
        const context = chronos.getContext();
        expect(context.timestamp).toBeGreaterThanOrEqual(before);
        expect(context.timestamp).toBeLessThanOrEqual(Date.now());
        expect(context.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        expect(context.dayOfWeek).toBe(new Date(context.timestamp).toLocaleDateString('en-US', { weekday: 'long' }));
        expect(context.relative.tomorrow > context.relative.yesterday).toBe(true);
        expect(chronos.getTimeGrid(new Date(2026, 0, 15, 12))).toEqual({ year: 2026, month: 1, day: 15, hour: 12, weekday: 4 });
    });
    it('verify_catalog: provider/capability filters match the real catalog (not a paid API test)', () => {
        expect(modelCatalog.length).toBeGreaterThan(0);
        const providers = new Set(modelCatalog.map(model => model.provider));
        for (const provider of providers) {
            expect(getModelsByProvider(provider)).toEqual(modelCatalog.filter(model => model.provider === provider));
        }
        expect(getModelsByCapability('reasoning')).toEqual(modelCatalog.filter(model => model.capabilities.reasoning));
        expect(getModelsByProvider('GEMINI').length).toBeGreaterThan(0);
    });
    it('verify_agent_registry: real disk load/save/reload in an isolated temporary directory', async () => {
        const root = await mkdtemp(join(tmpdir(), 'silhouette-registry-'));
        try {
            const dir = join(root, 'definitions');
            await mkdir(dir);
            const { AgentRegistry } = await import('../../services/registry/AgentRegistry');
            const registry = new AgentRegistry(dir);
            const original = JSON.parse(await readFile('data/agents/definitions/orchestrator.json', 'utf8'));
            await writeFile(join(dir, 'orchestrator.json'), JSON.stringify(original));
            await registry.loadAgents();
            expect(registry.getAgent(original.id)).toEqual(original);
            const persisted = { ...original, id: 'verification-agent', name: 'Verification agent' };
            await registry.saveAgent(persisted);
            const reloaded = new AgentRegistry(dir);
            await reloaded.loadAgents();
            expect(reloaded.getAgent(persisted.id)).toEqual(persisted);
            expect(JSON.parse(await readFile(join(dir, `${persisted.id}.json`), 'utf8'))).toEqual(persisted);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
});
