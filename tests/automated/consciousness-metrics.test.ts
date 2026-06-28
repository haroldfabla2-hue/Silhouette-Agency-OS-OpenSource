/**
 * AUTOMATED TEST SUITE: Cognitive-state engine (phi composite index)
 * Verifies the phi score is a transparent, explainable weighted composite —
 * not a magic number — and that weights sum to 1.
 */
import { describe, it, expect } from 'vitest';

describe('Cognitive-state engine', () => {
    it('exposes a transparent phi breakdown with normalized factors', async () => {
        const { consciousness } = await import('../../services/consciousnessEngine');
        const breakdown = consciousness.getPhiBreakdown();

        expect(breakdown).toHaveProperty('memoryFactor');
        expect(breakdown).toHaveProperty('throughputFactor');
        expect(breakdown).toHaveProperty('emergenceFactor');
        expect(breakdown).toHaveProperty('networkFactor');
        expect(breakdown).toHaveProperty('contributions');
        expect(breakdown).toHaveProperty('phiScore');
    });

    it('uses weights that sum to 1 (well-formed composite)', async () => {
        const { consciousness } = await import('../../services/consciousnessEngine');
        const { weights } = consciousness.getPhiBreakdown();
        const sum = weights.memory + weights.throughput + weights.emergence + weights.network;
        expect(sum).toBeCloseTo(1.0, 5);
    });

    it('keeps every normalized factor within [0,1]', async () => {
        const { consciousness } = await import('../../services/consciousnessEngine');
        const b = consciousness.getPhiBreakdown();
        for (const f of [b.memoryFactor, b.throughputFactor, b.emergenceFactor, b.networkFactor]) {
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThanOrEqual(1);
        }
    });
});
