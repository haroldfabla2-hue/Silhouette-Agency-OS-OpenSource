/**
 * [Ticket W7] universal_knowledge table — root cause was a DEAD writer path
 * (capabilityAwareness.initialize() never called) plus a latent schema poison
 * (first-record schema inference + vector: []). Fix: explicit empty table
 * creation with Arrow schema, validated writes, snapshot moved to sqlite KV.
 * Hermetic: every test uses a fresh tmp LanceDB directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LanceDbService, KNOWLEDGE_VECTOR_DIM } from '../../services/lancedbService';

const validVec = () => Array.from({ length: KNOWLEDGE_VECTOR_DIM }, (_, i) => i / KNOWLEDGE_VECTOR_DIM);

describe('W7 universal_knowledge table', () => {
    let dir: string;
    let svc: LanceDbService;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'lancedb-w7-'));
        svc = new LanceDbService(dir);
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('canonical dimension is 768 (matches LEGACY_EMBEDDING)', () => {
        expect(KNOWLEDGE_VECTOR_DIM).toBe(768);
    });

    it('ensureKnowledgeTable creates an EMPTY table with explicit schema, idempotently', async () => {
        await svc.ensureKnowledgeTable();
        await svc.ensureKnowledgeTable(); // second call: no-op, no throw
        const results = await svc.searchKnowledge(validVec(), 3);
        expect(results).toEqual([]); // honest empty, no "not ready" path
    });

    it('storeKnowledge with a valid 768-dim vector writes and is searchable', async () => {
        await svc.storeKnowledge({
            id: 'k1', content: 'agents can write files through the jail', category: 'fact',
            source: 'test', path: 'memory://k1', timestamp: Date.now(), vector: validVec(),
        });
        const results = await svc.searchKnowledge(validVec(), 3);
        expect(results.length).toBe(1);
        expect(results[0].id).toBe('k1');
    });

    it('storeKnowledge REFUSES an invalid vector (the latent schema poison), explicitly', async () => {
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...a: any[]) => { errors.push(a.join(' ')); };
        try {
            await svc.storeKnowledge({ id: 'poison', content: 'x', vector: [] }); // the old capabilityAwareness shape
            await svc.storeKnowledge({ id: 'poison2', content: 'x', vector: 'not-an-array' });
            await svc.storeKnowledge({ id: 'poison3', content: 'x', vector: validVec().map((v: number, i: number) => i === 5 ? NaN : v) });
        } finally {
            console.error = orig;
        }
        expect(errors.filter(e => e.includes('storeKnowledge REFUSED')).length).toBe(3);
        // and nothing was written: table stays empty (created explicitly, not by poison)
        await svc.ensureKnowledgeTable();
        const results = await svc.searchKnowledge(validVec(), 5);
        expect(results.length).toBe(0);
    });
});
