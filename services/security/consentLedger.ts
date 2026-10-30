/**
 * DURABLE CONSENT LEDGER (R8, event-sourced).
 *
 * The confirmation gate's records are security evidence, not a cache:
 * proposals, explicit decisions, expiries and the single execution permit
 * survive restarts and abrupt process termination, and are never rewritten
 * into a different truth. Expiry-without-decision is EXPIRED, never a human
 * rejection; a consumed permit keeps its receipt (who/when); the executor's
 * OUTCOME is recorded separately and never implied by consumption.
 *
 * ATOMICITY WITHOUT LOCKS (H3-root fix): the store is an append-only JSONL
 * event log. Single-winner transitions (CONSUME permit, REOFFER) are
 * test-and-set by CLAIM: the caller validates against a fresh folded view,
 * appends its claim, then re-folds; the FIRST claim that is valid at its
 * position in the log wins. O_APPEND gives one total order of lines and
 * every claimant re-reads after its own append, so the first appender
 * always sees itself win and every later claimant always sees the earlier
 * claim: exactly one winner, across processes, with NO lock file and no
 * stale-lock recovery. (The previous O_EXCL lock + stale-unlink recovery
 * had a stat->unlink TOCTOU: two recoverers could both hold the lock.
 * That class is eliminated by removing the lock, not patched.)
 *
 * Crash semantics, fail-safe both ways: a claim appended by a process that
 * then dies before acting persists (e.g. CONSUMED receipt survives SIGKILL)
 * and is never rewritten; a TORN line from a crash mid-append is skipped on
 * read - that writer died before its claim was durable, so it never acted
 * on it. Every mutating method re-reads and verifies its own event landed;
 * a torn or lost write throws a visible error instead of lying.
 *
 * Effect outcome reconciliation: CONSUMED proves only that the one permit
 * was spent. What the executor then OBSERVED (EXECUTOR_OK/EXECUTOR_FAILED)
 * is recorded as a separate first-wins OUTCOME event via recordOutcome().
 * An absent outcome means "unknown" (crash or still running), never
 * "executed". The outcome is the executor's own observation at that moment
 * (e.g. a transport accept), not a delivery guarantee.
 *
 * Declared limits: same-host append-only store. Physical compaction (safe
 * only via quiescing or generation files) is deferred to the
 * infrastructure decision; growth is ~one short line per event and dead
 * records (past expiry) are ignored on read. File mode 0600 is not a
 * boundary against an attacker with the executor's OS user (that separation
 * is infrastructure work, see
 * docs/verification/owner-issuer-boundary-preparation.md). Records are
 * durable evidence, not protection from a privileged writer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export type ConsentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED';

export interface EffectOutcome {
    status: 'EXECUTOR_OK' | 'EXECUTOR_FAILED';
    at: number;
    detail?: string;
}

export interface ConsentRecord {
    token: string;
    key: string;                  // sha256(tool + canonical args)
    tool: string;
    args: Record<string, any>;
    summary: string;              // FULL action content shown for the decision
    principalId: string;
    conversationId: string;
    status: ConsentStatus;
    createdAt: number;
    expiresAt: number;
    approvedAt?: number;
    rejectedAt?: number;
    consumedAt?: number;
    /** Process+random claimant that won the permit (receipt). */
    consumedBy?: string;
    /** Receipt that this expired record was already re-offered (first wins). */
    reofferReceipt?: { by: string; at: number };
    /** Executor-reported outcome, recorded AFTER consumption; absent = unknown. */
    outcome?: EffectOutcome;
    /** Provenance when this record re-offers an earlier expired one. */
    reofferOf?: string;
    reofferCount?: number;
}

export type ConsumeResult =
    | { result: 'CONSUMED'; record: ConsentRecord }
    | { result: 'LOST' | 'NOT_APPROVED' | 'WRONG_PRINCIPAL' | 'WRONG_CONVERSATION' | 'EXPIRED' | 'UNKNOWN' };

export type ReofferResult =
    | { ok: true; record: ConsentRecord }
    | { ok: false; reason: 'UNKNOWN' | 'NOT_EXPIRED' | 'ALREADY_CONSUMED' | 'EXPLICITLY_REJECTED' | 'ALREADY_REOFFERED' };

type LedgerEvent =
    | { op: 'PUT'; rec: ConsentRecord }
    | { op: 'PATCH'; token: string; patch: Partial<ConsentRecord>; at: number }
    | { op: 'CONSUME'; token: string; by: string; principalId: string; conversationId: string; at: number }
    | { op: 'REOFFER'; token: string; rec: ConsentRecord; by: string; at: number }
    | { op: 'OUTCOME'; token: string; outcome: EffectOutcome; by: string; at: number };

export class ConsentLedger {
    private readonly file: string;
    private readonly legacyFile: string;

