import { describe, it, expect } from 'vitest';
import fs from 'fs';

// FASE1 PR-C: the deep-memory write path used a fragile destructured import
// ("generateEmbedding is not a function" killed persistence on older builds),
// the fallback warn could not tell "no provider" from "env mismatch", and
// /v1/memory/state said nothing about whether embeddings can work at all.

const continuum = fs.readFileSync('services/continuumMemory.ts', 'utf8');
const routes = fs.readFileSync('server/routes/v1/memory.routes.ts', 'utf8');

describe('embedding pipeline is resilient and honest', () => {
    it('write and query paths share the identity-aware resolver', () => {
        expect(continuum).toContain('generateEmbeddingWithIdentity');
        expect(continuum).toContain('geminiMod.geminiService?.generateEmbeddingWithIdentity || geminiMod.generateEmbeddingWithIdentity');
        expect(continuum).toContain('nodeToStore.embeddingIdentity = embedded.identity');
    });
    it('no env var can label or gate embedding identity anymore', () => {
        expect(continuum).toContain('Embedding UNAVAILABLE');
        expect(continuum).not.toContain('MEMORY_QDRANT_MODEL');
        expect(continuum).not.toContain('MEMORY_QUERY_MODEL');
        expect(continuum).not.toContain('MEMORY_WRITE_MODEL');
    });
    it('/v1/memory/state exposes embedding availability', () => {
        expect(routes).toContain('embeddings');
        expect(routes).toContain('minimaxService.isAvailable()');
        expect(routes).toContain('hasGeminiKey()');
    });
});
