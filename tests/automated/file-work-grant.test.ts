/**
 * [Grant] Filesystem capability grants: birth-time (explicit project in the
 * expansion payload) and durable (persisted at dispatch for file-declaring
 * steps). The jail confines every write; these grants make the capability
 * real and visible. Guards the honest-bookkeeping semantics: no project /
 * no file work => no grant; idempotence; payload-wins branch still honored.
 */
import { describe, it, expect } from 'vitest';
import { deriveDynamicCapabilities, payloadDeclaresProject } from '../../services/squads/dynamicBirth';
import { durableFileGrant } from '../../services/tools/toolSelection';
import { AgentCapability } from '../../types';

describe('birth grant (dynamicBirth)', () => {
    it('no project reference => no FS capabilities at birth', () => {
        const caps = deriveDynamicCapabilities({ name: 'Research Squad', role: 'Analyst' });
        expect(caps).not.toContain(AgentCapability.ACTION_FILE_READ);
        expect(caps).not.toContain(AgentCapability.ACTION_FILE_WRITE);
    });

    it('explicit projectPath => born with confined FS capabilities', () => {
        const caps = deriveDynamicCapabilities({ name: 'Cotizador Squad', role: 'Builder', projectPath: '/opt/silhouette/workspace/cotizador-freelance' });
        expect(caps).toContain(AgentCapability.ACTION_FILE_READ);
        expect(caps).toContain(AgentCapability.ACTION_FILE_WRITE);
    });

    it('projectId and project keys also trigger the grant', () => {
        expect(payloadDeclaresProject({ projectId: 'p1' })).toBe(true);
        expect(payloadDeclaresProject({ project: 'cotizador-freelance' })).toBe(true);
        expect(payloadDeclaresProject({})).toBe(false);
        expect(payloadDeclaresProject(null)).toBe(false);
        // prose is NOT a project reference
        expect(payloadDeclaresProject({ taskDescription: 'build in /opt/silhouette/workspace/x' })).toBe(false);
    });

    it('payload-provided capabilities still win, grant unions on top with project', () => {
        const caps = deriveDynamicCapabilities({ capabilities: [AgentCapability.RESEARCH], projectId: 'p1' });
        expect(caps).toContain(AgentCapability.RESEARCH);
        expect(caps).toContain(AgentCapability.ACTION_FILE_WRITE);
        // and without a project the payload list stays untouched
        const caps2 = deriveDynamicCapabilities({ capabilities: [AgentCapability.RESEARCH] });
        expect(caps2).toEqual([AgentCapability.RESEARCH]);
    });
});

describe('durable grant (toolSelection.durableFileGrant)', () => {
    it('no file work => null (no change)', () => {
        expect(durableFileGrant([], false)).toBeNull();
    });

    it('missing grant => union with both FS capabilities', () => {
        const out = durableFileGrant([AgentCapability.RESEARCH], true)!;
        expect(out).toContain(AgentCapability.RESEARCH);
        expect(out).toContain(AgentCapability.ACTION_FILE_READ);
        expect(out).toContain(AgentCapability.ACTION_FILE_WRITE);
        expect(out.length).toBe(3);
    });

    it('already granted => null (idempotent)', () => {
        expect(durableFileGrant([AgentCapability.ACTION_FILE_READ, AgentCapability.ACTION_FILE_WRITE], true)).toBeNull();
    });

    it('partial grant completes the pair', () => {
        const out = durableFileGrant([AgentCapability.ACTION_FILE_READ], true)!;
        expect(out).toContain(AgentCapability.ACTION_FILE_WRITE);
        expect(out.filter(c => c === AgentCapability.ACTION_FILE_READ).length).toBe(1);
    });
});
