import { describe, it, expect } from 'vitest';
import { runMemoryAudit, MemoryAuditDeps } from '../../services/health/memoryAudit';
import { MemoryNode } from '../../types';

const NOW = 1_800_000_000_000;
const DAY = 24 * 3600_000;

const node = (over: Partial<MemoryNode>): MemoryNode => ({
    id: 'n', content: 'contenido de prueba suficientemente largo', tags: [],
    importance: 0.5, accessCount: 1, timestamp: NOW, lastAccess: NOW,
    tier: 'MEDIUM', ...over
} as MemoryNode);

const baseDeps = (over: Partial<MemoryAuditDeps> = {}): MemoryAuditDeps => ({
    nodes: [], souls: [], janitorMetrics: null, now: NOW, ...over
});

const check = (deps: MemoryAuditDeps, name: string) =>
    runMemoryAudit(deps).find(c => c.name.startsWith(name))!;

const SOUL_OK = ['# Soul: test', '## Personality', '## Core Values', '## Communication Style', '## Principles'].join('\n');

describe('Memory audit (roadmap item 6, read-only)', () => {
    it('detects normalized-duplicate content and reports the group', () => {
        const deps = baseDeps({ nodes: [
            node({ id: 'a', content: 'El cielo es azul, claramente.' }),
            node({ id: 'b', content: 'el CIELO es azul claramente' })
        ]});
        const c = check(deps, 'Memory: duplicate');
        expect(c.status).toBe('warning');
        expect((c.metadata as any).groups).toBe(1);
    });

    it('duplicate check is ok when contents differ', () => {
        const deps = baseDeps({ nodes: [node({ id: 'a', content: 'primer recuerdo distinto' }), node({ id: 'b', content: 'segundo recuerdo distinto' })] });
        expect(check(deps, 'Memory: duplicate').status).toBe('ok');
    });

    it('flags orphan intuitions (parentIds not in universe) and legacy unprovenanced dreams', () => {
        const deps = baseDeps({ nodes: [
            node({ id: 'dream1', tags: ['INTUITION', 'DREAM'], parentIds: ['gone1', 'gone2'] }),
            node({ id: 'dream2', tags: ['INTUITION'], parentIds: [] }),
            node({ id: 'dream3', tags: ['DREAM'], parentIds: ['real-parent'] }),
            node({ id: 'real-parent', content: 'memoria fuente real' })
        ]});
        const c = check(deps, 'Memory: dream provenance');
        expect(c.status).toBe('warning');
        expect((c.metadata as any).orphans).toEqual(['dream1']);
        expect((c.metadata as any).unprovenanced).toBe(1);
    });

    it('dream provenance ok when all parents resolve', () => {
        const deps = baseDeps({ nodes: [
            node({ id: 'd', tags: ['DREAM'], parentIds: ['p'] }),
            node({ id: 'p', content: 'padre existente en el universo' })
        ]});
        expect(check(deps, 'Memory: dream provenance').status).toBe('ok');
    });

    it('SOUL drift: file modified after last logged identity change → warning', () => {
        const deps = baseDeps({ souls: [{
            agentId: 'core-01', content: SOUL_OK, mtimeMs: NOW,
            ledger: [{ file: 'SOUL.md', timestamp: new Date(NOW - 10 * DAY).toISOString(), appliedBy: 'updateSoul' } as any]
        }]});
        const c = check(deps, 'Memory: SOUL (core-01)');
        expect(c.status).toBe('warning');
        expect(c.message).toContain('modified after last logged');
    });

    it('SOUL intact + logged change newer than mtime → ok', () => {
        const deps = baseDeps({ souls: [{
            agentId: 'core-01', content: SOUL_OK, mtimeMs: NOW - 10 * DAY,
            ledger: [{ file: 'SOUL.md', timestamp: new Date(NOW - DAY).toISOString(), appliedBy: 'updateSoul' } as any]
        }]});
        expect(check(deps, 'Memory: SOUL (core-01)').status).toBe('ok');
    });

    it('SOUL missing core markers → error', () => {
        const deps = baseDeps({ souls: [{ agentId: 'core-01', content: '# Soul: vacío', mtimeMs: NOW, ledger: [] }] });
        expect(check(deps, 'Memory: SOUL (core-01)').status).toBe('error');
    });

    it('stagnant evidence: important node never accessed for 30+ days → warning', () => {
        const deps = baseDeps({ nodes: [node({ id: 's1', importance: 0.9, accessCount: 0, timestamp: NOW - 45 * DAY })] });
        const c = check(deps, 'Memory: stagnant');
        expect(c.status).toBe('warning');
        expect((c.metadata as any).count).toBe(1);
    });

    it('janitor metrics: errors → error; absent ledger → warning; clean → ok', () => {
        const errDeps = baseDeps({ janitorMetrics: { totalEntries: 5, applied: 3, proposed: 0, abstained: 1, reverted: 0, errors: 1, abstentionRate: 0.25, lastRunTs: NOW - 3600_000 } });
        expect(check(errDeps, 'Memory: janitor').status).toBe('error');
        expect(check(baseDeps(), 'Memory: janitor').status).toBe('warning');
        const okDeps = baseDeps({ janitorMetrics: { totalEntries: 4, applied: 3, proposed: 1, abstained: 1, reverted: 0, errors: 0, abstentionRate: 0.25, lastRunTs: NOW - 3600_000 } });
        expect(check(okDeps, 'Memory: janitor').status).toBe('ok');
    });

    it('tier health reports counts per tier and warns on empty memory', () => {
        const empty = check(baseDeps(), 'Memory: tier health');
        expect(empty.status).toBe('warning');
        const withNodes = check(baseDeps({ nodes: [node({ id: 'a', tier: 'LONG' }), node({ id: 'b', tier: 'LONG' })] }), 'Memory: tier health');
        expect(withNodes.status).toBe('ok');
        expect((withNodes.metadata as any).tiers.LONG).toBe(2);
    });
});
