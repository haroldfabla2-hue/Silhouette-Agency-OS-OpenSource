import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ProcedureApprovalLedger } from '../../services/procedureApprovalLedger';
import { createEd25519Signer, generateReceiptKeyPair, receiptKeyId } from '../../services/procedureReceiptSigner';
import { buildAnchor, parseAnchor, verifyAnchor, anchorPath, anchorRepoUrlFromEnv } from '../../services/procedureReceiptAnchor';
import type { Procedure } from '../../services/memoryEvidence';
const directories: string[] = []; const handles: ProcedureApprovalLedger[] = [];
afterEach(async () => { handles.splice(0).forEach(x => x.close()); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
const procedure = (id: string): Procedure => ({ id, version: 1, ownerId: 'test-owner', sourceIds: ['s'], preconditions: ['t'], postconditions: ['h'], context: 'test-only', successfulRuns: 0, failedRuns: 0, state: 'PROPOSED', steps: [JSON.stringify({ schema: 1, steps: [{ op: 'write', path: 'out.txt', text: 'real' }, { op: 'assert', path: 'out.txt', sha256: createHash('sha256').update('real').digest('hex') }] })] });
async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'anchor-')); directories.push(dir); const path = join(dir, 'l.sqlite');
    const keys = generateReceiptKeyPair(); const ledger = new ProcedureApprovalLedger(path, { signer: createEd25519Signer(keys.privateKeyPem) }); handles.push(ledger);
    return { ledger, path, keys };
}
function runOne(ledger: ProcedureApprovalLedger, id: string) {
    const p = procedure(id), hash = ledger.register(p);
    ledger.decide(id, 1, p.ownerId, hash, 'approve', 'reviewed'); const lease = ledger.reserve(id, 1, p.ownerId, hash);
    ledger.finish(lease, { procedureId: id, ownerId: p.ownerId, version: 1, contractHash: hash, succeeded: true, operations: 2 });
    return lease;
}
describe('receipt chain head exposed for anchoring', () => {
    it('is undefined before any signed receipt and tracks the newest entry', async () => {
        const { ledger, keys } = await setup();
        expect(ledger.chainHead()).toBeUndefined();
        runOne(ledger, 'a');
        expect(ledger.chainHead()).toMatchObject({ seq: 1, keyId: receiptKeyId(keys.publicKeyPem) });
        const b = runOne(ledger, 'b'); const c = runOne(ledger, 'c');
        const head = ledger.chainHead()!;
        expect(head.seq).toBe(3);
        expect(head.entryHash).toBe(ledger.signedReceipt(c.runId, 'test-owner')!.entryHash);
        expect(head.entryHash).not.toBe(ledger.signedReceipt(b.runId, 'test-owner')!.entryHash);
    });
    it('exposes no payload or receipt body', async () => {
        const { ledger } = await setup(); runOne(ledger, 'a');
        const head = ledger.chainHead()!;
        expect(Object.keys(head).sort()).toEqual(['entryHash', 'keyId', 'seq']);
    });
});
describe('anchor content build/parse/verify', () => {
    it('round-trips canonically and verifies against the true head', async () => {
        const { ledger } = await setup(); runOne(ledger, 'a'); runOne(ledger, 'b');
        const head = ledger.chainHead()!;
        const content = buildAnchor(head);
        expect(content).toBe(JSON.stringify({ v: 1, kind: 'RECEIPT-ANCHOR', seq: head.seq, entryHash: head.entryHash, keyId: head.keyId }));
        expect(parseAnchor(content)).toEqual({ v: 1, kind: 'RECEIPT-ANCHOR', seq: head.seq, entryHash: head.entryHash, keyId: head.keyId });
        expect(verifyAnchor(head, content)).toBe(true);
    });
    it('fails verification on any head difference: seq, hash or key', async () => {
        const { ledger } = await setup(); runOne(ledger, 'a'); runOne(ledger, 'b');
        const head = ledger.chainHead()!; const content = buildAnchor(head);
        expect(verifyAnchor({ ...head, seq: head.seq + 1 }, content)).toBe(false);
        expect(verifyAnchor({ ...head, entryHash: 'f'.repeat(64) }, content)).toBe(false);
        expect(verifyAnchor({ ...head, keyId: 'otherkey' }, content)).toBe(false);
        expect(verifyAnchor(head, buildAnchor({ ...head, seq: 99 }))).toBe(false);
    });
    it('rejects malformed anchors: bad json, extra or missing fields, non-canonical bytes, bad values', async () => {
        const { ledger } = await setup(); runOne(ledger, 'a');
        const head = ledger.chainHead()!;
        const good = { v: 1, kind: 'RECEIPT-ANCHOR', seq: head.seq, entryHash: head.entryHash, keyId: head.keyId };
        expect(() => parseAnchor('not json')).toThrow();
        expect(() => parseAnchor(JSON.stringify({ ...good, extra: 1 }))).toThrow(/missing or unknown/);
        expect(() => parseAnchor(JSON.stringify({ v: 1, kind: 'RECEIPT-ANCHOR', seq: head.seq, entryHash: head.entryHash }))).toThrow(/missing or unknown/);
        expect(() => parseAnchor(JSON.stringify({ ...good, v: 2 }))).toThrow(/version or kind/);
        expect(() => parseAnchor(JSON.stringify({ ...good, seq: 0 }))).toThrow(/positive integer/);
        expect(() => parseAnchor(JSON.stringify({ ...good, seq: 1.5 }))).toThrow(/positive integer/);
        expect(() => parseAnchor(JSON.stringify({ ...good, entryHash: 'xyz' }))).toThrow(/64-char hex/);
        expect(() => parseAnchor(JSON.stringify({ ...good, keyId: '' }))).toThrow(/non-empty/);
        expect(() => parseAnchor(JSON.stringify(good, null, 2))).toThrow(/not canonical/);
        expect(() => parseAnchor(JSON.stringify(good) + '\n')).toThrow(/not canonical/);
        const reordered = JSON.stringify({ kind: 'RECEIPT-ANCHOR', v: 1, seq: head.seq, entryHash: head.entryHash, keyId: head.keyId });
        expect(() => parseAnchor(reordered)).toThrow(/not canonical/);
    });
    it('buildAnchor refuses entries that cannot be a chain head', () => {
        const base = { seq: 1, entryHash: 'a'.repeat(64), keyId: 'k' };
        expect(() => buildAnchor({ ...base, seq: 0 })).toThrow();
        expect(() => buildAnchor({ ...base, entryHash: 'zz' })).toThrow();
        expect(() => buildAnchor({ ...base, keyId: '' })).toThrow();
    });
    it('detects tail truncation of the live database through the stored anchor', async () => {
        const { ledger, path, keys } = await setup();
        runOne(ledger, 'a'); runOne(ledger, 'b'); runOne(ledger, 'c');
        const anchored = buildAnchor(ledger.chainHead()!);
        const trusted = { [receiptKeyId(keys.publicKeyPem)]: keys.publicKeyPem };
        const raw = new Database(path);
        raw.prepare('DELETE FROM procedure_receipts WHERE seq >= 2').run(); raw.close();
        // Known limit: the truncated chain still verifies internally. The anchor is what catches it.
        expect(ledger.verifyChain(trusted)).toEqual({ ok: true, entries: 1 });
        expect(verifyAnchor(ledger.chainHead()!, anchored)).toBe(false);
    });
});
describe('anchor repository configuration', () => {
    it('has no default and rejects missing or non-git remotes', () => {
        expect(() => anchorRepoUrlFromEnv({})).toThrow(/not set/);
        expect(() => anchorRepoUrlFromEnv({ SILHOUETTE_RECEIPT_ANCHOR_REPO_URL: '  ' })).toThrow(/not set/);
        expect(() => anchorRepoUrlFromEnv({ SILHOUETTE_RECEIPT_ANCHOR_REPO_URL: 'ftp://x/y.git' })).toThrow(/remote/);
        expect(() => anchorRepoUrlFromEnv({ SILHOUETTE_RECEIPT_ANCHOR_REPO_URL: 'ledger-anchors' })).toThrow(/remote/);
        expect(anchorRepoUrlFromEnv({ SILHOUETTE_RECEIPT_ANCHOR_REPO_URL: 'https://github.com/example/ledger-anchors.git' })).toBe('https://github.com/example/ledger-anchors.git');
        expect(anchorRepoUrlFromEnv({ SILHOUETTE_RECEIPT_ANCHOR_REPO_URL: 'git@github.com:example/ledger-anchors.git' })).toBe('git@github.com:example/ledger-anchors.git');
    });
    it('names one file per anchored head', () => {
        expect(anchorPath(1)).toBe('anchors/seq-1.json');
        expect(anchorPath(137)).toBe('anchors/seq-137.json');
    });
});
