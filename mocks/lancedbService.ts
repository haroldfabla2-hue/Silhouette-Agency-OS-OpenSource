import { MemoryNode } from '../types';

export class LanceDbService {
    constructor() { }
    async store(node: MemoryNode, vector?: number[]): Promise<void> { console.log("[MOCK] Storing node:", node.id); }
    async search(queryVector: number[], limit: number = 10, filter?: string): Promise<MemoryNode[]> { return []; }
    async getAllNodes(): Promise<MemoryNode[]> { return []; }
    async drop() { }
}

export const lancedbService = new LanceDbService();
