import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { buildIdentity, LOCAL_EMBEDDING_IDENTITY, geminiIdentity } from '../../services/embeddingIdentity';
import { validEmbedding } from '../../services/memoryRetrieval';

// P0-2 (2026-10-17): deep memory semantic search never crossed identities -
// writes embedded with Minimax (or unlabeled) while queries embedded with
// Gemini-768, and identity came from env vars absent in prod. The fix: one
// resolver returns vector + TRUE identity, LanceDB projects per identity.

describe('embedding identity: single builder, stable hashing', () => {
    it('identity objects always serialize with the same key order (table-name stability)', () => {
        const a = buildIdentity('gemini-embedding-001', '1', 768);
        expect(JSON.stringify(a)).toBe('{"model":"gemini-embedding-001","version":"1","dimension":768}');
        expect(JSON.stringify(geminiIdentity('gemini-embedding-001'))).toBe(JSON.stringify(a));
    });
    it('local fallback identity is honest (384-dim, a distinct vector space)', () => {
        expect(LOCAL_EMBEDDING_IDENTITY).toEqual({ model: 'Xenova/all-MiniLM-L6-v2', version: '1', dimension: 384 });
    });
    it('validEmbedding accepts matching and rejects crossing dimensions', () => {
        expect(validEmbedding(new Array(768).fill(0.1), geminiIdentity('m'))).toBe(true);
        expect(validEmbedding(new Array(384).fill(0.1), geminiIdentity('m'))).toBe(false);
        expect(validEmbedding(new Array(384).fill(0.1), LOCAL_EMBEDDING_IDENTITY)).toBe(true);
        expect(validEmbedding(new Array(768).fill(0), geminiIdentity('m'))).toBe(false); // all-zero rejected
    });
});

const continuum = fs.readFileSync('services/continuumMemory.ts', 'utf8');
const gemini = fs.readFileSync('services/geminiService.ts', 'utf8');

describe('deep memory write and read share one identity resolver', () => {
    it('write path tags the TRUE identity and never labels from env', () => {
        expect(continuum).toContain('nodeToStore.embeddingIdentity = embedded.identity');
        expect(continuum).not.toContain('MEMORY_WRITE_MODEL');
        expect(continuum).not.toContain('minimaxService');
    });
    it('query path searches the per-identity LanceDB projection', () => {
        expect(continuum).toContain('lancedbService.search(embedded.vector, 50, scopeSql(scope), embedded.identity)');
        expect(continuum).not.toContain('MEMORY_QDRANT_MODEL');
        expect(continuum).not.toContain('MEMORY_QUERY_MODEL');
    });
    it('qdrant is only touched when connected and the dimension matches', () => {
        expect(continuum).toContain('vectorMemory.isReady()');
        expect(continuum).toContain('embedded.identity.dimension === 768');
    });
    it('geminiService has a single embedding path that reports its true source', () => {
        expect(gemini).toContain('generateEmbeddingWithIdentity');
        expect(gemini).toContain('identity: LOCAL_EMBEDDING_IDENTITY');
        expect(gemini).toContain('identity: geminiIdentity(DEFAULT_GEMINI_EMBEDDING_MODEL)');
        expect(gemini).toContain('identity: geminiIdentity(FALLBACK_GEMINI_EMBEDDING_MODEL)');
    });
    it('backfill reuses the live resolver and keeps failures pending', () => {
        expect(continuum).toContain('backfillMemoryEmbeddings');
        expect(continuum).toContain('pendingEmbeddings');
        expect(continuum).toContain('projectEmbedding(node, embedded.vector, embedded.identity)');
    });
});
