/**
 * PR-4d: Prevention by design — birth policy tests.
 * Behavioral tests for the pure policy functions + source audit of orchestrator wiring.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateBirthContract, findReusableAgent, BirthRateLimiter, MAX_DYNAMIC_AGENTS, MAX_BIRTHS_PER_HOUR } from '../../services/squads/dynamicBirth';

describe('PR-4d: validateBirthContract', () => {
    it('accepts a complete contract (name, category, role, reason)', () => {
        expect(validateBirthContract({ name: 'Video Editor', category: 'marketing', role: 'Video Editor', reason: 'client asked for a B2B video' })).toEqual({ ok: true, errors: [] });
    });
    it('accepts missionId as an alternative to reason', () => {
        const r = validateBirthContract({ name: 'Coder', category: 'tech', role: 'Backend Dev', missionId: 'msn_1' });
        expect(r.ok).toBe(true);
    });
    it('rejects missing name / category / role', () => {
        expect(validateBirthContract({ category: 'tech', role: 'Dev', reason: 'x' }).ok).toBe(false);
        expect(validateBirthContract({ name: 'Dev', role: 'Dev', reason: 'x' }).ok).toBe(false);
        expect(validateBirthContract({ name: 'Dev', category: 'tech', reason: 'x' }).ok).toBe(false);
        expect(validateBirthContract({}).ok).toBe(false);
    });
    it('missing reason/missionId warns but does not block in v1', () => {
        const r = validateBirthContract({ name: 'Dev', category: 'tech', role: 'Dev' });
        expect(r.ok).toBe(true);
        expect(r.errors.some((e: string) => e.startsWith('warn:'))).toBe(true);
    });
    it('unwraps event-shaped payloads', () => {
        expect(validateBirthContract({ payload: { name: 'Dev', category: 'tech', role: 'Dev', reason: 'x' } }).ok).toBe(true);
    });
});

describe('PR-4d: findReusableAgent', () => {
    const agents = [
        { id: 'agt_1', name: 'Video Editor', category: 'marketing', role: 'Video Editor', status: 'IDLE', enabled: true },
        { id: 'agt_2', name: 'Retired Editor', category: 'marketing', role: 'Video Editor', status: 'OFFLINE', enabled: false },
        { id: 'agt_3', name: 'Coder', category: 'tech', role: 'Backend Developer', status: 'IDLE', enabled: true },
        { id: 'agt_x', name: 'Unknown Squad Lead', category: 'marketing', role: 'Video Editor', status: 'IDLE', enabled: true },
    ];
    it('reuses an enabled agent with same category and role', () => {
        expect(findReusableAgent(agents, { name: 'X', category: 'marketing', role: 'video editor' })?.id).toBe('agt_1');
    });
    it('never returns retired (enabled=false) agents', () => {
        const withoutAg1 = agents.filter(a => a.id !== 'agt_1' && a.id !== 'agt_x');
        expect(findReusableAgent(withoutAg1, { name: 'X', category: 'marketing', role: 'Video Editor' })).toBeNull();
    });
    it('never returns phantom Unknown Squad Lead husks', () => {
        const onlyPhantom = [agents[3]];
        expect(findReusableAgent(onlyPhantom, { name: 'X', category: 'marketing', role: 'Video Editor' })).toBeNull();
    });
    it('matches on role-token overlap (Editor matches Video Editor)', () => {
        expect(findReusableAgent(agents, { name: 'X', category: 'marketing', role: 'Senior Editor' })?.id).toBe('agt_1');
    });
    it('returns null when the category differs', () => {
        expect(findReusableAgent(agents, { name: 'X', category: 'finance', role: 'Video Editor' })).toBeNull();
    });
});

describe('PR-4d: BirthRateLimiter', () => {
    it('allows up to MAX_BIRTHS_PER_HOUR within the window, then blocks', () => {
        const rl = new BirthRateLimiter();
        const t0 = 1_000_000_000_000;
        for (let i = 0; i < MAX_BIRTHS_PER_HOUR; i++) expect(rl.allow(t0 + i * 1000)).toBe(true);
        expect(rl.allow(t0 + 60_000)).toBe(false);
        expect(rl.count(t0 + 60_000)).toBe(MAX_BIRTHS_PER_HOUR);
    });
    it('slides the window: births older than 1h free capacity', () => {
        const rl = new BirthRateLimiter();
        const t0 = 1_000_000_000_000;
        for (let i = 0; i < MAX_BIRTHS_PER_HOUR; i++) rl.allow(t0 + i * 1000);
        const later = t0 + 61 * 60 * 1000;
        expect(rl.allow(later)).toBe(true);
    });
});

describe('PR-4d: orchestrator wiring (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'orchestrator.ts'), 'utf8');
    it('handleDynamicExpansion enforces contract, reuse, limits before createDynamicAgent', () => {
        const blockStart = src.indexOf('private handleDynamicExpansion');
        expect(blockStart).toBeGreaterThan(-1);
        const createIdx = src.indexOf('generateDynamicIds()', blockStart);
        expect(createIdx).toBeGreaterThan(blockStart);
        const block = src.slice(blockStart, createIdx);
        expect(block).toContain('validateBirthContract');
        expect(block).toContain('findReusableAgent');
        expect(block).toContain('MAX_DYNAMIC_AGENTS');
        expect(block).toContain('birthRateLimiter');
    });
    it('declares honest prevention limits', () => {
        expect(MAX_DYNAMIC_AGENTS).toBe(50);
        expect(MAX_BIRTHS_PER_HOUR).toBe(5);
    });
    it('squad registration dedups by name+category instead of blind unshift', () => {
        const anchor = src.indexOf('Squad identity is stable');
        expect(anchor).toBeGreaterThan(-1);
        const window = src.slice(anchor, anchor + 1400);
        expect(window).toContain('existingSquad');
        expect(window).toContain('if (!existingSquad) this.squads.unshift(squadEntry)');
    });
});
