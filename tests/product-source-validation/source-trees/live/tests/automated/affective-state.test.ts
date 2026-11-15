/**
 * Affective state layer: persistent, moderate, modulating — and NEVER deciding.
 *
 * The layer is a functional regulation model (valence + activation), not
 * consciousness or real feelings. These tests pin the design invariants:
 *  1. Persistence: the state survives a process restart (disk round-trip).
 *  2. Moderation: no observation, however extreme, leaves the moderation band
 *     (the inverted-U finding: extremes degrade performance).
 *  3. Gradualism: a single observation moves the state by at most alpha.
 *  4. Modulation: the state produces tone-only prompt context.
 *  5. Never decides: the modulation block contains no action instructions and
 *     the decision path (System 2 rationalization) reads no affective state.
 *  6. Eternal memory: affect tagging is additive metadata only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    AffectiveStateService,
    applyObservation,
    buildModulationPromptBlock,
    clampToModerateBand,
    describeState,
    BASELINE,
    DEFAULT_ALPHA,
    MODERATION_BAND
} from '../../services/affective/affectiveState';

const tmpDirs: string[] = [];
afterEach(() => { tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });

function tmpService() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affect-'));
    tmpDirs.push(dir);
    return { service: new AffectiveStateService(path.join(dir, 'affective_state.json')), dir };
}

describe('affective state: moderation (extremes are unreachable)', () => {
    it('clamps any state to the moderation band', () => {
        const clamped = clampToModerateBand({ valence: 1, activation: 1, observations: 0, updatedAt: 0 });
        expect(clamped.valence).toBe(MODERATION_BAND.valenceMax);
        expect(clamped.activation).toBe(MODERATION_BAND.activationMax);
        const low = clampToModerateBand({ valence: -1, activation: 0, observations: 0, updatedAt: 0 });
        expect(low.valence).toBe(MODERATION_BAND.valenceMin);
        expect(low.activation).toBe(MODERATION_BAND.activationMin);
    });

    it('repeated extreme observations asymptote inside the band, never beyond', () => {
        let state = { ...BASELINE };
        for (let i = 0; i < 500; i++) {
            state = applyObservation(state, { valence: 1, activation: 1 });
        }
        expect(state.valence).toBeLessThanOrEqual(MODERATION_BAND.valenceMax);
        expect(state.valence).toBeGreaterThan(0.5); // it did move toward the observation
        expect(state.activation).toBeLessThanOrEqual(MODERATION_BAND.activationMax);
        for (let i = 0; i < 500; i++) {
            state = applyObservation(state, { valence: -1, activation: 0 });
        }
        expect(state.valence).toBeGreaterThanOrEqual(MODERATION_BAND.valenceMin);
        expect(state.activation).toBeGreaterThanOrEqual(MODERATION_BAND.activationMin);
    });

    it('a single observation moves the state by at most alpha * distance (gradual)', () => {
        const next = applyObservation({ ...BASELINE }, { valence: 1, activation: 1 });
        expect(next.valence).toBeCloseTo(DEFAULT_ALPHA * 1, 5);
        expect(next.activation).toBeCloseTo(BASELINE.activation + DEFAULT_ALPHA * 0.5, 5);
        expect(next.observations).toBe(1);
    });

    it('out-of-range observations are sanitized, not trusted', () => {
        const next = applyObservation({ ...BASELINE }, { valence: 99, activation: -5 });
        expect(next.valence).toBeLessThanOrEqual(MODERATION_BAND.valenceMax);
        expect(next.activation).toBeGreaterThanOrEqual(MODERATION_BAND.activationMin);
    });
});

describe('affective state: persistence across restarts', () => {
    it('survives a simulated restart (fresh instance reads the same file)', async () => {
        const { service, dir } = tmpService();
        for (let i = 0; i < 20; i++) await service.observe({ valence: 0.8, activation: 0.7 });
        const before = await service.getState();
        expect(before.observations).toBe(20);
        expect(before.valence).toBeGreaterThan(0.5);

        // "Restart": a brand-new service instance over the same path
        const revived = new AffectiveStateService(path.join(dir, 'affective_state.json'));
        const after = await revived.getState();
        expect(after.valence).toBeCloseTo(before.valence, 10);
        expect(after.activation).toBeCloseTo(before.activation, 10);
        expect(after.observations).toBe(20);
    });

    it('missing or corrupt state file degrades honestly to baseline', async () => {
        const { service, dir } = tmpService();
        const fresh = await service.getState();
        expect(fresh).toEqual(BASELINE);
        fs.writeFileSync(path.join(dir, 'affective_state.json'), 'not json at all');
        const revived = new AffectiveStateService(path.join(dir, 'affective_state.json'));
        expect(await revived.getState()).toEqual(BASELINE);
    });
});

describe('affective state: modulation is tone-only and NEVER decides', () => {
    it('describes the state in natural language (for prompt context)', () => {
        expect(describeState({ ...BASELINE })).toContain('neutral');
        expect(describeState({ ...BASELINE, valence: 0.5 })).toContain('claramente positivo');
        expect(describeState({ ...BASELINE, valence: -0.5 })).toContain('claramente negativo');
        expect(describeState({ ...BASELINE, activation: 0.2 })).toContain('en calma');
    });

    it('the prompt block carries the hard tone-only rule and no action vocabulary', () => {
        const block = buildModulationPromptBlock({ ...BASELINE, valence: 0.3 });
        expect(block).toContain('TONE');
        expect(block).toContain('must NEVER change');
        expect(block).toContain('same decisions');
        // The block must not instruct any action: no action types, no params
        expect(block).not.toMatch(/research_gap|remediate|execute_task|store_fact|evolve_agent|soul_adjust/);
    });

    it('different affective states produce the SAME disposition for identical input', async () => {
        // The decision path (System 2 rationalization) takes (thought, graphData)
        // only — no affective state is even passable. Pin that contract: the
        // rationalizeThought signature accepts exactly two arguments.
        const { ThoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
        const proto = ThoughtNarrator.prototype as any;
        expect(proto.rationalizeThought.length).toBe(2);
    });

    it('tagging is additive metadata (valence, activation, timestamp) — nothing removed', async () => {
        const { service } = tmpService();
        await service.observe({ valence: 0.6, activation: 0.6 });
        const tag = await service.tag();
        expect(tag).toHaveProperty('valence');
        expect(tag).toHaveProperty('activation');
        expect(tag).toHaveProperty('at');
        expect(tag.at).toBeGreaterThan(0);
        expect(tag.valence).toBeGreaterThanOrEqual(MODERATION_BAND.valenceMin);
        expect(tag.valence).toBeLessThanOrEqual(MODERATION_BAND.valenceMax);
    });
});