    constructor(private readonly dir: string) {
        this.file = path.join(dir, 'consent-ledger.jsonl');
        this.legacyFile = path.join(dir, 'pending-effects.json');
    }

    private claimant(): string {
        return `${process.pid}:${randomBytes(6).toString('hex')}`;
    }

    private append(event: LedgerEvent): void {
        fs.mkdirSync(this.dir, { recursive: true });
        // O_APPEND: every write lands atomically at EOF. A crash mid-append
        // leaves a torn tail WITHOUT a newline; heal it first or the next
        // line would merge into the torn fragment and be skipped with it.
        const fd = fs.openSync(this.file, 'a+', 0o600);
        try {
            const st = fs.fstatSync(fd);
            if (st.size > 0) {
                const last = Buffer.alloc(1);
                fs.readSync(fd, last, 0, 1, st.size - 1);
                if (last[0] !== 0x0a) fs.writeSync(fd, '\n');
            }
            fs.writeSync(fd, JSON.stringify(event) + '\n');
        } finally {
            fs.closeSync(fd);
        }
    }

    private readEvents(): LedgerEvent[] {
        // One-time continuity import of the pre-event-sourced store.
        if (!fs.existsSync(this.file) && fs.existsSync(this.legacyFile)) {
            try {
                const rows = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8')) as ConsentRecord[];
                for (const r of Array.isArray(rows) ? rows : []) {
                    if (r && typeof r.token === 'string') this.append({ op: 'PUT', rec: r });
                }
                fs.renameSync(this.legacyFile, `${this.legacyFile}.imported`);
            } catch { /* unreadable legacy: start empty, keep the file as-is */ }
        }
        let raw: string;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        } catch {
            return [];
        }
        const events: LedgerEvent[] = [];
        for (const line of raw.split('\n')) {
            if (!line) continue;
            try {
                const ev = JSON.parse(line) as LedgerEvent;
                if (ev && typeof (ev as any).op === 'string') events.push(ev);
            } catch { /* torn line from a crash mid-append: skip - that writer died before its claim was durable */ }
        }
        return events;
    }

    /** Effective status at time t: PENDING/APPROVED past expiry is EXPIRED
     *  (a non-decision), never a human rejection. */
    private static effective(r: ConsentRecord, t: number): ConsentStatus {
        return (r.status === 'PENDING' || r.status === 'APPROVED') && r.expiresAt <= t ? 'EXPIRED' : r.status;
    }

    /** Deterministic fold; every process folding the same log reaches the
     *  same state. Claims apply only when valid AT THEIR LOG POSITION, so
     *  a claim appended against a stale view (e.g. after a REJECTED patch)
     *  is ignored by every reader identically. */
    private fold(events: LedgerEvent[]): Map<string, ConsentRecord> {
        const map = new Map<string, ConsentRecord>();
        for (const ev of events) {
            if (ev.op === 'PUT') {
                map.set(ev.rec.token, { ...ev.rec });
            } else if (ev.op === 'PATCH') {
                const r = map.get(ev.token);
                if (r) Object.assign(r, ev.patch);
            } else if (ev.op === 'CONSUME') {
                const r = map.get(ev.token);
                if (r && !r.consumedBy && ConsentLedger.effective(r, ev.at) === 'APPROVED'
                    && r.principalId === ev.principalId && r.conversationId === ev.conversationId) {
                    r.status = 'CONSUMED';
                    r.consumedAt = ev.at;
                    r.consumedBy = ev.by;
                }
            } else if (ev.op === 'REOFFER') {
                const r = map.get(ev.token);
                if (r && !r.reofferReceipt && ConsentLedger.effective(r, ev.at) === 'EXPIRED') {
                    r.reofferReceipt = { by: ev.by, at: ev.at };
                    map.set(ev.rec.token, { ...ev.rec });
                }
            } else if (ev.op === 'OUTCOME') {
                const r = map.get(ev.token);
                if (r && r.consumedBy && !r.outcome) r.outcome = ev.outcome;
            }
        }
        return map;
    }

    /** Load view: ALWAYS a fresh fold of the log, with time-passed truth
     *  reconciled into the view. No cache: decisions made by another
     *  process must be visible here. */
    load(now: number = Date.now()): Map<string, ConsentRecord> {
        const map = this.fold(this.readEvents());
        for (const r of map.values()) {
            r.status = ConsentLedger.effective(r, now);
        }
        return map;
    }

    get(token: string, now: number = Date.now()): ConsentRecord | undefined {
        return this.load(now).get(token);
    }

    all(now: number = Date.now()): ConsentRecord[] {
        return [...this.load(now).values()];
    }

    put(record: ConsentRecord): void {
        this.append({ op: 'PUT', rec: record });
        if (!this.get(record.token)) {
            throw new Error('[CONSENT_LEDGER] write verification failed: PUT did not land');
        }
    }

    update(token: string, patch: Partial<ConsentRecord>): ConsentRecord | undefined {
        if (!this.get(token)) return undefined;
        this.append({ op: 'PATCH', token, patch, at: Date.now() });
        const after = this.get(token);
        if (!after) throw new Error('[CONSENT_LEDGER] write verification failed: PATCH target vanished');
        for (const [k, v] of Object.entries(patch)) {
            if (JSON.stringify((after as any)[k]) !== JSON.stringify(v)) {
                throw new Error('[CONSENT_LEDGER] write verification failed: PATCH did not land');
            }
        }
        return after;
    }

    /**
     * THE single execution permit: APPROVED -> CONSUMED, atomically, bound to
     * the principal + conversation the decision belongs to. Exactly one
     * caller across every process gets CONSUMED; everyone else gets a typed
     * loss and MUST NOT execute or retry. Consumption is all this layer
     * proves: whether the winner's EFFECT ran is recorded separately
     * (recordOutcome) and until then is UNKNOWN, never assumed.
     */
    consumePermit(token: string, principalId: string, conversationId: string, now: number = Date.now()): ConsumeResult {
        const r = this.get(token, now);
        if (!r) return { result: 'UNKNOWN' };
        if (r.principalId !== principalId) return { result: 'WRONG_PRINCIPAL' };
        if (r.conversationId !== conversationId) return { result: 'WRONG_CONVERSATION' };
        if (r.status === 'EXPIRED' || r.expiresAt <= now) return { result: 'EXPIRED' };
        if (r.status !== 'APPROVED') {
            return { result: r.status === 'CONSUMED' ? 'LOST' : 'NOT_APPROVED' };
        }
        const me = this.claimant();
        this.append({ op: 'CONSUME', token, by: me, principalId, conversationId, at: now });
        const after = this.get(token, now);
        if (after?.consumedBy === me) return { result: 'CONSUMED', record: after };
        // LOST covers both: another claimant won, or MY claim did not land
        // durably (torn write) - either way THIS caller holds no permit and
        // must not execute. Fail-closed.
        return { result: 'LOST' };
    }

    /**
     * Re-offer an EXPIRED proposal as a NEW pending record with full
     * provenance (original token, original creation time, reoffer count).
     * Explicit rejections and consumed permits are never re-offered: a "no"
     * and a done stay done; only time passing is reversible. The FIRST
     * re-offer claim wins: concurrent re-offers of the same token produce
     * exactly one new pending (the pre-event-sourced code could create
     * two). Re-offering is NOT approval: the new record awaits its own
     * explicit decision.
     */
    reoffer(token: string, newRecord: Pick<ConsentRecord, 'token' | 'expiresAt'>, now: number = Date.now()): ReofferResult {
        const original = this.get(token, now);
        if (!original) return { ok: false, reason: 'UNKNOWN' };
        if (original.status === 'REJECTED') return { ok: false, reason: 'EXPLICITLY_REJECTED' };
        if (original.status === 'CONSUMED') return { ok: false, reason: 'ALREADY_CONSUMED' };
        if (original.reofferReceipt) return { ok: false, reason: 'ALREADY_REOFFERED' };
        if (original.status !== 'EXPIRED') return { ok: false, reason: 'NOT_EXPIRED' };
        const record: ConsentRecord = {
            ...original,
            token: newRecord.token,
            status: 'PENDING',
            createdAt: now,
            expiresAt: newRecord.expiresAt,
            approvedAt: undefined,
            rejectedAt: undefined,
            consumedAt: undefined,
            consumedBy: undefined,
            reofferReceipt: undefined,
            outcome: undefined,
            reofferOf: original.reofferOf ?? original.token,
            reofferCount: (original.reofferCount ?? 0) + 1,
        };
        const me = this.claimant();
        this.append({ op: 'REOFFER', token, rec: record, by: me, at: now });
        const after = this.get(token, now);
        if (after?.reofferReceipt?.by === me) return { ok: true, record: this.get(record.token, now)! };
        return { ok: false, reason: 'ALREADY_REOFFERED' };
    }

    /**
     * Record what the executor OBSERVED after spending the one permit
     * (reconciliation evidence). First record wins and is never rewritten;
     * recording before any consumption or twice returns false. An absent
     * outcome means UNKNOWN (crash or still running), never "executed".
     */
    recordOutcome(token: string, status: EffectOutcome['status'], detail?: string, now: number = Date.now()): boolean {
        const r = this.get(token, now);
        if (!r || !r.consumedBy || r.outcome) return false;
        this.append({ op: 'OUTCOME', token, outcome: { status, at: now, detail }, by: this.claimant(), at: now });
        if (!this.get(token, now)?.outcome) {
            throw new Error('[CONSENT_LEDGER] write verification failed: OUTCOME did not land');
        }
        return true;
    }
}
