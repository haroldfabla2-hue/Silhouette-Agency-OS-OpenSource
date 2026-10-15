import { MemoryTier } from '../types';

/**
 * Pagination for the memory-state snapshot.
 *
 * The Continuum explorer used to pull the FULL node set (~1.2MB) every 2s.
 * This flattens the per-tier record in stable tier order and slices pages;
 * per-tier totals always travel so a partial page never looks like the
 * whole memory.
 */

const TIER_ORDER: MemoryTier[] = [MemoryTier.WORKING, MemoryTier.MEDIUM, MemoryTier.LONG, MemoryTier.DEEP];

export const DEFAULT_STATE_LIMIT = 100;
export const MAX_STATE_LIMIT = 500;

export interface StatePagination {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    totals: Record<MemoryTier, number>;
}

export function paginateNodes<T>(all: Record<MemoryTier, T[]>, limit: number, offset: number): { nodes: Record<MemoryTier, T[]>, pagination: StatePagination } {
    const totals = {
        [MemoryTier.WORKING]: all[MemoryTier.WORKING]?.length || 0,
        [MemoryTier.MEDIUM]: all[MemoryTier.MEDIUM]?.length || 0,
        [MemoryTier.LONG]: all[MemoryTier.LONG]?.length || 0,
        [MemoryTier.DEEP]: all[MemoryTier.DEEP]?.length || 0,
    } as Record<MemoryTier, number>;

    const flat: { tier: MemoryTier, node: T }[] = [];
    for (const tier of TIER_ORDER) {
        for (const node of all[tier] || []) flat.push({ tier, node });
    }

    const nodes: Record<MemoryTier, T[]> = {
        [MemoryTier.WORKING]: [],
        [MemoryTier.MEDIUM]: [],
        [MemoryTier.LONG]: [],
        [MemoryTier.DEEP]: [],
    };
    for (const { tier, node } of flat.slice(offset, offset + limit)) {
        nodes[tier].push(node);
    }

    return {
        nodes,
        pagination: {
            limit,
            offset,
            total: flat.length,
            hasMore: offset + limit < flat.length,
            totals
        }
    };
}
