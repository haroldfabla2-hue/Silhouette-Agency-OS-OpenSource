/**
 * Introspection chokepoint - the REAL introspectionEngine enforces the
 * autonomy ceiling (enableIntrospection under master enabled) and the
 * PowerManager throttle inside runCognitiveCycle, so every route into the
 * engine (daemon task, heartbeat job, manual HTTP trigger) is governed.
 *
 * Declared doubles: configLoader, powerManager and systemBus are mocked; the
 * engine itself is real. The private observe() is stubbed with a sentinel
 * error so a pass-through is detectable without running the full cycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OFF = { enabled: false, allowEvolution: false, enableNarrative: false, enableIntrospection: false };
const ON = { enabled: true, allowEvolution: true, enableNarrative: true, enableIntrospection: true };

const knobs = {
    autonomy: { ...OFF },
    power: { isIntrospectionEnabled: true }
};

vi.mock('../../server/config/configLoader', () => ({
    configLoader: { getConfig: () => ({ autonomy: knobs.autonomy }) }
}));
vi.mock('../../services/powerManager', () => ({ powerManager: knobs.power }));
vi.mock('../../services/systemBus', () => ({
    systemBus: { emit: vi.fn(), on: vi.fn(), subscribe: vi.fn() }
}));

import { introspection } from '../../services/introspectionEngine';

const SENTINEL = new Error('OBSERVE_REACHED');

beforeEach(() => {
    knobs.autonomy = { ...OFF };
    knobs.power.isIntrospectionEnabled = true;
    // Stub the first stage of the cycle: reaching it proves the gates passed.
    (introspection as any).observe = vi.fn().mockRejectedValue(SENTINEL);
});

describe('runCognitiveCycle chokepoint', () => {
    it('skips before observe() when the ceiling is off', async () => {
        await expect(introspection.runCognitiveCycle()).resolves.toBeUndefined();
        expect((introspection as any).observe).not.toHaveBeenCalled();
    });

    it('skips when enableIntrospection=false even with evolution allowed', async () => {
        knobs.autonomy = { ...ON, enableIntrospection: false };
        await expect(introspection.runCognitiveCycle()).resolves.toBeUndefined();
        expect((introspection as any).observe).not.toHaveBeenCalled();
    });

    it('master off wins: skips even with enableIntrospection=true', async () => {
        knobs.autonomy = { ...ON, enabled: false };
        await expect(introspection.runCognitiveCycle()).resolves.toBeUndefined();
        expect((introspection as any).observe).not.toHaveBeenCalled();
    });

    it('skips when PowerManager throttles introspection (ceiling on)', async () => {
        knobs.autonomy = { ...ON };
        knobs.power.isIntrospectionEnabled = false;
        await expect(introspection.runCognitiveCycle()).resolves.toBeUndefined();
        expect((introspection as any).observe).not.toHaveBeenCalled();
    });

    it('proceeds into the cycle when ceiling and throttle allow', async () => {
        knobs.autonomy = { ...ON };
        await expect(introspection.runCognitiveCycle()).rejects.toBe(SENTINEL);
        expect((introspection as any).observe).toHaveBeenCalledTimes(1);
    });
});
