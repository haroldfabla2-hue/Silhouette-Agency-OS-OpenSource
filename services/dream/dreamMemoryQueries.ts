import type { EmbedText } from '../memoryVectorContract';
import type { EmbeddingIdentity } from '../memoryRetrieval';
/** Retrieval used by Dreamer, independent of loop startup, LLMs and app bootstrap. */
export interface DreamVectorBackend {
    searchMemory(vector: number[], limit: number, filter?: Record<string, string>, identity?: EmbeddingIdentity): Promise<any[]>;
    searchDistantMemories(vector: number[], minScore: number, maxScore: number, limit: number, identity?: EmbeddingIdentity): Promise<any[]>;
}
export class DreamMemoryQueries {
    constructor(public readonly memory: DreamVectorBackend,
        public readonly embed: EmbedText) {}

    /** Unknown retrieval is not evidence of novelty. Never commit on this failure. */
    async isRedundant(content: string): Promise<boolean> {
        const embedded = await this.embed(content);
        if (!embedded) throw new Error('Dreamer duplicate check unavailable: no embedding');
        // The collection also contains code, brands and ordinary memories.
        // A similar code chunk is not a duplicate intuition.
        const matches = await this.memory.searchMemory(embedded.vector, 1, { tags: 'INTUITION' }, embedded.identity);
        return matches.length > 0 && matches[0].score > 0.90;
    }
}
