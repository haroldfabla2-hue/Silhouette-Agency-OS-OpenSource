import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'crypto';

// R5 root fix: facts used to live in three divergent stores with no shared
// identity, no owner scoping on similarity search, and the model's declared
// provenance was trusted without any backing citation. These tests pin the
// new contract: SQLite facts table as durable source, graph/continuum as
// projections under the same id, citation-verified provenance, owner
// isolation, and quarantine (soft retract, legacy import as hypothesis).

import { factRepository } from '../../services/memory/factRepository';
import { sqliteService } from '../../services/sqliteService';
import { factExtractor } from '../../services/factExtractor';

// Importing factRepository boots the continuumMemory singleton, whose
// constructor fires dynamic imports (dreamerService -> powerManager) and a
// Redis connection. Drain and close explicitly so teardown is deterministic
// (same pattern as memory-stats-route.test.ts; fixes "Closing rpc while
// fetch was pending" on the CI Node 22 leg).
afterAll(async () => {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    mod.dreamer?.stopDreamingLoop();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect();
});

const owner = () => `test-owner-${crypto.randomUUID()}`;

describe('R5 fact repository', () => {
    it('round-trip: addFact persists to SQLite and getFacts reads the same record back', async () => {
        const o = owner();
        const receipt = await factRepository.addFact({
            type: 'PREFERENCE', content: 'The user prefers tea over coffee',
            subject: 'USER', attribute: 'beverage', value: 'tea',
            source: 'USER_STATED', quote: 'I prefer tea over coffee',
            status: 'verified', confidence: 0.95
        }, o);

        expect(receipt.action).toBe('ADD');
        expect(receipt.sqliteRows).toBe(1);
        expect(receipt.projections).toHaveLength(2); // graph + continuum, each with honest ok flag

        const facts = factRepository.getFacts(o);
        expect(facts).toHaveLength(1);
        expect(facts[0].id).toBe(receipt.id);
        expect(facts[0].content).toBe('The user prefers tea over coffee');
        expect(facts[0].source).toBe('USER_STATED');
        expect(facts[0].quote).toBe('I prefer tea over coffee');
        expect(facts[0].status).toBe('verified');
        expect(facts[0].retractedAt).toBeNull();
    });

    it('updateFact changes content across reads; receipt reports rows', async () => {
        const o = owner();
        const { id } = await factRepository.addFact({
            type: 'FACT', content: 'The user works at Acme', attribute: 'employer', value: 'Acme',
            source: 'USER_STATED', quote: 'I work at Acme', status: 'verified', confidence: 0.9
        }, o);

        const receipt = await factRepository.updateFact(id, {
            content: 'The user works at Globex', value: 'Globex', confidence: 0.95
        }, o);
        expect(receipt.sqliteRows).toBe(1);

        const fact = factRepository.getFact(id, o);
        expect(fact?.content).toBe('The user works at Globex');
        expect(fact?.value).toBe('Globex');
        expect(fact?.updatedAt).toBeGreaterThanOrEqual(fact!.createdAt);
    });

    it('retractFact soft-deletes: hidden from reads, evidence row survives (quarantine)', async () => {
        const o = owner();
        const { id } = await factRepository.addFact({
            type: 'FACT', content: 'Temporary fact', source: 'USER_INFERRED',
            status: 'hypothesis', confidence: 0.4
        }, o);

        const receipt = await factRepository.retractFact(id, o);
        expect(receipt.sqliteRows).toBe(1);

        expect(factRepository.getFact(id, o)).toBeNull(); // gone from normal reads
        const kept = factRepository.getFact(id, o, true);
        expect(kept).not.toBeNull();                      // evidence survives
        expect(kept?.retractedAt).not.toBeNull();
        // second retract is a no-op (already retracted)
        const again = await factRepository.retractFact(id, o);
        expect(again.sqliteRows).toBe(0);
    });

    it('owner isolation: reads, similarity search and mutations never cross owners', async () => {
        const a = owner(); const b = owner();
        const { id: idA } = await factRepository.addFact({
            type: 'PERSONAL', content: 'The user is named Alice', attribute: 'name', value: 'Alice',
            source: 'USER_STATED', quote: 'my name is Alice', status: 'verified', confidence: 0.99
        }, a);
        await factRepository.addFact({
            type: 'PERSONAL', content: 'The user is named Bob', attribute: 'name', value: 'Bob',
            source: 'USER_STATED', quote: 'my name is Bob', status: 'verified', confidence: 0.99
        }, b);

        expect(factRepository.getFacts(a).map(f => f.value)).toEqual(['Alice']);
        expect(factRepository.getFacts(b).map(f => f.value)).toEqual(['Bob']);

        // findSimilar is owner-scoped (was: graph query across ALL owners)
        const sim = factRepository.findSimilar({ attribute: 'name', value: 'Alice' }, a);
        expect(sim.length).toBe(1);
        expect(sim[0].value).toBe('Alice');

        // B cannot retract A's fact (owner-scoped WHERE clause)
        const forged = await factRepository.retractFact(idA, b);
        expect(forged.sqliteRows).toBe(0);
        expect(factRepository.getFact(idA, a)).not.toBeNull();
    });

    it('legacy import: graph-fallback facts enter the repository as LEGACY hypotheses, once', async () => {
        const o = owner();
        const legacyId = crypto.randomUUID();
        sqliteService.db.prepare(
            'INSERT OR REPLACE INTO graph_nodes (id, label, name, properties, last_updated) VALUES (?, ?, ?, ?, ?)'
        ).run(legacyId, 'Fact', 'legacy', JSON.stringify({
            type: 'FACT', content: 'The user once mentioned surfing', confidence: 0.8, createdAt: Date.now()
        }), Date.now());

        const imported = factRepository.importLegacyFacts(o);
        expect(imported).toBeGreaterThanOrEqual(1);

        const fact = factRepository.getFact(legacyId, o);
        expect(fact?.source).toBe('LEGACY');
        expect(fact?.status).toBe('hypothesis'); // unverifiable history is downgraded, not erased
        expect(fact?.quote).toBeNull();

        // idempotent: a second import adds nothing (INSERT OR IGNORE on shared id)
        const again = factRepository.importLegacyFacts(o);
        expect(again).toBe(0);
    });

    it('citation check: USER_STATED without a verifiable quote is downgraded to an inference', () => {
        const verify = (fact: any, msg?: string) => (factExtractor as any).verifyCitation(fact, msg);
        const userMessage = 'I work at Acme and my name is Alberto';

        // quote literally present -> stays USER_STATED (case-insensitive)
        const kept = verify({
            type: 'FACT', content: 'The user works at Acme', confidence: 0.9,
            source: 'USER_STATED', quote: 'I work at Acme'
        }, userMessage);
        expect(kept.source).toBe('USER_STATED');
        expect(kept.confidence).toBe(0.9);

        // paraphrased / absent quote -> downgraded to USER_INFERRED hypothesis
        const downgraded = verify({
            type: 'FACT', content: 'The user is an engineer', confidence: 0.9,
            source: 'USER_STATED', quote: 'I am an engineer'
        }, userMessage);
        expect(downgraded.source).toBe('USER_INFERRED');
        expect(downgraded.quote).toBeUndefined();
        expect(downgraded.confidence).toBeLessThanOrEqual(0.6);

        // no quote at all -> downgraded
        const noQuote = verify({
            type: 'FACT', content: 'The user works at Acme', confidence: 0.8,
            source: 'USER_STATED'
        }, userMessage);
        expect(noQuote.source).toBe('USER_INFERRED');

        // inferences pass through untouched
        const inferred = verify({
            type: 'FACT', content: 'The user might like tea', confidence: 0.5,
            source: 'USER_INFERRED'
        }, userMessage);
        expect(inferred.source).toBe('USER_INFERRED');
        expect(inferred.confidence).toBe(0.5);
    });
});
