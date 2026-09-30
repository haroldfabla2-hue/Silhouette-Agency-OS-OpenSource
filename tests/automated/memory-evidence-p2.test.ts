import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEvidence } from '../../services/memoryEvidence';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function registry() { const dir = await mkdtemp(join(tmpdir(), 'evidence-p2-')); dirs.push(dir); return { db: new MemoryEvidence(dir), dir }; }
describe('P2 real durable evidence registry', () => {
    it('preserves before/now history, marks overlapping conflicts and isolates owners after restart', async () => {
        const { db, dir } = await registry();
        const common = { subject: 'person:alberto', predicate: 'livesIn', polarity: true, observedAt: 100, sourceIds: ['episode1'], confidence: 0.9, ownerId: 'alberto' };
        const prior = await db.proposeClaim({ ...common, object: 'Lima', validFrom: 0, validTo: 10 }, ['episode1']);
        const current = await db.proposeClaim({ ...common, object: 'Cusco', validFrom: 10 }, ['episode1']);
        expect(current.supersedes).toBe(prior.id);
        expect((await db.claimsAt('alberto', 5))[0].object).toBe('Lima');
        const conflict = await db.proposeClaim({ ...common, object: 'Berlin', validFrom: 10 }, ['episode1']);
        expect(conflict.state).toBe('CONFLICTED');
        const restarted = new MemoryEvidence(dir);
        expect((await restarted.claimsAt('alberto', 11)).map(c => c.state)).toEqual(['CONFLICTED', 'CONFLICTED']);
        expect(await restarted.claimsAt('other', 11)).toEqual([]);
        await expect(db.proposeClaim({ ...common, object: 'Paris', validFrom: 0 }, [])).rejects.toThrow('unsupported');
    });
    it('requires run evidence, successful tests and approval, then revokes a failed procedure', async () => {
        const { db, dir } = await registry();
        const proposal = { id: 'skill', version: 1, ownerId: 'alberto', sourceIds: ['run1'], preconditions: ['input ready'], steps: ['validate input'], postconditions: ['input validated'], context: 'local sandbox' };
        await expect(db.proposeProcedure(proposal, [])).rejects.toThrow('execution evidence');
        await db.proposeProcedure(proposal, ['run1']);
        await expect(db.approveProcedure('skill', 1, 'alberto')).rejects.toThrow('Untested');
        expect(await db.actionableProcedures('alberto')).toEqual([]);
        await db.recordProcedureOutcome('skill', 1, 'alberto', true);
        await db.approveProcedure('skill', 1, 'alberto');
        expect((await new MemoryEvidence(dir).actionableProcedures('alberto')).length).toBe(1);
        expect(await db.actionableProcedures('other')).toEqual([]);
        await db.recordProcedureOutcome('skill', 1, 'alberto', false);
        expect(await db.actionableProcedures('alberto')).toEqual([]);
    });
});
