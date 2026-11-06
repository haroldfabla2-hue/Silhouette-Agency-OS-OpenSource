import { MemoryNode, MemoryTier } from '../types';

export class LanceDbService {
    constructor() { }
    async store(node: MemoryNode, vector?: number[]): Promise<void> { console.log("[MOCK] Storing node:", node.id); }
    async search(queryVector: number[], limit: number = 10, filter?: string): Promise<MemoryNode[]> { return []; }
    async getAllNodes(): Promise<MemoryNode[]> { return []; }
    async getNodesByTier(tier: MemoryTier, limit: number = 1000): Promise<MemoryNode[]> { return []; }
    async countNodesByTier(tier: MemoryTier): Promise<number> { return 0; }
    async getTierCounts(): Promise<Record<MemoryTier, number>> {
        return {
            [MemoryTier.WORKING]: 0,
            [MemoryTier.MEDIUM]: 0,
            [MemoryTier.LONG]: 0,
            [MemoryTier.DEEP]: 0,
        };
    }
    async drop() { }
}

export const lancedbService = new LanceDbService();
