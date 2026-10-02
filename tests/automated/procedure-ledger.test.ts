import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ProcedureApprovalLedger } from '../../services/procedureApprovalLedger';
import type { Procedure } from '../../services/memoryEvidence';
const directories: string[] = []; const handles: ProcedureApprovalLedger[] = [];
afterEach(async () => { handles.splice(0).forEach(x => x.close()); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
const procedure = (): Procedure => ({ id: 'test', version: 1, ownerId: 'test-owner', sourceIds: ['test-execution'], preconditions: ['test'], postconditions: ['hash'], context: 'test-only', successfulRuns: 0, failedRuns: 0, state: 'PROPOSED', steps: [JSON.stringify({ schema: 1, steps: [{ op: 'write', path: 'out.txt', text: 'real' }, { op: 'assert', path: 'out.txt', sha256: createHash('sha256').update('real').digest('hex') }] })] });
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'ledger-')); directories.push(dir); const path = join(dir, 'ledger.sqlite'); const one = new ProcedureApprovalLedger(path), two = new ProcedureApprovalLedger(path); handles.push(one, two); return { one, two, path }; }
describe('actual durable SQLite approval and revocation', () => {
    it('rejects immutable edits, wrong owner/hash and unapproved reservations', async () => {
        const { one } = await setup(); const p = procedure(), hash = one.register(p);
        expect(() => one.register({ ...p, steps: [p.steps[0].replace('real', 'changed')] })).toThrow('Immutable');
        expect(() => one.reserve(p.id, p.version, p.ownerId, hash)).toThrow('not approved');
        expect(() => one.decide(p.id, p.version, 'other-owner', hash, 'approve', 'reviewed')).toThrow();
        expect(() => one.decide(p.id, p.version, p.ownerId, 'wrong', 'approve', 'reviewed')).toThrow();
    });
    it('serializes independent connections, revoke invalidates reserved lease and receipt success', async () => {
        const { one, two } = await setup(); const p = procedure(), hash = one.register(p);
        one.decide(p.id, p.version, p.ownerId, hash, 'approve', 'exact reviewed');
        const lease = one.reserve(p.id, p.version, p.ownerId, hash);
        expect(() => two.reserve(p.id, p.version, p.ownerId, hash)).toThrow('already reserved');
        two.decide(p.id, p.version, p.ownerId, hash, 'revoke', 'owner revoked');
        expect(one.isCurrent(lease)).toBe(false);
        const receipt = { procedureId: p.id, ownerId: p.ownerId, version: p.version, contractHash: hash, succeeded: true, operations: 2 };
        expect(one.finish(lease, receipt)).toBe('REVOKED');
        expect(two.receipt(lease.runId, p.ownerId)?.state).toBe('REVOKED');
        expect(() => one.finish(lease, receipt)).toThrow('completed');
        expect(two.receipt(lease.runId, 'other-owner')).toBeUndefined();
    });
    it('receipt persists over restart and forged output rejected before recording', async () => {
        const { one, two, path } = await setup(); const p = procedure(), hash = one.register(p);
        one.decide(p.id, p.version, p.ownerId, hash, 'approve', 'reviewed'); const lease = one.reserve(p.id, p.version, p.ownerId, hash);
        const receipt = { procedureId: p.id, ownerId: p.ownerId, version: p.version, contractHash: hash, succeeded: true, operations: 2 };
        expect(() => one.finish(lease, { ...receipt, contractHash: 'wrong' })).toThrow();
        expect(one.isCurrent({ ...lease, version: 9 })).toBe(false);
        expect(() => one.finish({ ...lease, version: 9 }, { ...receipt, version: 9 })).toThrow();
        expect(one.finish(lease, receipt)).toBe('SUCCEEDED');
        const reopened = new ProcedureApprovalLedger(path); handles.push(reopened);
        expect(JSON.parse(reopened.receipt(lease.runId, p.ownerId)!.receipt!)).toEqual(receipt);
        expect(two.isCurrent(lease)).toBe(false);
    });
});
