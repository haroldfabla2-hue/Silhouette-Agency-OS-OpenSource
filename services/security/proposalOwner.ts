/**
 * PROPOSAL OWNER REGISTRY (R9) - durable, explicit ownership for daemon
 * initiatives.
 *
 * A daemon initiative (e.g. a janitor dry-run proposal) has NO source-grounded
 * owner by default. Inventing one (CREATOR, first user, an env name, an action
 * payload field) would fabricate authority. So every recorded initiative starts
 * UNRESOLVED_OWNER and is NOT dispatchable: nothing dispatches, rejects,
 * auto-approves or silently drops it. Assignment to a specific authenticated
 * person is a separate, explicit decision by a principal whose CURRENT role is
 * CREATOR (re-derived from the identity service at decision time - a claimed
 * role is never trusted). Assignment is recorded with provenance; it is NOT an
 * approval of the proposal's effects (those keep their own consent gates).
 *
 * Durability: tmp+rename writes (0600) and the same cross-process lock
 * discipline as the consent ledger; denied attempts are recorded as evidence.
 *
 * Declared limits: same-host store; file permissions are not a boundary
 * against a writer with the executor's OS user (protected issuer/owner
 * authority outside the executor's write domain remains infrastructure work,
 * see docs/verification/owner-issuer-boundary-preparation.md).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { identityService, UserRole } from '../identityService';

export type ProposalOwnerStatus = 'UNRESOLVED_OWNER' | 'ASSIGNED';

export interface OwnerDecision {
    type: 'OWNER_ASSIGNED' | 'OWNER_ASSIGN_DENIED';
    by: string;
    owner?: string;
    at: number;
    reason?: string;
}

export interface ProposalOwnerRecord {
    initiativeId: string;
    origin: string;
    summary: string;
    createdAt: number;
    status: ProposalOwnerStatus;
    owner?: string;
    decisions: OwnerDecision[];
}

export type AssignResult =
    | { ok: true; record: ProposalOwnerRecord }
    | { ok: false; reason: 'UNKNOWN_INITIATIVE' | 'NOT_AUTHORIZED' | 'UNKNOWN_OWNER' };

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 15;
const LOCK_TIMEOUT_MS = 10_000;

export class ProposalOwnerRegistry {
    private readonly file: string;
    private readonly lockFile: string;

    constructor(private readonly dir: string) {
        this.file = path.join(dir, 'proposal-owners.json');
        this.lockFile = `${this.file}.lock`;
    }

    private readDisk(): Map<string, ProposalOwnerRecord> {
        try {
            const rows = JSON.parse(fs.readFileSync(this.file, 'utf8')) as ProposalOwnerRecord[];
            const map = new Map<string, ProposalOwnerRecord>();
            for (const r of Array.isArray(rows) ? rows : []) {
                if (r && typeof r.initiativeId === 'string') map.set(r.initiativeId, r);
            }
            return map;
        } catch {
            return new Map();
        }
    }

    private writeDisk(map: Map<string, ProposalOwnerRecord>): void {
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...map.values()], null, 1), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    private acquireLock(): void {
        const start = Date.now();
        for (;;) {
            try {
                const fd = fs.openSync(this.lockFile, 'wx');
                fs.writeSync(fd, String(process.pid));
                fs.closeSync(fd);
                return;
            } catch (e: any) {
                if (e?.code === 'EEXIST') {
                    try {
                        const st = fs.statSync(this.lockFile);
                        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(this.lockFile); continue; }
                    } catch { /* vanished: retry */ }
                    if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error('[PROPOSAL_OWNER] lock timeout');
                    const until = Date.now() + LOCK_RETRY_MS;
                    while (Date.now() < until) { /* short spin */ }
                    continue;
                }
                throw e;
            }
        }
    }

    private releaseLock(): void {
        try { fs.unlinkSync(this.lockFile); } catch { /* already gone */ }
    }

    private mutate<T>(fn: (map: Map<string, ProposalOwnerRecord>) => { out: T; dirty: boolean }): T {
        this.acquireLock();
        try {
            const map = this.readDisk();
            const { out, dirty } = fn(map);
            if (dirty) this.writeDisk(map);
            return out;
        } finally {
            this.releaseLock();
        }
    }

    /** Record a daemon initiative with NO owner. Idempotent: an existing
     *  record is returned unchanged (re-recording never resets decisions). */
    propose(input: { initiativeId: string; origin: string; summary: string }, now: number = Date.now()): ProposalOwnerRecord {
        return this.mutate(map => {
            const existing = map.get(input.initiativeId);
            if (existing) return { out: existing, dirty: false };
            const record: ProposalOwnerRecord = {
                initiativeId: input.initiativeId,
                origin: input.origin,
                summary: input.summary,
                createdAt: now,
                status: 'UNRESOLVED_OWNER',
                decisions: [],
            };
            map.set(record.initiativeId, record);
            return { out: { ...record }, dirty: true };
        });
    }

    get(initiativeId: string): ProposalOwnerRecord | undefined {
        return this.readDisk().get(initiativeId);
    }

    /**
     * Explicitly assign an owner. The assigner's role is RE-DERIVED from the
     * identity service right now: only a current CREATOR assigns. The owner
     * must be a real existing user. Every attempt, denied or not, is
     * recorded. Assignment is NOT approval of the initiative's effects.
     */
    assign(initiativeId: string, ownerPrincipalId: string, assignerPrincipalId: string, now: number = Date.now()): AssignResult {
        const assignerRole = (() => {
            try { return identityService.getUserById(assignerPrincipalId)?.role ?? null; } catch { return null; }
        })();
        const ownerExists = (() => {
            try { return identityService.getUserById(ownerPrincipalId) !== null; } catch { return false; }
        })();

        return this.mutate(map => {
            const record = map.get(initiativeId);
            const deny = (reason: 'UNKNOWN_INITIATIVE' | 'NOT_AUTHORIZED' | 'UNKNOWN_OWNER', why: string): { out: AssignResult; dirty: boolean } => {
                if (record) {
                    record.decisions.push({ type: 'OWNER_ASSIGN_DENIED', by: assignerPrincipalId, owner: ownerPrincipalId, at: now, reason: why });
                    map.set(initiativeId, record);
                }
                return { out: { ok: false, reason }, dirty: !!record };
            };
            if (!record) return { out: { ok: false, reason: 'UNKNOWN_INITIATIVE' } as AssignResult, dirty: false };
            if (assignerRole !== UserRole.CREATOR) return deny('NOT_AUTHORIZED', `assigner role is ${assignerRole ?? 'unknown'}, requires CREATOR (re-derived at decision time)`);
            if (!ownerExists) return deny('UNKNOWN_OWNER', `owner ${ownerPrincipalId} is not an existing user`);
            record.status = 'ASSIGNED';
            record.owner = ownerPrincipalId;
            record.decisions.push({ type: 'OWNER_ASSIGNED', by: assignerPrincipalId, owner: ownerPrincipalId, at: now });
            map.set(initiativeId, record);
            return { out: { ok: true, record: { ...record, decisions: [...record.decisions] } } as AssignResult, dirty: true };
        });
    }

    /** An initiative is dispatchable only with an explicitly assigned owner
     *  who is still an existing user. Anything else - unresolved, unknown,
     *  dangling - is NOT dispatchable. Fail-closed. */
    isDispatchable(initiativeId: string): boolean {
        const record = this.readDisk().get(initiativeId);
        if (!record || record.status !== 'ASSIGNED' || !record.owner) return false;
        try { return identityService.getUserById(record.owner) !== null; } catch { return false; }
    }
}

export const proposalOwners = new ProposalOwnerRegistry(
    process.env.PROPOSAL_OWNER_DIR || path.join(process.cwd(), 'data')
);
