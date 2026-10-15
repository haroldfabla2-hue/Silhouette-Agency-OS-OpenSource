import { describe, it, expect } from 'vitest';
import { paginateNodes, DEFAULT_STATE_LIMIT, MAX_STATE_LIMIT } from '../../services/memoryPagination';
import { MemoryTier } from '../../types';

const mk = (tier: MemoryTier, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${tier}-${i}`, tier }));

function state(w: number, m: number, l: number, d: number) {
    return {
        [MemoryTier.WORKING]: mk(MemoryTier.WORKING, w),
        [MemoryTier.MEDIUM]: mk(MemoryTier.MEDIUM, m),
        [MemoryTier.LONG]: mk(MemoryTier.LONG, l),
        [MemoryTier.DEEP]: mk(MemoryTier.DEEP, d),
    };
}

describe('paginateNodes', () => {
    it('handles an empty memory', () => {
        const { nodes, pagination } = paginateNodes(state(0, 0, 0, 0), 100, 0);
        expect(pagination.total).toBe(0);
        expect(pagination.hasMore).toBe(false);
        expect(nodes[MemoryTier.WORKING]).toEqual([]);
    });

    it('pages in stable tier order (WORKING first, DEEP last)', () => {
        const all = state(3, 2, 1, 1); // 7 nodes
        const page1 = paginateNodes(all, 4, 0);
        expect(page1.pagination.total).toBe(7);
        expect(page1.pagination.hasMore).toBe(true);
        expect(page1.nodes[MemoryTier.WORKING]).toHaveLength(3);
        expect(page1.nodes[MemoryTier.MEDIUM]).toHaveLength(1);
        const page2 = paginateNodes(all, 4, 4);
        expect(page2.nodes[MemoryTier.MEDIUM]).toHaveLength(1);
        expect(page2.nodes[MemoryTier.LONG]).toHaveLength(1);
        expect(page2.nodes[MemoryTier.DEEP]).toHaveLength(1);
        expect(page2.pagination.hasMore).toBe(false);
        // pages never overlap
        expect(page2.nodes[MemoryTier.MEDIUM][0].id).toBe('MEDIUM-1');
    });

    it('reports per-tier totals on every page, even an empty one', () => {
        const { pagination } = paginateNodes(state(5, 250, 10, 3), 100, 9999);
        expect(pagination.totals[MemoryTier.MEDIUM]).toBe(250);
        expect(pagination.total).toBe(268);
        expect(pagination.hasMore).toBe(false);
    });

    it('keeps defaults sane', () => {
        expect(DEFAULT_STATE_LIMIT).toBe(100);
        expect(MAX_STATE_LIMIT).toBe(500);
    });
});
