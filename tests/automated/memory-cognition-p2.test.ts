import { describe, expect, it } from 'vitest';
import { MemoryTier, type MemoryNode } from '../../types';
import { activation, recordSignificantAccess, selectSleepBatch, verifyClaims } from '../../services/memoryCognition';
const node = (id: string, content = 'Alberto lives in Lima.'): MemoryNode => ({ id, content, timestamp: 0, tier: MemoryTier.LONG, importance: 0.5, tags: [], accessCount: 0, lastAccess: 0 });
describe('P2 retention and cited sleep safety', () => {
    it('decays over time without mutation, rate limits frequency, and protects obligations', () => {
        const original = node('a');
        expect(activation(original, 3600000).score).toBeGreaterThan(activation(original, 360000000).score);
        expect(original.significantAccesses).toBeUndefined();
        const accessed = recordSignificantAccess(original, 3600000);
        expect(recordSignificantAccess(accessed, 3600001)).toBe(accessed);
        expect(recordSignificantAccess(accessed, 7200000).significantAccesses).toEqual([3600000, 7200000]);
        expect(activation({ ...original, tags: ['OBLIGATION'] }, 360000000).score).toBeGreaterThan(activation(original, 3600000).score);
    });
    it('selects reproducibly with duplicate diversity and verifies every exact evidence span', () => {
        const sources = [node('b'), node('a'), node('c', 'Alberto now lives in Cusco.')];
        expect(selectSleepBatch(sources, 3, 1000).map(n => n.id)).toEqual(['a', 'c']);
        expect(verifyClaims([{ text: 'Alberto lives in Lima.', parentIds: ['a'] }], sources)).toBe(true);
        expect(verifyClaims([{ text: 'Alberto lives in Berlin.', parentIds: ['a'] }], sources)).toBe(false);
        expect(verifyClaims([{ text: 'Alberto lives in Lima.', parentIds: ['missing'] }], sources)).toBe(false);
        expect(verifyClaims([{ text: 'Alberto lives in Lima.', parentIds: [] }], sources)).toBe(false);
        expect(verifyClaims([{ text: undefined, parentIds: [] } as any], sources)).toBe(false);
    });
});
