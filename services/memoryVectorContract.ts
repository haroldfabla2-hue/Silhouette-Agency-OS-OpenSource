import type { EmbeddingIdentity } from './memoryRetrieval';
export interface IdentifiedEmbedding { vector: number[]; identity: EmbeddingIdentity }
export type EmbedText = (text: string) => Promise<IdentifiedEmbedding | null>;
export const embedMemoryText: EmbedText = async text =>
    (await import('./geminiService')).generateEmbeddingWithIdentity(text);
