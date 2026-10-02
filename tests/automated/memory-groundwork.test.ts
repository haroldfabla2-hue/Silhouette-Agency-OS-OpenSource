import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { MemoryEvidence } from '../../services/memoryEvidence';
import { proposeExtractedClaim, reviewCandidate } from '../../services/temporalClaimExtraction';
import { encodeFileContract, runApprovedFileProcedure, testFileProcedure } from '../../services/procedureFileSandbox';
describe('evidence extraction and file sandbox groundwork', () => {
    it('requires exact evidence and owner, refuses negation and conditional truth shortcuts', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'claims-'));
        try {
            const registry = new MemoryEvidence(dir);
            const source = { id: 'source-1', ownerId: 'alice', text: 'Alice works at Bocau', observedAt: 100 };
            const candidate = { subject: 'Alice', predicate: 'works at', object: 'Bocau', polarity: true, validFrom: 100, sourceId: source.id, start: 0, end: source.text.length };
            expect(reviewCandidate(candidate, source, 'bob').verdict).toBe('REVIEW_REQUIRED');
            expect(reviewCandidate({ ...candidate, object: 'Google' }, source, 'alice').verdict).toBe('REVIEW_REQUIRED');
            expect(reviewCandidate({ ...candidate, polarity: false }, source, 'alice').verdict).toBe('REVIEW_REQUIRED');
            expect((await proposeExtractedClaim(registry, candidate, source, 'alice')).claim?.state).toBe('PROPOSED');
            const uncertain = { ...source, text: 'Maybe Alice works at Bocau' };
            expect(reviewCandidate({ ...candidate, end: uncertain.text.length }, uncertain, 'alice').verdict).toBe('REVIEW_REQUIRED');
            expect((await registry.claimsAt('alice', 100)).length).toBe(1);
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
    it('executes real file contracts only after approval and confines them to a fresh temp directory', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'procedures-'));
        try {
            const registry = new MemoryEvidence(dir), text = 'verified sandbox output';
            const steps = [encodeFileContract({ schema: 1, steps: [{ op: 'write', path: 'output/result.txt', text }, { op: 'assert', path: 'output/result.txt', sha256: createHash('sha256').update(text).digest('hex') }] })];
            const p = await registry.proposeProcedure({ id: 'p', version: 1, ownerId: 'alice', sourceIds: ['execution-1'], preconditions: ['isolated directory'], steps, postconditions: ['content hash'], context: 'file-only test' }, ['execution-1']);
            await expect(runApprovedFileProcedure(registry, 'p', 1, 'alice')).rejects.toThrow('not approved');
            const receipt = await testFileProcedure(p);
            expect(receipt.succeeded).toBe(true); expect(receipt.operations).toBe(2);
            await registry.recordProcedureOutcome('p', 1, 'alice', receipt.succeeded);
            await registry.approveProcedure('p', 1, 'alice');
            expect((await runApprovedFileProcedure(registry, 'p', 1, 'alice')).succeeded).toBe(true);
            await expect(runApprovedFileProcedure(registry, 'p', 1, 'bob')).rejects.toThrow('not approved');
            await expect(testFileProcedure({ ...p, steps: [encodeFileContract({ schema: 1, steps: [{ op: 'write', path: '../escape.txt', text }] })] })).rejects.toThrow('Unsafe');
            const failed = await testFileProcedure({ ...p, steps: [encodeFileContract({ schema: 1, steps: [{ op: 'assert', path: 'missing.txt', sha256: '0'.repeat(64) }] })] });
            expect(failed.succeeded).toBe(false);
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
