/**
 * [REA Fase 2] The reverse-engineering legal protocol must exist as a real
 * injected skill and in the deterministic squad-leader contract. Alberto's
 * rule: understand and rewrite from scratch — NEVER copy decompiled code,
 * nothing against DRM. Source-text guards (skill files are data, not code).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildDynamicLeaderInstruction } from '../../services/squads/dynamicBirth';

const skillPath = resolve(__dirname, '../../.silhouette/skills/reverse_engineering/SKILL.md');

describe('reverse_engineering skill (injected via skillRegistry -> BaseAgent prompt)', () => {
    it('exists with valid frontmatter', () => {
        expect(existsSync(skillPath)).toBe(true);
        const s = readFileSync(skillPath, 'utf8');
        expect(s).toContain('name: reverse_engineering');
        expect(s).toContain('description:');
    });

    it('carries the three hard legal rules', () => {
        const s = readFileSync(skillPath, 'utf8');
        // rewrite from scratch, never copy decompiled code
        expect(s).toMatch(/NEVER copy decompiled/i);
        expect(s).toMatch(/implement from scratch/i);
        // no DRM / anticopy circumvention
        expect(s).toMatch(/NEVER analyze, bypass, weaken/i);
        expect(s).toMatch(/DRM/);
        // entitlement scope
        expect(s).toMatch(/Only analyze targets we are entitled/i);
    });

    it('carries the operational $0 and RAM rules', () => {
        const s = readFileSync(skillPath, 'utf8');
        expect(s).toMatch(/CERO COBROS/);
        expect(s).toMatch(/overnight window/i);
        expect(s).toMatch(/jq/);
    });

    it('evidence honesty: absent facts are not absence', () => {
        const s = readFileSync(skillPath, 'utf8');
        expect(s).toMatch(/absent facts are NOT proof of absence/i);
    });
});

describe('squad-leader deterministic contract', () => {
    it('includes the rewrite-from-scratch / no-DRM clause', () => {
        const instr = buildDynamicLeaderInstruction('Cotizador Squad', { role: 'Builder', category: 'CODE' });
        expect(instr).toMatch(/REWRITE FROM SCRATCH/);
        expect(instr).toMatch(/never copy decompiled/);
        expect(instr).toMatch(/never analyze or bypass DRM/);
    });
});
