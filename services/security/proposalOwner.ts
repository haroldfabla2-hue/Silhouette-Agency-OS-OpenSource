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
 * Durability: append-only JSONL event log (0600, one O_APPEND write per
 * event; no lock file, no stale-lock recovery - the same root fix as the
 * consent ledger). Every write is verified by re-reading; a torn line from
 * a crash mid-append is skipped (that writer died before its record was
 * durable) and a write that cannot be read back throws visibly. Denied
 * attempts are recorded as evidence.
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

type OwnerEvent =
    | { op: 'PROPOSE'; rec: ProposalOwnerRecord }
    | { op: 'DECISION'; initiativeId: string; decision: OwnerDecision };

export class ProposalOwnerRegistry {
    private readonly file: string;
    private readonly legacyFile: string;

    constructor(private readonly dir: string) {
        this.file = path.join(dir, 'proposal-owners.jsonl');
        this.legacyFile = path.join(dir, 'proposal-owners.json');
    }

    private append(event: OwnerEvent): void {
        fs.mkdirSync(this.dir, { recursive: true });
        // ONE write for (torn-tail-healing newline) + event + newline; short
        // writes throw; fsync before returning (see ConsentLedger.append).
        const existed = fs.existsSync(this.file);
        const fd = fs.openSync(this.file, 'a+', 0o600);
        try {
            const st = fs.fstatSync(fd);
            let prefix = '';
            if (st.size > 0) {
                const last = Buffer.alloc(1);
                fs.readSync(fd, last, 0, 1, st.size - 1);
                if (last[0] !== 0x0a) prefix = '\n';
            }
            const data = Buffer.from(prefix + JSON.stringify(event) + '\n', 'utf8');
            if (fs.writeSync(fd, data, 0, data.length) !== data.length) {
                throw new Error('[PROPOSAL_OWNER] short write: event is not durable');
            }
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        if (!existed) {
            const dfd = fs.openSync(this.dir, 'r');
            try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
        }
    }

    private cache: { offset: number; map: Map<string, ProposalOwnerRecord> } | null = null;

    private migrateLegacy(): void {
        // Import whenever the legacy file is present: PROPOSE first-wins
        // makes a repeated or concurrent import a no-op, and a crash
        // mid-import is completed by the next reader. No marker, no lock.
        let raw: string;
        try {
            raw = fs.readFileSync(this.legacyFile, 'utf8');
        } catch {
            return;
        }
        try {
            const rows = JSON.parse(raw) as ProposalOwnerRecord[];
            for (const r of Array.isArray(rows) ? rows : []) {
                if (r && typeof r.initiativeId === 'string') this.append({ op: 'PROPOSE', rec: r });
            }
            fs.renameSync(this.legacyFile, `${this.legacyFile}.imported`);
        } catch {
            try { fs.renameSync(this.legacyFile, `${this.legacyFile}.unreadable-${Date.now()}`); } catch { /* keep as-is */ }
        }
    }

    private foldInto(map: Map<string, ProposalOwnerRecord>, events: OwnerEvent[]): void {
        for (const ev of events) {
            if (ev.op === 'PROPOSE') {
                if (!map.has(ev.rec.initiativeId)) map.set(ev.rec.initiativeId, { ...ev.rec, decisions: [...(ev.rec.decisions ?? [])] });
            } else if (ev.op === 'DECISION') {
                const r = map.get(ev.initiativeId);
                if (r) {
                    r.decisions.push(ev.decision);
                    if (ev.decision.type === 'OWNER_ASSIGNED') {
                        r.status = 'ASSIGNED';
                        r.owner = ev.decision.owner;
                    }
                }
            }
        }
    }

    /** Incremental fold by byte offset; read failures other than ENOENT
     *  THROW (never a silent empty store); an oversized unread tail throws
     *  instead of risking the string-size wall. */
    private load(): Map<string, ProposalOwnerRecord> {
        this.migrateLegacy();
        let st: fs.Stats;
        try {
            st = fs.statSync(this.file);
        } catch (e: any) {
            if (e?.code === 'ENOENT') {
                this.cache = this.cache ?? { offset: 0, map: new Map() };
                return this.cache.map;
            }
            throw e;
        }
        if (!this.cache || st.size < this.cache.offset) {
            this.cache = { offset: 0, map: new Map() };
        }
        const start = this.cache.offset;
        if (st.size > start) {
            if (st.size - start > 32 * 1024 * 1024) {
                throw new Error('[PROPOSAL_OWNER] unread log tail exceeds 32MB; refusing to load (compaction needed)');
            }
            const fd = fs.openSync(this.file, 'r');
            let text: string;
            let consumed: number;
            try {
                const buf = Buffer.alloc(st.size - start);
                fs.readSync(fd, buf, 0, buf.length, start);
                text = buf.toString('utf8');
                const lastNl = text.lastIndexOf('\n');
                consumed = lastNl >= 0 ? lastNl + 1 : 0;
            } finally {
                fs.closeSync(fd);
            }
            const events: OwnerEvent[] = [];
            for (const line of text.slice(0, consumed).split('\n')) {
                if (!line) continue;
                try {
                    const ev = JSON.parse(line) as OwnerEvent;
                    if (ev && typeof (ev as any).op === 'string') events.push(ev);
                } catch { /* torn line from a crash mid-append: skip */ }
            }
            this.foldInto(this.cache.map, events);
            this.cache.offset = start + consumed;
            if (this.cache.map.size > 50_000) {
                throw new Error('[PROPOSAL_OWNER] record cap exceeded; refusing to operate unbounded');
            }
        }
        return this.cache.map;
    }

    /** Record a daemon initiative with NO owner. Idempotent: an existing
     *  record is returned unchanged (re-recording never resets decisions). */
    propose(input: { initiativeId: string; origin: string; summary: string }, now: number = Date.now()): ProposalOwnerRecord {
        const existing = this.get(input.initiativeId);
        if (existing) return existing;
        const record: ProposalOwnerRecord = {
            initiativeId: input.initiativeId,
            origin: input.origin,
            summary: input.summary,
            createdAt: now,
            status: 'UNRESOLVED_OWNER',
            decisions: [],
        };
        this.append({ op: 'PROPOSE', rec: record });
        const landed = this.get(input.initiativeId);
        if (!landed) throw new Error('[PROPOSAL_OWNER] write verification failed: PROPOSE did not land');
        return { ...landed };
    }

    get(initiativeId: string): ProposalOwnerRecord | undefined {
        return this.load().get(initiativeId);
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

        const record = this.get(initiativeId);
        const apply = (decision: OwnerDecision): void => {
            this.append({ op: 'DECISION', initiativeId, decision });
            const after = this.get(initiativeId);
            if (!after?.decisions.some(d => d.at === decision.at && d.by === decision.by && d.type === decision.type)) {
                throw new Error('[PROPOSAL_OWNER] write verification failed: DECISION did not land');
            }
        };
        if (!record) return { ok: false, reason: 'UNKNOWN_INITIATIVE' };
        if (assignerRole !== UserRole.CREATOR) {
            apply({ type: 'OWNER_ASSIGN_DENIED', by: assignerPrincipalId, owner: ownerPrincipalId, at: now, reason: `assigner role is ${assignerRole ?? 'unknown'}, requires CREATOR (re-derived at decision time)` });
            return { ok: false, reason: 'NOT_AUTHORIZED' };
        }
        if (!ownerExists) {
            apply({ type: 'OWNER_ASSIGN_DENIED', by: assignerPrincipalId, owner: ownerPrincipalId, at: now, reason: `owner ${ownerPrincipalId} is not an existing user` });
            return { ok: false, reason: 'UNKNOWN_OWNER' };
        }
        apply({ type: 'OWNER_ASSIGNED', by: assignerPrincipalId, owner: ownerPrincipalId, at: now });
        return { ok: true, record: { ...this.get(initiativeId)!, decisions: [...this.get(initiativeId)!.decisions] } };
    }

    /** An initiative is dispatchable only with an explicitly assigned owner
     *  who is still an existing user. Anything else - unresolved, unknown,
     *  dangling - is NOT dispatchable. Fail-closed. */
    isDispatchable(initiativeId: string): boolean {
        const record = this.load().get(initiativeId);
        if (!record || record.status !== 'ASSIGNED' || !record.owner) return false;
        try { return identityService.getUserById(record.owner) !== null; } catch { return false; }
    }
}

export const proposalOwners = new ProposalOwnerRegistry(
    process.env.PROPOSAL_OWNER_DIR || path.join(process.cwd(), 'data')
);
