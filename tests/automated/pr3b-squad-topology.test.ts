/**
 * [PR-3b] Squads as VISUAL TOPOLOGY; execution via on-demand specialists.
 *
 * Approved option (b): squads no longer mass-hydrate their members on stage
 * transitions (theater with real RAM cost, zero work assigned — no serious
 * framework hydrates agents without a work contract). The leader wakes as
 * contract holder; specialists hydrate on demand through planExecutor and at
 * their actual point of use in remediation.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PR-3b: orchestrator.mobilizeSquad is topology-only', () => {
    const src = read('services/orchestrator.ts');
    const mobilize = src.slice(src.indexOf('public async mobilizeSquad(squad: Squad)'));

    it('no longer mass-hydrates drones on mobilization', () => {
        expect(mobilize).not.toContain('for (const droneId of drones)');
        expect(mobilize).not.toContain('Staggered Wake-up');
        expect(mobilize).not.toContain('ATTENTION! WAKE UP!');
    });
    it('still wakes the leader and marks the squad active (topology)', () => {
        expect(mobilize).toContain('await this.hydrateAgent(squad.leaderId)');
        expect(mobilize).toContain('squad.active = true');
    });
    it('SQUAD_MOBILIZED message is honest: specialists hydrate on demand', () => {
        expect(mobilize).toContain('specialists hydrate on demand');
        expect(mobilize).not.toContain('fully mobilized with');
    });
});

describe('PR-3b: remediation hydrates specialists at point of use', () => {
    const src = read('services/remediationService.ts');

    it('no pre-hydration of research/dev "for potential use"', () => {
        expect(src).not.toContain('Pre-hydrate Research and Dev');
    });
    it('qa-01 still hydrates for diagnosis', () => {
        expect(src).toContain("orchestrator.hydrateAgent('qa-01');");
    });
    it('research-01 and dev-01 hydrate inside the needsResearch branch', () => {
        const branchStart = src.indexOf('if (needsResearch) {');
        const branch = src.slice(branchStart, branchStart + 900);
        expect(branch.indexOf("orchestrator.hydrateAgent('research-01');")).toBeLessThan(branch.indexOf('consultResearchTeam('));
        expect(branch.indexOf("orchestrator.hydrateAgent('dev-01');")).toBeLessThan(branch.indexOf('planSolution('));
    });
    it('hydration count: qa-01 once at entry, specialists only on demand', () => {
        expect(src.split("orchestrator.hydrateAgent('qa-01')").length - 1).toBe(1);
        expect(src.split("orchestrator.hydrateAgent('research-01')").length - 1).toBe(1);
        expect(src.split("orchestrator.hydrateAgent('dev-01')").length - 1).toBe(1);
    });
});
