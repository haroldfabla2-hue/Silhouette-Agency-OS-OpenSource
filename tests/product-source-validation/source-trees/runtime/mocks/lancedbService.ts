// Browser shim for lancedbService.
// Vector memory lives on the SERVER. Silently returning [] would fabricate an
// "empty memory", so operations fail loudly with an honest UNAVAILABLE.

import { MemoryNode } from '../types';

const unavailable = (): Error => new Error(
    'UNAVAILABLE: LanceDB memory is server-side only. Use the backend memory API instead.'
);

export class LanceDbService {
    async store(_node: MemoryNode, _vector?: number[]): Promise<never> { throw unavailable(); }
    async search(_queryVector: number[], _limit: number = 10, _filter?: string): Promise<never> { throw unavailable(); }
    async getAllNodes(): Promise<never> { throw unavailable(); }
    async drop(): Promise<never> { throw unavailable(); }
}

export const lancedbService = new LanceDbService();
