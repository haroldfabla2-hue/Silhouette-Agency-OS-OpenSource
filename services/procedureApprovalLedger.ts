import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { encodeFileContract, decodeFileContract, type SandboxReceipt } from './procedureFileSandbox';
import type { Procedure } from './memoryEvidence';
import { newChallenge, verifyAssertion, verifyRegistration, type AssertionResponse, type OwnerIdentityConfig, type RegistrationResponse } from './procedureOwnerIdentity';
import { GENESIS_HASH, canonicalPayload, entryHashOf, verifyEntrySignature, type ReceiptPayload, type ReceiptSigner, type SignedReceiptEntry } from './procedureReceiptSigner';

export interface ExecutionLease { runId: string; procedureId: string; version: number; ownerId: string; contractHash: string; epoch: number }
interface Row { procedure_id: string; version: number; owner_id: string; hash: string; contract: string; state: string; epoch: number }
/** Opt-in single-file SQLite ledger. Caller must authenticate the owner, never an LLM. */
export class ProcedureApprovalLedger {
    private readonly db: Database.Database;
    private readonly signer?: ReceiptSigner;
    private readonly identity?: OwnerIdentityConfig;
    /** `options.signer` is opt-in: without it behaviour and stored data are identical to before. */
    constructor(path: string, options: { signer?: ReceiptSigner; ownerIdentity?: OwnerIdentityConfig } = {}) {
        this.signer = options.signer; this.identity = options.ownerIdentity;
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 5000'); this.db.pragma('foreign_keys = ON');
        this.db.exec(`CREATE TABLE IF NOT EXISTS procedure_contracts (
            procedure_id TEXT NOT NULL, version INTEGER NOT NULL, owner_id TEXT NOT NULL,
            hash TEXT NOT NULL, contract TEXT NOT NULL, state TEXT NOT NULL, epoch INTEGER NOT NULL,
            PRIMARY KEY(procedure_id,version,owner_id));
          CREATE TABLE IF NOT EXISTS procedure_audit (
            id INTEGER PRIMARY KEY, procedure_id TEXT, version INTEGER, owner_id TEXT,
            action TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS procedure_runs (
            run_id TEXT PRIMARY KEY, procedure_id TEXT NOT NULL, version INTEGER NOT NULL,
            owner_id TEXT NOT NULL, hash TEXT NOT NULL, epoch INTEGER NOT NULL,
            state TEXT NOT NULL, receipt TEXT, started INTEGER NOT NULL, completed INTEGER);
          CREATE TABLE IF NOT EXISTS procedure_receipts (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL UNIQUE REFERENCES procedure_runs(run_id),
            payload TEXT NOT NULL, entry_hash TEXT NOT NULL, signature TEXT NOT NULL, key_id TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS owner_credentials (
            credential_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, public_key_pem TEXT NOT NULL, sign_count INTEGER NOT NULL, created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS owner_challenges (
            challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_id TEXT NOT NULL, procedure_id TEXT, version INTEGER, hash TEXT,
            decision TEXT, reason TEXT, epoch INTEGER, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);`);
    }
    close(): void { this.db.close(); }
    register(procedure: Procedure): string {
        if (!procedure.id || !procedure.ownerId || !Number.isInteger(procedure.version) || procedure.version < 1) throw new Error('Invalid identity/version');
        const contract = encodeFileContract(decodeFileContract(procedure));
        const hash = createHash('sha256').update(contract).digest('hex');
        this.db.transaction(() => {
            const prior = this.row(procedure.id, procedure.version, procedure.ownerId);
            if (prior) { if (prior.hash !== hash) throw new Error('Immutable version changed'); return; }
            this.db.prepare('INSERT INTO procedure_contracts VALUES (?,?,?,?,?,?,?)').run(procedure.id, procedure.version, procedure.ownerId, hash, contract, 'PROPOSED', 0);
        }).immediate();
        return hash;
    }
    private row(id: string, version: number, ownerId: string): Row | undefined {
        return this.db.prepare('SELECT * FROM procedure_contracts WHERE procedure_id=? AND version=? AND owner_id=?').get(id, version, ownerId) as Row | undefined;
    }
    decide(id: string, version: number, ownerId: string, hash: string, decision: 'approve' | 'revoke', reason: string): void {
        if (this.identity) throw new Error('Owner assertion required: use decideWithAssertion');
        this.applyDecision(id, version, ownerId, hash, decision, reason);
    }
    private applyDecision(id: string, version: number, ownerId: string, hash: string, decision: 'approve' | 'revoke', reason: string): void {
        if (!reason.trim() || !['approve', 'revoke'].includes(decision)) throw new Error('Explicit decision/reason required');
        this.db.transaction(() => {
            const row = this.row(id, version, ownerId);
            if (!row || row.hash !== hash) throw new Error('Stale or missing exact contract');
            if (decision === 'approve' && row.state !== 'PROPOSED') throw new Error('Only a proposed immutable contract can be approved');
            this.db.prepare('UPDATE procedure_contracts SET state=?,epoch=epoch+1 WHERE procedure_id=? AND version=? AND owner_id=?').run(decision === 'approve' ? 'APPROVED' : 'REVOKED', id, version, ownerId);
            if (decision === 'revoke') this.db.prepare("UPDATE procedure_runs SET state='REVOKED' WHERE procedure_id=? AND version=? AND owner_id=? AND state='RESERVED'").run(id, version, ownerId);
            this.db.prepare('INSERT INTO procedure_audit(procedure_id,version,owner_id,action,reason,at) VALUES (?,?,?,?,?,?)').run(id, version, ownerId, decision, reason, Date.now());
        }).immediate();
    }
    reserve(id: string, version: number, ownerId: string, hash: string): ExecutionLease {
        return this.db.transaction(() => {
            const row = this.row(id, version, ownerId);
            if (!row || row.state !== 'APPROVED' || row.hash !== hash) throw new Error('Exact contract not approved');
            if (this.db.prepare("SELECT 1 FROM procedure_runs WHERE procedure_id=? AND version=? AND owner_id=? AND state='RESERVED'").get(id, version, ownerId)) throw new Error('Run already reserved');
            const lease: ExecutionLease = { runId: randomUUID(), procedureId: id, version, ownerId, contractHash: hash, epoch: row.epoch };
            this.db.prepare('INSERT INTO procedure_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(lease.runId, id, version, ownerId, hash, row.epoch, 'RESERVED', null, Date.now(), null);
            return lease;
        }).immediate();
    }
    isCurrent(lease: ExecutionLease): boolean {
        const row = this.row(lease.procedureId, lease.version, lease.ownerId);
        const run = this.db.prepare('SELECT * FROM procedure_runs WHERE run_id=?').get(lease.runId) as { state: string; procedure_id: string; version: number; owner_id: string; hash: string; epoch: number } | undefined;
        return !!row && row.state === 'APPROVED' && row.epoch === lease.epoch && row.hash === lease.contractHash && run?.state === 'RESERVED' && run.procedure_id === lease.procedureId && run.version === lease.version && run.owner_id === lease.ownerId && run.hash === lease.contractHash && run.epoch === lease.epoch;
    }
    contractFor(lease: ExecutionLease): Procedure {
        if (!this.isCurrent(lease)) throw new Error('Lease revoked or no longer reserved');
        const row = this.row(lease.procedureId, lease.version, lease.ownerId)!;
        if (createHash('sha256').update(row.contract).digest('hex') !== lease.contractHash) throw new Error('Stored contract hash mismatch');
        return { id: lease.procedureId, version: lease.version, ownerId: lease.ownerId,
            steps: [row.contract], sourceIds: [], preconditions: [], postconditions: [],
            context: 'Explicit execution lease', state: 'APPROVED', successfulRuns: 0, failedRuns: 0 };
    }
    finish(lease: ExecutionLease, receipt: SandboxReceipt): 'SUCCEEDED' | 'FAILED' | 'REVOKED' {
        return this.db.transaction(() => {
            const run = this.db.prepare('SELECT * FROM procedure_runs WHERE run_id=?').get(lease.runId) as { state: string; procedure_id: string; version: number; hash: string; owner_id: string; epoch: number; receipt: string | null } | undefined;
            if (!run || run.receipt !== null || run.hash !== lease.contractHash || run.owner_id !== lease.ownerId || run.epoch !== lease.epoch || run.procedure_id !== lease.procedureId || run.version !== lease.version) throw new Error('Unknown, forged or completed lease');
            if (receipt.procedureId !== lease.procedureId || receipt.ownerId !== lease.ownerId || receipt.version !== lease.version || receipt.contractHash !== lease.contractHash || !Number.isInteger(receipt.operations) || receipt.operations < 0 || receipt.operations > 32 || typeof receipt.succeeded !== 'boolean') throw new Error('Receipt does not match exact lease');
            const state = this.isCurrent(lease) ? (receipt.succeeded ? 'SUCCEEDED' : 'FAILED') : 'REVOKED';
            const stored = JSON.stringify(receipt), completedAt = Date.now();
            this.db.prepare('UPDATE procedure_runs SET state=?,receipt=?,completed=? WHERE run_id=?').run(state, stored, completedAt, lease.runId);
            if (this.signer) {
                // Same IMMEDIATE transaction: the state, the chain link and the signature commit together or not at all.
                const last = this.db.prepare('SELECT entry_hash FROM procedure_receipts ORDER BY seq DESC LIMIT 1').get() as { entry_hash: string } | undefined;
                const payload = canonicalPayload({ v: 1, runId: lease.runId, procedureId: lease.procedureId, version: lease.version, ownerId: lease.ownerId, contractHash: lease.contractHash, epoch: lease.epoch, state, receipt: stored, completedAt, prevEntryHash: last?.entry_hash ?? GENESIS_HASH });
                const signature = this.signer.sign(Buffer.from(payload)).toString('base64');
                this.db.prepare('INSERT INTO procedure_receipts(run_id,payload,entry_hash,signature,key_id) VALUES (?,?,?,?,?)').run(lease.runId, payload, entryHashOf(payload), signature, this.signer.keyId);
            }
            return state;
        }).immediate();
    }
    receipt(runId: string, ownerId: string): { state: string; receipt: string | null } | undefined {
        return this.db.prepare('SELECT state,receipt FROM procedure_runs WHERE run_id=? AND owner_id=?').get(runId, ownerId) as { state: string; receipt: string | null } | undefined;
    }
    /** Owner-scoped read of the signed envelope for one run, or undefined if unsigned/unknown/other owner. */
    signedReceipt(runId: string, ownerId: string): SignedReceiptEntry | undefined {
        const r = this.db.prepare('SELECT r.seq,r.run_id,r.payload,r.entry_hash,r.signature,r.key_id FROM procedure_receipts r JOIN procedure_runs u ON u.run_id=r.run_id WHERE r.run_id=? AND u.owner_id=?').get(runId, ownerId) as { seq: number; run_id: string; payload: string; entry_hash: string; signature: string; key_id: string } | undefined;
        return r && { seq: r.seq, runId: r.run_id, payload: r.payload, entryHash: r.entry_hash, signature: r.signature, keyId: r.key_id };
    }
    /** Checks signature AND that the signed payload still equals the live run row (state, receipt, identity). */
    verifyRun(runId: string, ownerId: string, publicKeyPem: string): boolean {
        const e = this.signedReceipt(runId, ownerId);
        const run = this.db.prepare('SELECT * FROM procedure_runs WHERE run_id=? AND owner_id=?').get(runId, ownerId) as { procedure_id: string; version: number; owner_id: string; hash: string; epoch: number; state: string; receipt: string | null; completed: number } | undefined;
        if (!e || !run || !verifyEntrySignature(e, publicKeyPem)) return false;
        const p = JSON.parse(e.payload) as ReceiptPayload;
        return p.runId === runId && p.ownerId === run.owner_id && p.procedureId === run.procedure_id && p.version === run.version && p.contractHash === run.hash && p.epoch === run.epoch && p.state === run.state && p.receipt === run.receipt && p.completedAt === run.completed;
    }
    /** Operator audit: every entry signed by a trusted key, hashes chained from genesis with no gap or reorder. */
    verifyChain(trustedKeys: Record<string, string>): { ok: boolean; entries: number; failedAtSeq?: number } {
        const rows = this.db.prepare('SELECT seq,run_id,payload,entry_hash,signature,key_id FROM procedure_receipts ORDER BY seq').all() as { seq: number; run_id: string; payload: string; entry_hash: string; signature: string; key_id: string }[];
        let prev = GENESIS_HASH;
        for (const r of rows) {
            const pem = trustedKeys[r.key_id];
            const p = JSON.parse(r.payload) as ReceiptPayload;
            if (!pem || p.prevEntryHash !== prev || p.runId !== r.run_id || !verifyEntrySignature({ payload: r.payload, entryHash: r.entry_hash, signature: r.signature, keyId: r.key_id }, pem)) return { ok: false, entries: rows.length, failedAtSeq: r.seq };
            prev = r.entry_hash;
        }
        return { ok: true, entries: rows.length };
    }
    private cfg(): OwnerIdentityConfig { if (!this.identity) throw new Error('Owner identity not configured'); return this.identity; }
    /** Step 1 of enrollment. WHO may enroll the first credential is the caller's authenticated decision, not this ledger's. */
    issueEnrollmentChallenge(ownerId: string): string {
        const c = newChallenge(), now = Date.now();
        this.db.prepare('INSERT INTO owner_challenges(challenge,kind,owner_id,expires) VALUES (?,?,?,?)').run(c, 'enroll', ownerId, now + (this.cfg().challengeTtlMs ?? 120000));
        return c;
    }
    enrollCredential(ownerId: string, challenge: string, response: RegistrationResponse): string {
        const cfg = this.cfg();
        // Consumed atomically and BEFORE verification, outside the rollback scope: a failed attempt burns the challenge.
        if (this.db.prepare("UPDATE owner_challenges SET used=1 WHERE challenge=? AND kind='enroll' AND owner_id=? AND used=0 AND expires>=?").run(challenge, ownerId, Date.now()).changes !== 1) throw new Error('Unknown, used or expired enrollment challenge');
        return this.db.transaction(() => {
            const r = verifyRegistration(response, challenge, cfg);
            if (this.db.prepare('SELECT 1 FROM owner_credentials WHERE credential_id=?').get(r.credentialId)) throw new Error('Credential already enrolled');
            this.db.prepare('INSERT INTO owner_credentials(credential_id,owner_id,public_key_pem,sign_count,created) VALUES (?,?,?,?,?)').run(r.credentialId, ownerId, r.publicKeyPem, r.signCount, Date.now());
            return r.credentialId;
        }).immediate();
    }
    /** Step 2: a one-time challenge bound to this exact contract hash, decision, reason and epoch. The UI must show these to the owner. */
    issueDecisionChallenge(id: string, version: number, ownerId: string, hash: string, decision: 'approve' | 'revoke', reason: string): string {
        const row = this.row(id, version, ownerId);
        if (!row || row.hash !== hash) throw new Error('Stale or missing exact contract');
        const c = newChallenge();
        this.db.prepare('INSERT INTO owner_challenges(challenge,kind,owner_id,procedure_id,version,hash,decision,reason,epoch,expires) VALUES (?,?,?,?,?,?,?,?,?,?)').run(c, 'decide', ownerId, id, version, hash, decision, reason, row.epoch, Date.now() + (this.cfg().challengeTtlMs ?? 120000));
        return c;
    }
    decideWithAssertion(id: string, version: number, ownerId: string, hash: string, decision: 'approve' | 'revoke', reason: string, challenge: string, response: AssertionResponse): void {
        const cfg = this.cfg();
        if (this.db.prepare("UPDATE owner_challenges SET used=1 WHERE challenge=? AND kind='decide' AND used=0 AND expires>=?").run(challenge, Date.now()).changes !== 1) throw new Error('Unknown, used or expired decision challenge');
        this.db.transaction(() => {
            const ch = this.db.prepare("SELECT * FROM owner_challenges WHERE challenge=? AND kind='decide'").get(challenge) as { owner_id: string; procedure_id: string; version: number; hash: string; decision: string; reason: string; epoch: number };
            if (ch.owner_id !== ownerId || ch.procedure_id !== id || ch.version !== version || ch.hash !== hash || ch.decision !== decision || ch.reason !== reason) throw new Error('Challenge was issued for a different decision');
            const row = this.row(id, version, ownerId);
            if (!row || row.epoch !== ch.epoch) throw new Error('Contract changed since the challenge was issued');
            const cred = this.db.prepare('SELECT * FROM owner_credentials WHERE credential_id=? AND owner_id=? AND revoked=0').get(response.credentialId, ownerId) as { public_key_pem: string; sign_count: number } | undefined;
            if (!cred) throw new Error('Credential not enrolled for this owner');
            const v = verifyAssertion(response, challenge, cred.public_key_pem, cred.sign_count, cfg);
            this.db.prepare('UPDATE owner_credentials SET sign_count=? WHERE credential_id=?').run(v.signCount, response.credentialId);
            this.applyDecision(id, version, ownerId, hash, decision, reason);
        }).immediate();
    }
}
