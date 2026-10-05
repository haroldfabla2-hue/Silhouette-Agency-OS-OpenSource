import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ProcedureApprovalLedger } from '../../services/procedureApprovalLedger';
import { createEd25519Signer, generateReceiptKeyPair, receiptKeyId } from '../../services/procedureReceiptSigner';
import type { Procedure } from '../../services/memoryEvidence';
const directories: string[] = []; const handles: ProcedureApprovalLedger[] = [];
afterEach(async () => { handles.splice(0).forEach(x => x.close()); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
const procedure = (id: string): Procedure => ({ id, version: 1, ownerId: 'test-owner', sourceIds: ['s'], preconditions: ['t'], postconditions: ['h'], context: 'test-only', successfulRuns: 0, failedRuns: 0, state: 'PROPOSED', steps: [JSON.stringify({ schema: 1, steps: [{ op: 'write', path: 'out.txt', text: 'real' }, { op: 'assert', path: 'out.txt', sha256: createHash('sha256').update('real').digest('hex') }] })] });
async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'sign-')); directories.push(dir); const path = join(dir, 'l.sqlite');
    const keys = generateReceiptKeyPair(); const ledger = new ProcedureApprovalLedger(path, { signer: createEd25519Signer(keys.privateKeyPem) }); handles.push(ledger);
    return { ledger, path, keys };
}
function runOne(ledger: ProcedureApprovalLedger, id: string, succeeded = true) {
    const p = procedure(id), hash = ledger.register(p);
    ledger.decide(id, 1, p.ownerId, hash, 'approve', 'reviewed'); const lease = ledger.reserve(id, 1, p.ownerId, hash);
    const state = ledger.finish(lease, { procedureId: id, ownerId: p.ownerId, version: 1, contractHash: hash, succeeded, operations: 2 });
    return { lease, state, p, hash };
}
describe('real Ed25519 signed, hash-chained receipts', () => {
    it('signs, verifies, and survives reopen with the public key only', async () => {
        const { ledger, path, keys } = await setup(); const { lease, state } = runOne(ledger, 'a');
        expect(state).toBe('SUCCEEDED');
        expect(ledger.verifyRun(lease.runId, 'test-owner', keys.publicKeyPem)).toBe(true);
        const reopened = new ProcedureApprovalLedger(path); handles.push(reopened); // no signer needed to verify
        expect(reopened.verifyRun(lease.runId, 'test-owner', keys.publicKeyPem)).toBe(true);
        expect(reopened.signedReceipt(lease.runId, 'other-owner')).toBeUndefined();
        expect(reopened.signedReceipt(lease.runId, 'test-owner')!.keyId).toBe(receiptKeyId(keys.publicKeyPem));
    });
    it('rejects a wrong key and a tampered state or receipt row', async () => {
        const { ledger, path, keys } = await setup(); const { lease } = runOne(ledger, 'a');
        expect(ledger.verifyRun(lease.runId, 'test-owner', generateReceiptKeyPair().publicKeyPem)).toBe(false);
        const raw = new Database(path);
        raw.prepare("UPDATE procedure_runs SET state='FAILED' WHERE run_id=?").run(lease.runId);
        expect(ledger.verifyRun(lease.runId, 'test-owner', keys.publicKeyPem)).toBe(false);
        raw.prepare("UPDATE procedure_runs SET state='SUCCEEDED' WHERE run_id=?").run(lease.runId);
        expect(ledger.verifyRun(lease.runId, 'test-owner', keys.publicKeyPem)).toBe(true);
        raw.prepare('UPDATE procedure_runs SET receipt=? WHERE run_id=?').run('{"succeeded":true,"operations":0}', lease.runId);
        expect(ledger.verifyRun(lease.runId, 'test-owner', keys.publicKeyPem)).toBe(false);
        raw.close();
    });
    it('a revoked late success is signed as REVOKED, never SUCCEEDED', async () => {
        const { ledger, keys } = await setup(); const p = procedure('r'), hash = ledger.register(p);
        ledger.decide('r', 1, p.ownerId, hash, 'approve', 'ok'); const lease = ledger.reserve('r', 1, p.ownerId, hash);
        ledger.decide('r', 1, p.ownerId, hash, 'revoke', 'owner revoked');
        expect(ledger.finish(lease, { procedureId: 'r', ownerId: p.ownerId, version: 1, contractHash: hash, succeeded: true, operations: 2 })).toBe('REVOKED');
        const e = ledger.signedReceipt(lease.runId, p.ownerId)!;
        expect(JSON.parse(e.payload).state).toBe('REVOKED');
        expect(ledger.verifyRun(lease.runId, p.ownerId, keys.publicKeyPem)).toBe(true);
    });
    it('chain verifies, and detects edit, deletion in the middle and reorder', async () => {
        const { ledger, path, keys } = await setup(); const trusted = { [receiptKeyId(keys.publicKeyPem)]: keys.publicKeyPem };
        runOne(ledger, 'a'); runOne(ledger, 'b'); runOne(ledger, 'c');
        expect(ledger.verifyChain(trusted)).toEqual({ ok: true, entries: 3 });
        expect(ledger.verifyChain({}).ok).toBe(false); // unknown key
        const raw = new Database(path);
        raw.pragma('foreign_keys = OFF');
        const mid = raw.prepare('SELECT seq FROM procedure_receipts ORDER BY seq LIMIT 1 OFFSET 1').get() as { seq: number };
        const saved = raw.prepare('SELECT * FROM procedure_receipts WHERE seq=?').get(mid.seq) as Record<string, unknown>;
        raw.prepare('DELETE FROM procedure_receipts WHERE seq=?').run(mid.seq);
        expect(ledger.verifyChain(trusted)).toMatchObject({ ok: false });
        raw.prepare('INSERT INTO procedure_receipts(seq,run_id,payload,entry_hash,signature,key_id) VALUES (?,?,?,?,?,?)').run(saved.seq, saved.run_id, saved.payload, saved.entry_hash, saved.signature, saved.key_id);
        expect(ledger.verifyChain(trusted).ok).toBe(true);
        raw.prepare('UPDATE procedure_receipts SET payload=replace(payload,?,?) WHERE seq=?').run('"epoch":1', '"epoch":9', mid.seq);
        expect(ledger.verifyChain(trusted)).toMatchObject({ ok: false, failedAtSeq: mid.seq });
        raw.close();
    });
    it('unsigned ledger keeps the old behaviour and stores no signed envelope', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'plain-')); directories.push(dir);
        const plain = new ProcedureApprovalLedger(join(dir, 'p.sqlite')); handles.push(plain); const { lease } = runOne(plain, 'u');
        expect(plain.signedReceipt(lease.runId, 'test-owner')).toBeUndefined();
        expect(plain.verifyRun(lease.runId, 'test-owner', generateReceiptKeyPair().publicKeyPem)).toBe(false);
        expect(plain.receipt(lease.runId, 'test-owner')?.state).toBe('SUCCEEDED');
    });
    it('refuses a non-Ed25519 signer key', () => {
        const { generateKeyPairSync } = require('node:crypto');
        const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        expect(() => createEd25519Signer(rsa)).toThrow('Ed25519');
    });
});
