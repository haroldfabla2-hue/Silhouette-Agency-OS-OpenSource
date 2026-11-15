import { describe, it, expect } from 'vitest';
import { buildTemporalContext } from '../../services/temporalContext';

describe('buildTemporalContext', () => {
    it('produces a measured server-clock context with the shape the UI reads', () => {
        const at = new Date(2026, 0, 1, 8, 5, 3); // Jan 1 2026, 08:05:03 local
        const tc = buildTemporalContext(at);
        expect(tc.now).toBe('2026-01-01 08:05:03');
        expect(tc.now.split(' ')[0]).toBe('2026-01-01'); // DATE card
        expect(tc.now.split(' ')[1]).toBe('08:05:03');   // NOW card
        expect(tc.dayOfYear).toBe(1);
        expect(tc.dayOfWeek).toBe('Thursday');
        expect(tc.timezone.length).toBeGreaterThan(0);
        expect(tc.source).toBe('server-clock');
    });

    it('computes dayOfYear across the year boundary', () => {
        expect(buildTemporalContext(new Date(2026, 11, 31, 23, 59, 59)).dayOfYear).toBe(365);
    });
});
