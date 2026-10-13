/**
 * Dream provenance (roadmap item 4): dream intuitions must carry structured
 * IDs of the source memories they were synthesized from (parentIds), so any
 * consolidated knowledge can be audited back to its origins. Eternal-memory
 * safe: additive only, nothing removed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MemoryNodeSchema } from '../../services/memorySchema';
import { MemoryTier } from '../../types';

const readSrc = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');

describe('dream provenance', () => {
    it('MemoryNodeSchema accepts and preserves parentIds', () => {
        const parsed = MemoryNodeSchema.parse({
            id: 'n1', content: 'an intuition', timestamp: Date.now(),
            tier: MemoryTier.DEEP, importance: 0.8, tags: ['INTUITION'],
            accessCount: 0, lastAccess: Date.now(),
            parentIds: ['src-a', 'src-b']
        });
        expect(parsed.parentIds).toEqual(['src-a', 'src-b']);
    });

    it('continuum.store threads provenance through an additive optional param', () => {
        const src = readSrc('services/continuumMemory.ts');
        expect(src).toMatch(/store\(content: string, tier: MemoryTier = MemoryTier\.ULTRA_SHORT, tags: string\[\] = \[\], skipIngestion: boolean = false, extra\?: \{ parentIds\?: string\[\] \}\)/);
        expect(src).toMatch(/parentIds: extra\?\.parentIds\?\.length \? extra\.parentIds : undefined/);
    });

    it('consolidateIntuition requires no sources (backward compatible) but forwards them when given', () => {
        const src = readSrc('services/dreamerService.ts');
        expect(src).toMatch(/consolidateIntuition\(content: string, sourceNodeIds: string\[\] = \[\]\)/);
        expect(src).toMatch(/\{ parentIds: sourceNodeIds \}/);
    });

    it('every consolidation call site passes its source node IDs', () => {
        const src = readSrc('services/dreamerService.ts');
        const calls = src.match(/consolidateIntuition\(/g) || [];
        // 1 definition + 5 call sites, all call sites pass a second argument
        expect(calls.length).toBe(6);
        const withSources = src.match(/consolidateIntuition\([^)]*,\s*(\[|memories\.map)/g) || [];
        expect(withSources.length).toBe(5);
    });

    it('dreamer has no delete path (eternal memory)', () => {
        const src = readSrc('services/dreamerService.ts');
        expect(src).not.toMatch(/deleteNode\s*\(/);
    });
});
