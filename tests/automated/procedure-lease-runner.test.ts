import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ProcedureApprovalLedger } from '../../services/procedureApprovalLedger';
import { runLeasedFileProcedure } from '../../services/procedureLeaseRunner';
import type { Procedure } from '../../services/memoryEvidence';
const dirs: string[] = []; const handles: ProcedureApprovalLedger[] = [];
afterEach(async () => { handles.splice(0).forEach(h => h.close()); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'lease-run-')); dirs.push(dir);
    const path = join(dir, 'ledger.sqlite'); const one = new ProcedureApprovalLedger(path), two = new ProcedureApprovalLedger(path); handles.push(one, two);
    const p: Procedure = { id: 'test', ownerId: 'test-owner', version: 1, steps: [JSON.stringify({ schema: 1, steps: [{ op: 'write', path: 'actual.txt', text: 'actual' }, { op: 'assert', path: 'actual.txt', sha256: createHash('sha256').update('actual').digest('hex') }] })], sourceIds: ['test-execution'], preconditions: ['test'], postconditions: ['hash'], context: 'test-only', state: 'PROPOSED', successfulRuns: 0, failedRuns: 0 };
    const hash = one.register(p); one.decide(p.id, p.version, p.ownerId, hash, 'approve', 'test approval');
    const lease = one.reserve(p.id, p.version, p.ownerId, hash); return { one, two, lease, path };
}
describe('real ledger plus isolated worker', () => {
    it('runs canonical disk/hash contract and persists successful receipt', async () => {
        const { one, lease, path } = await setup(); const result = await runLeasedFileProcedure(one, lease);
        expect(result.state).toBe('SUCCEEDED'); expect(result.receipt.operations).toBe(2);
        const reopened = new ProcedureApprovalLedger(path); handles.push(reopened);
        expect(JSON.parse(reopened.receipt(lease.runId, lease.ownerId)!.receipt!)).toEqual(result.receipt);
        await expect(runLeasedFileProcedure(one, lease)).rejects.toThrow('no longer');
    });
    it('does not spawn when another connection revoked before start', async () => {
        const { one, two, lease } = await setup(); two.decide(lease.procedureId, lease.version, lease.ownerId, lease.contractHash, 'revoke', 'revoked');
        let spawned = false; await expect(runLeasedFileProcedure(one, lease, { onSpawn: () => { spawned = true; } })).rejects.toThrow('revoked'); expect(spawned).toBe(false);
    });
    it('kills a real spawned process group on cross-connection revocation', async () => {
        const { one, two, lease } = await setup(); let pid = 0;
        const result = await runLeasedFileProcedure(one, lease, { onSpawn: child => { pid = child; two.decide(lease.procedureId, lease.version, lease.ownerId, lease.contractHash, 'revoke', 'revoked during run'); } });
        expect(pid).toBeGreaterThan(0); expect(result.state).toBe('REVOKED'); expect(result.receipt.succeeded).toBe(false);
        expect(() => process.kill(pid, 0)).toThrow(); expect(one.receipt(lease.runId, lease.ownerId)?.state).toBe('REVOKED');
    });
    it('external cancellation kills process and records failed not successful execution', async () => {
        const { one, lease } = await setup(); const controller = new AbortController(); let pid = 0;
        const result = await runLeasedFileProcedure(one, lease, { signal: controller.signal, onSpawn: child => { pid = child; controller.abort(); } });
        expect(result.state).toBe('FAILED'); expect(result.receipt.succeeded).toBe(false); expect(() => process.kill(pid, 0)).toThrow();
    });
});
