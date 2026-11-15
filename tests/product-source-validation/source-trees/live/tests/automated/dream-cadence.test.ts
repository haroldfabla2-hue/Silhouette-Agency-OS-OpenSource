import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    analyzeCadence, recordDreamCycle, readDreamState,
    DreamCycleRecord, DreamTriggerConfig
} from '../../services/dream/dreamTriggers';

const H = 3600_000;
const cfg: DreamTriggerConfig = {
    enabled: true, epiphanyThreshold: 5, revisionThreshold: 1, identityThreshold: 1,
    fallbackHours: 24, minIntervalMinutes: 30, statePath: '/tmp/unused'
};
const rec = (at: number, triggers: string[] = [], mem: number | null = null): DreamCycleRecord =>
    ({ at, triggers, memoriesConsolidated: mem });

describe('Dreamer cadence measurement (roadmap item 9)', () => {
    it('fewer than 3 cycles → insufficient data, no invented numbers', () => {
        const r = analyzeCadence([rec(0), rec(H)], cfg);
        expect(r.intervalsHours.mean).toBeNull();
        expect(r.suggestion).toContain('Insufficient data');
    });

    it('computes interval stats from real history', () => {
        // intervals: 2h, 4h, 6h → mean 4, median 4, min 2, max 6
        const h = [rec(0), rec(2 * H), rec(6 * H), rec(12 * H)];
        const r = analyzeCadence(h, cfg);
        expect(r.intervalsHours.mean).toBe(4);
        expect(r.intervalsHours.median).toBe(4);
        expect(r.intervalsHours.min).toBe(2);
        expect(r.intervalsHours.max).toBe(6);
        expect(r.windowDays).toBe(0.5);
    });

    it('trigger distribution classifies by kind', () => {
        const h = [
            rec(0, ['pressure: hippocampus 50/50']),
            rec(H, ['epiphanies: 5 since last dream (>= 5)']),
            rec(2 * H, ['milestone: 1 truth revision(s) applied since last dream']),
            rec(3 * H, ['fallback: 24h since last dream (>= 24h)'])
        ];
        const r = analyzeCadence(h, cfg);
        expect(r.triggerDistribution).toEqual({ pressure: 1, epiphanies: 1, milestone: 1, fallback: 1 });
    });

    it('event-driven history → advisory keeps clock as backstop; clock-driven → suggests lower thresholds', () => {
        const events = [rec(0, ['pressure: x']), rec(H, ['epiphanies: x']), rec(2 * H, ['milestone: x'])];
        expect(analyzeCadence(events, cfg).suggestion).toContain('Events drive dreaming');
        const clocked = [rec(0, ['fallback: x']), rec(24 * H, ['fallback: x']), rec(48 * H, ['fallback: x'])];
        expect(analyzeCadence(clocked, cfg).suggestion).toContain('clock drives');
    });

    it('avg memories per cycle from recorded metrics only', () => {
        const h = [rec(0, [], 10), rec(H, [], 20), rec(2 * H, [], null)];
        expect(analyzeCadence(h, cfg).avgMemoriesPerCycle).toBe(15);
        expect(analyzeCadence([rec(0), rec(H), rec(2 * H)], cfg).avgMemoriesPerCycle).toBeNull();
    });

    describe('history persistence', () => {
        let dir: string; let statePath: string;
        beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-')); statePath = path.join(dir, 's.json'); });
        afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

        it('recordDreamCycle appends full cycle records with metrics', () => {
            recordDreamCycle(statePath, ['pressure: x'], 12);
            recordDreamCycle(statePath, ['fallback: x'], 8);
            const s = readDreamState(statePath);
            expect(s.history.length).toBe(2);
            expect(s.history[0].memoriesConsolidated).toBe(12);
            expect(s.history[1].triggers).toEqual(['fallback: x']);
        });
    });
});
