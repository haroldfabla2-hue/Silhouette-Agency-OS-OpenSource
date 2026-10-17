import { GEMINI_EMBEDDING_DIMENSIONS } from './llm/defaultModels';

/**
 * SINGLE BUILDER for embedding identities. lancedbService derives the
 * per-identity projection table name from JSON.stringify(identity), so every
 * identity object in the system must be built here with the same key order
 * ({ model, version, dimension }) - otherwise writes and queries land in
 * different tables and semantic search silently never crosses.
 */
export const buildIdentity = (model: string, version: string, dimension: number): EmbeddingIdentity =>
    ({ model, version, dimension });

/** Local fallback engine (Transformers.js), an honest 384-dim identity space. */
export const LOCAL_EMBEDDING_IDENTITY: EmbeddingIdentity = buildIdentity('Xenova/all-MiniLM-L6-v2', '1', 384);

/** Identity for a Gemini embedding produced by the given model id. */
export const geminiIdentity = (model: string): EmbeddingIdentity =>
    buildIdentity(model, '1', GEMINI_EMBEDDING_DIMENSIONS);

import type { EmbeddingIdentity } from './memoryRetrieval';
export type { EmbeddingIdentity } from './memoryRetrieval';
