import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    evaluateDreamTriggers, readDreamState, recordDreamCycle,
    DreamSignals, DreamTriggerConfig
} from '../../services/dream/dreamTriggers';

const signals = (over: Partial<DreamSignals> = {}): DreamSignals => ({
    workingCount: 10, workingCapacity: 50, epiphaniesSinceLastDream: 0,
    truthRevisionsSinceLastDream: 0, identityChangesSinceLastDream: 0,
    hoursSinceLastDream: 2, ...over
});

const config = (over: Partial<DreamTriggerConfig> = {}): DreamTriggerConfig => ({
    enabled: true, epiphanyThreshold: 5, revisionThreshold: 1, identityThreshold: 1,
    fallbackHours: 24, minIntervalMinutes: 30, statePath: '/tmp/unused', ...over
});

describe('Dream triggers (roadmap item 8)', () => {
    it('pressure: hippocampus at capacity triggers', () => {
        const v = evaluateDreamTriggers(signals({ workingCount: 50 }), config(), 120);
        expect(v.shouldDream).toBe(true);
        expect(v.reasons[0]).toContain('pressure');
    });

    it('epiphanies: N accumulated since last dream triggers', () => {
        expect(evaluateDreamTriggers(signals({ epiphaniesSinceLastDream: 4 }), config(), 120).shouldDream).toBe(false);
        const v = evaluateDreamTriggers(signals({ epiphaniesSinceLastDream: 5 }), config(), 120);
        expect(v.shouldDream).toBe(true);
        expect(v.reasons[0]).toContain('epiphanies');
    });

    it('milestones: a truth revision or identity change since last dream triggers', () => {
        expect(evaluateDreamTriggers(signals({ truthRevisionsSinceLastDream: 1 }), config(), 120).shouldDream).toBe(true);
        expect(evaluateDreamTriggers(signals({ identityChangesSinceLastDream: 1 }), config(), 120).shouldDream).toBe(true);
    });

    it('fallback: the clock forces a dream after DREAM_FALLBACK_HOURS of quiet', () => {
        const v = evaluateDreamTriggers(signals({ hoursSinceLastDream: 24 }), config(), 24 * 60);
        expect(v.shouldDream).toBe(true);
        expect(v.reasons[0]).toContain('fallback');
    });

    it('no signal, fresh dream → no dream', () => {
        expect(evaluateDreamTriggers(signals(), config(), 120).shouldDream).toBe(false);
    });

    it('cooldown: a dream within DREAM_MIN_INTERVAL_MINUTES blocks re-triggering', () => {
        const v = evaluateDreamTriggers(signals({ workingCount: 50 }), config(), 10);
        expect(v.shouldDream).toBe(false);
        expect(v.reasons[0]).toContain('cooldown');
    });

    it('disabled config never triggers', () => {
        expect(evaluateDreamTriggers(signals({ workingCount: 50 }), config({ enabled: false }), 120).shouldDream).toBe(false);
    });

    describe('dream state', () => {
        let dir: string; let statePath: string;
        beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-state-')); statePath = path.join(dir, 'state.json'); });
        afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

        it('missing state file → sane defaults', () => {
            const s = readDreamState(statePath);
            expect(s.lastDreamCycleAt).toBeNull();
            expect(s.cycles).toBe(0);
        });

        it('recordDreamCycle persists timestamp and increments cycles', () => {
            recordDreamCycle(statePath, ['pressure']);
            recordDreamCycle(statePath, ['fallback']);
            const s = readDreamState(statePath);
            expect(s.cycles).toBe(2);
            expect(s.lastDreamCycleAt).toBeGreaterThan(0);
            expect(s.lastTriggers).toEqual(['fallback']);
        });
    });
});
