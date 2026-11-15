/**
 * AUTOMATED TEST SUITE: Sensory drivers (haptics + olfactory)
 * Verifies they are functional software state machines with pluggable hardware
 * backends and queryable, TTL-tracked state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../services/systemBus', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/systemBus')>();
    return { ...actual, systemBus: { emit: vi.fn(), subscribe: vi.fn(), on: vi.fn() } };
});

import { HapticsDriver } from '../../services/sensory/hapticsDriver';
import { OlfactoryDriver } from '../../services/sensory/olfactoryDriver';

describe('Haptics driver', () => {
    afterEach(() => vi.restoreAllMocks());

    it('reports software mode when no backend is registered', async () => {
        const d = new HapticsDriver();
        await d.initialize();
        expect(d.hasHardware()).toBe(false);
        expect(d.getState().hardware).toBeNull();
        expect(d.getState().ready).toBe(true);
    });

    it('tracks active emissions and history', async () => {
        const d = new HapticsDriver();
        await d.initialize();
        await d.emit({ intensity: 0.5, pattern: 'PULSE', durationMs: 5000 });
        expect(d.getActiveEmissions().length).toBe(1);
        expect(d.getState().emitted).toBe(1);
    });

    it('drives a registered hardware backend', async () => {
        const d = new HapticsDriver();
        const play = vi.fn();
        d.registerBackend({ name: 'test-rig', play });
        await d.initialize();
        await d.triggerHeartbeatPulse();
        expect(play).toHaveBeenCalledTimes(1);
        expect(d.getState().hardware).toBe('test-rig');
    });

    it('buffers emissions before initialize and flushes them after', async () => {
        const d = new HapticsDriver();
        await d.emit({ intensity: 1, pattern: 'WAVE', durationMs: 3000 }); // before init → buffered
        expect(d.getState().emitted).toBe(0);
        await d.initialize();
        expect(d.getState().emitted).toBe(1);
    });
});

describe('Olfactory driver', () => {
    it('tracks active scents and exposes remaining TTL', async () => {
        const d = new OlfactoryDriver();
        await d.initialize();
        await d.release({ chemicalSignature: 'OZONE', concentration: 0.7, dissolveRateMs: 5000 });
        expect(d.getActiveScents()).toContain('OZONE');
        const state = d.getState();
        expect(state.active[0].chemicalSignature).toBe('OZONE');
        expect(state.active[0].remainingMs).toBeGreaterThan(0);
    });

    it('drives a registered diffuser backend', async () => {
        const d = new OlfactoryDriver();
        const diffuse = vi.fn();
        d.registerBackend({ name: 'diffuser-x', diffuse });
        await d.initialize();
        await d.release({ chemicalSignature: 'PINE', concentration: 0.4, dissolveRateMs: 1000 });
        expect(diffuse).toHaveBeenCalledTimes(1);
        expect(d.hasHardware()).toBe(true);
    });
});
