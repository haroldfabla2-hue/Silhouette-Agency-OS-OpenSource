import { calculateContainerCpuLoadPercent, parseCpuSetCores } from '../../services/system/cpuLoadService';

describe('cpuLoadService helpers', () => {
    it('parses cpuset ranges into a core count', () => {
        expect(parseCpuSetCores('0-3,6,8-9')).toBe(7);
    });

    it('returns 0 for invalid cpuset strings', () => {
        expect(parseCpuSetCores('')).toBe(0);
        expect(parseCpuSetCores('abc')).toBe(0);
    });

    it('normalizes container cpu usage against available CPUs', () => {
        expect(calculateContainerCpuLoadPercent(4_000_000, 1000, 4)).toBe(100);
        expect(calculateContainerCpuLoadPercent(1_000_000, 1000, 4)).toBe(25);
        expect(calculateContainerCpuLoadPercent(250_000, 1000, 4)).toBe(6.25);
    });

    it('clamps invalid measurements to zero', () => {
        expect(calculateContainerCpuLoadPercent(-1, 1000, 4)).toBe(0);
        expect(calculateContainerCpuLoadPercent(10_000, 0, 4)).toBe(0);
        expect(calculateContainerCpuLoadPercent(10_000, 1000, 0)).toBe(0);
    });
});
