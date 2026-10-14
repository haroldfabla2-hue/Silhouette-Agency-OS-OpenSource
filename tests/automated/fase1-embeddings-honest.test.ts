import { describe, it, expect } from 'vitest';
import fs from 'fs';

// FASE1 PR-C: the deep-memory write path used a fragile destructured import
// ("generateEmbedding is not a function" killed persistence on older builds),
// the fallback warn could not tell "no provider" from "env mismatch", and
// /v1/memory/state said nothing about whether embeddings can work at all.

const continuum = fs.readFileSync('services/continuumMemory.ts', 'utf8');
const routes = fs.readFileSync('server/routes/v1/memory.routes.ts', 'utf8');

describe('embedding pipeline is resilient and honest', () => {
    it('write path uses the resilient init-order pattern', () => {
        expect(continuum).toContain('geminiMod.geminiService?.generateEmbedding || geminiMod.generateEmbedding');
        expect(continuum).toContain("typeof embedFn === 'function'");
    });
    it('distinguishes unavailable provider from env mismatch', () => {
        expect(continuum).toContain('Embedding UNAVAILABLE');
        expect(continuum).toContain('env mismatch');
    });
    it('/v1/memory/state exposes embedding availability', () => {
        expect(routes).toContain('embeddings');
        expect(routes).toContain('minimaxService.isAvailable()');
        expect(routes).toContain('hasGeminiKey()');
    });
});
