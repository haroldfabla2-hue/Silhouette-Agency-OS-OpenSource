import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { encodeFileContract, decodeFileContract, type SandboxReceipt } from './procedureFileSandbox';
import type { Procedure } from './memoryEvidence';

export interface ExecutionLease { runId: string; procedureId: string; version: number; ownerId: string; contractHash: string; epoch: number }
interface Row { procedure_id: string; version: number; owner_id: string; hash: string; contract: string; state: string; epoch: number }
/** Opt-in single-file SQLite ledger. Caller must authenticate the owner, never an LLM. */
export class ProcedureApprovalLedger {
    private readonly db: Database.Database;
    constructor(path: string) {
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
            state TEXT NOT NULL, receipt TEXT, started INTEGER NOT NULL, completed INTEGER);`);
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
    finish(lease: ExecutionLease, receipt: SandboxReceipt): 'SUCCEEDED' | 'FAILED' | 'REVOKED' {
        return this.db.transaction(() => {
            const run = this.db.prepare('SELECT * FROM procedure_runs WHERE run_id=?').get(lease.runId) as { state: string; procedure_id: string; version: number; hash: string; owner_id: string; epoch: number; receipt: string | null } | undefined;
            if (!run || run.receipt !== null || run.hash !== lease.contractHash || run.owner_id !== lease.ownerId || run.epoch !== lease.epoch || run.procedure_id !== lease.procedureId || run.version !== lease.version) throw new Error('Unknown, forged or completed lease');
            if (receipt.procedureId !== lease.procedureId || receipt.ownerId !== lease.ownerId || receipt.version !== lease.version || receipt.contractHash !== lease.contractHash || !Number.isInteger(receipt.operations) || receipt.operations < 0 || receipt.operations > 32 || typeof receipt.succeeded !== 'boolean') throw new Error('Receipt does not match exact lease');
            const state = this.isCurrent(lease) ? (receipt.succeeded ? 'SUCCEEDED' : 'FAILED') : 'REVOKED';
            this.db.prepare('UPDATE procedure_runs SET state=?,receipt=?,completed=? WHERE run_id=?').run(state, JSON.stringify(receipt), Date.now(), lease.runId);
            return state;
        }).immediate();
    }
    receipt(runId: string, ownerId: string): { state: string; receipt: string | null } | undefined {
        return this.db.prepare('SELECT state,receipt FROM procedure_runs WHERE run_id=? AND owner_id=?').get(runId, ownerId) as { state: string; receipt: string | null } | undefined;
    }
}
