import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { computeTokensToday } from '../../server/controllers/tokensToday';

// FASE1 PR-E: the Command Center showed fabricated numbers (fixed 85% coherence,
// fixed trend badges, a token card stuck at 0, a baked "131 squads" label).
// House rule: nothing fake, nothing hardcoded - real sources or honest N/A.

describe('computeTokensToday (pure)', () => {
    const dayStart = new Date('2026-10-14T00:00:00').getTime();
    const t = (h: number, total: number) => ({ ts: dayStart + h * 3600_000, totalTokens: total });

    it('sums positive deltas of the cumulative counter within the day', () => {
        expect(computeTokensToday([t(1, 100), t(2, 160), t(3, 210)], dayStart)).toBe(110);
    });
    it('uses the last pre-midnight sample as the baseline', () => {
        const samples = [{ ts: dayStart - 1000, totalTokens: 500 }, t(1, 560), t(2, 600)];
        expect(computeTokensToday(samples, dayStart)).toBe(100);
    });
    it('skips negative jumps (counter reset by operator) instead of going negative', () => {
        expect(computeTokensToday([t(1, 900), t(2, 50), t(3, 80)], dayStart)).toBe(30);
    });
    it('returns 0 with no samples', () => {
        expect(computeTokensToday([], dayStart)).toBe(0);
    });
});

describe('no fabricated dashboard numbers remain', () => {
    const app = fs.readFileSync('App.tsx', 'utf8');
    const dash = fs.readFileSync('components/Dashboard.tsx', 'utf8');
    const orch = fs.readFileSync('components/AgentOrchestrator.tsx', 'utf8');

    it('App.tsx carries no fixed awareness score', () => {
        expect(app).not.toMatch(/awarenessScore:\s*85/);
    });
    it('Dashboard carries no hardcoded trend literals', () => {
        expect(dash).not.toMatch(/trend=\{[-]?\d+\}/);
    });
    it('Token Velocity card is wired to real telemetry', () => {
        expect(dash).toContain('tokenUsageToday');
        expect(app).toContain('tokensToday');
    });
    it('Squad search placeholder uses the live count', () => {
        expect(orch).not.toContain('Search 131 Squads');
        expect(orch).toContain('${squads.length}');
    });
    it('document title carries no stale version label', () => {
        const html = fs.readFileSync('index.html', 'utf8');
        expect(html).not.toMatch(/<title>[^<]*v\d+\.\d+/);
    });
});
