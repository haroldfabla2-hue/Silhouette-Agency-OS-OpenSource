/**
 * DURABLE CONSENT LEDGER (R8, event-sourced v3).
 *
 * The confirmation gate's records are security evidence, not a cache:
 * proposals, explicit decisions, expiries and the single execution permit
 * survive restarts and abrupt termination, and are never rewritten into a
 * different truth. Expiry-without-decision is EXPIRED, never a human
 * rejection; a consumed permit keeps its receipt (who/when); a REJECTED
 * decision is TERMINAL (never overwritten by a later approval); the
 * executor's OUTCOME is recorded separately, bound to the permit winner,
 * and never implied by consumption.
 *
 * ATOMICITY WITHOUT LOCKS: the store is an append-only JSONL event log.
 * Single-winner transitions (CONSUME permit, REOFFER, DECIDE) are
 * test-and-set by CLAIM: validate against a fresh folded view, append the
 * claim, re-fold; the FIRST claim whose precondition holds at its own
 * position in the log wins, and every process folding the same log reaches
 * the same state. O_APPEND gives one total order of lines and every
 * claimant re-reads after its own append, so the first valid claimant
 * always sees itself win. No lock file, no stale-lock recovery.
 *
 * Claim preconditions (evaluated deterministically in the fold):
 *  - PUT:      ignored if the token already exists (first-wins; a duplicate
 *              or replayed creation never resurrects a decided/consumed
 *              record). REOFFER creates its new token via its own event.
 *  - DECIDE:   APPROVED only from PENDING, unexpired at the decision time,
 *              bound to the record's principal+conversation. REJECTED from
 *              PENDING or APPROVED, unexpired, same binding. Any record with
 *              a consumed permit ignores decisions. REJECTED is terminal.
 *  - CONSUME:  only from APPROVED, unexpired, bound to principal+
 *              conversation, no prior valid CONSUME.
 *  - REOFFER:  only from EXPIRED (time passing is the only reversible
 *              state; rejections and consumed permits never re-offer),
 *              first claim wins (exactly one new pending).
 *  - OUTCOME:  only from the permit WINNER (by === consumedBy), first wins,
 *              never rewritten.
 *  - PATCH:    maintenance only (expiresAt); decision/receipt fields are
 *              claim-managed and PATCH can never touch them.
 *
 * Durability: every event is written in ONE write(2) at O_APPEND EOF (a
 * torn tail from a crash mid-append is healed by prefixing the newline in
 * the SAME write, so no line can merge into a fragment), short writes are
 * detected and throw, and every write is fsync'd before the call returns -
 * a CONSUME claim is durable before the permit holder acts (covers OS
 * crash, not hardware that lies about fsync). On first creation the
 * directory is fsync'd. A torn line from a crash mid-append is skipped on
 * read: that writer died before its claim was durable and never acted on
 * it. Claim timestamps are stamped internally (never caller-supplied).
 *
 * Reads: incremental by byte offset (only new bytes are read and folded;
 * the raw fold is cached per instance and never exposed to callers - load()
 * returns per-record copies with the expiry view applied). A read error
 * other than ENOENT THROWS (fail-closed); an unread log tail beyond
 * TAIL_CAP_BYTES throws instead of risking the string-size wall; more than
 * MAX_RECORDS records throws instead of silently dropping. A log beyond
 * WARN_BYTES logs a one-time warning. Physical compaction is still
 * deferred infrastructure work - these guards make growth a loud, bounded
 * operational issue instead of a silent degradation.
 *
 * Legacy migration: a pre-eventlog pending-effects.json is imported
 * whenever found (PUT first-wins dedupes any partial earlier import), then
 * renamed to .imported; an unreadable legacy file is renamed .unreadable-*
 * (evidence preserved, no infinite retry).
 *
 * Declared limits: same-host store; 0600 is not a boundary against an
 * attacker with the executor's OS user (issuer/ledger separation outside
 * the executor's write domain is infrastructure work, see
 * docs/verification/owner-issuer-boundary-preparation.md). Records are
 * durable evidence, not protection from a privileged writer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readAppendedLines, type ReaderState } from './appendLogReader';

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
    /** Winner-reported outcome, recorded AFTER consumption; absent = unknown. */
    outcome?: EffectOutcome;
    /** Provenance when this record re-offers an earlier expired one. */
    reofferOf?: string;
    reofferCount?: number;
}

/** New-proposal admission full for ONE principal: reads, decisions,
 *  consumes and outcomes of existing records are unaffected, and other
 *  principals are unaffected. Only blocks creating ANOTHER live pending. */
export class PendingAdmissionError extends Error {
    public readonly code = 'PENDING_ADMISSION_FULL' as const;
    constructor(principalId: string, cap: number) {
        super(`[CONSENT_LEDGER] principal ${principalId} already has ${cap} live pending confirmations; decide or let some expire before proposing new actions`);
        this.name = 'PendingAdmissionError';
    }
}

export type ConsumeResult =
    | { result: 'CONSUMED'; record: ConsentRecord }
    | { result: 'LOST' | 'NOT_APPROVED' | 'WRONG_PRINCIPAL' | 'WRONG_CONVERSATION' | 'EXPIRED' | 'UNKNOWN' };

export type ReofferResult =
    | { ok: true; record: ConsentRecord }
    | { ok: false; reason: 'UNKNOWN' | 'NOT_EXPIRED' | 'ALREADY_CONSUMED' | 'EXPLICITLY_REJECTED' | 'ALREADY_REOFFERED' | 'TOKEN_COLLISION' };

type LedgerEvent =
    | { op: 'PUT'; rec: ConsentRecord }
    | { op: 'PATCH'; token: string; patch: { expiresAt?: number }; at: number }
    | { op: 'DECIDE'; token: string; decision: 'APPROVED' | 'REJECTED'; by: string; principalId: string; conversationId: string; at: number }
    | { op: 'CONSUME'; token: string; by: string; principalId: string; conversationId: string; at: number }
    | { op: 'REOFFER'; token: string; rec: ConsentRecord; by: string; at: number }
    | { op: 'OUTCOME'; token: string; outcome: EffectOutcome; by: string; at: number };

/** Fields owned by claim events; a maintenance PATCH can never move them. */
const PATCHABLE: ReadonlySet<string> = new Set(['expiresAt']);

const WARN_RECORDS = 50_000; // telemetry threshold, not a cap
const WARN_BYTES = 50 * 1024 * 1024;  // compaction-debt operational alarm

export class ConsentLedger {
    private readonly file: string;
    private readonly legacyFile: string;
    private cache: { reader: ReaderState; map: Map<string, ConsentRecord> } | null = null;
    private warnedSize = false;
    private warnedRecords = false;
    private readerChunkBytes: number;
    private maxLivePendingPerPrincipal: number;

    constructor(private readonly dir: string, opts: { maxLivePendingPerPrincipal?: number; readerChunkBytes?: number } = {}) {
        this.file = path.join(dir, 'consent-ledger.jsonl');
        this.legacyFile = path.join(dir, 'pending-effects.json');
        this.maxLivePendingPerPrincipal = opts.maxLivePendingPerPrincipal ?? 200;
        this.readerChunkBytes = opts.readerChunkBytes ?? 1024 * 1024;
    }

    private claimant(): string {
        return `${process.pid}:${randomBytes(6).toString('hex')}`;
    }

    private append(event: LedgerEvent): void {
        fs.mkdirSync(this.dir, { recursive: true });
        const existed = fs.existsSync(this.file);
        const fd = fs.openSync(this.file, 'a+', 0o600);
        try {
            // ONE write for (torn-tail-healing newline) + event + newline:
            // a crash can leave at most a partial final line, never a
            // fragment fused with a complete claim.
            const st = fs.fstatSync(fd);
            let prefix = '';
            if (st.size > 0) {
                const last = Buffer.alloc(1);
                fs.readSync(fd, last, 0, 1, st.size - 1);
                if (last[0] !== 0x0a) prefix = '\n';
            }
            const data = Buffer.from(prefix + JSON.stringify(event) + '\n', 'utf8');
            if (fs.writeSync(fd, data, 0, data.length) !== data.length) {
                throw new Error('[CONSENT_LEDGER] short write: event is not durable');
            }
            fs.fsyncSync(fd); // durable before the caller acts on it
        } finally {
            fs.closeSync(fd);
        }
        if (!existed) {
            const dfd = fs.openSync(this.dir, 'r');
            try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
        }
    }

    private migrateLegacy(): void {
        // Import whenever the legacy file is present: PUT first-wins makes a
        // repeated or concurrent import a no-op, and a crash mid-import is
        // completed by the next reader. No marker file, no lock.
        let raw: string;
        try {
            raw = fs.readFileSync(this.legacyFile, 'utf8');
        } catch {
            return; // absent (or already renamed): nothing to import
        }
        try {
            const rows = JSON.parse(raw) as ConsentRecord[];
            for (const r of Array.isArray(rows) ? rows : []) {
                if (r && typeof r.token === 'string') this.append({ op: 'PUT', rec: r });
            }
            fs.renameSync(this.legacyFile, `${this.legacyFile}.imported`);
        } catch {
            try { fs.renameSync(this.legacyFile, `${this.legacyFile}.unreadable-${Date.now()}`); } catch { /* keep as-is */ }
        }
    }

    private foldInto(map: Map<string, ConsentRecord>, events: LedgerEvent[]): void {
        for (const ev of events) {
            if (ev.op === 'PUT') {
                if (!map.has(ev.rec.token)) map.set(ev.rec.token, { ...ev.rec }); // first-wins
            } else if (ev.op === 'PATCH') {
                const r = map.get(ev.token);
                // expiresAt maintenance touches ONLY a live pending:
                // extending an EXPIRED or APPROVED record would re-arm a
                // dead or decided action without a new human decision.
                if (r && r.status === 'PENDING' && r.expiresAt > ev.at) {
                    for (const [k, v] of Object.entries(ev.patch)) {
                        if (PATCHABLE.has(k)) (r as any)[k] = v;
                    }
                }
            } else if (ev.op === 'DECIDE') {
                const r = map.get(ev.token);
                if (r && !r.consumedBy && r.expiresAt > ev.at
                    && r.principalId === ev.principalId && r.conversationId === ev.conversationId) {
                    if (ev.decision === 'REJECTED' && (r.status === 'PENDING' || r.status === 'APPROVED')) {
                        r.status = 'REJECTED';
                        r.rejectedAt = ev.at;
                    } else if (ev.decision === 'APPROVED' && r.status === 'PENDING') {
                        r.status = 'APPROVED';
                        r.approvedAt = ev.at;
                    }
                    // REJECTED is terminal; decisions after CONSUME or after
                    // expiry never apply. First valid decision wins.
                }
            } else if (ev.op === 'CONSUME') {
                const r = map.get(ev.token);
                if (r && !r.consumedBy && r.status === 'APPROVED' && r.expiresAt > ev.at
                    && r.principalId === ev.principalId && r.conversationId === ev.conversationId) {
                    r.status = 'CONSUMED';
                    r.consumedAt = ev.at;
                    r.consumedBy = ev.by;
                }
            } else if (ev.op === 'REOFFER') {
                const r = map.get(ev.token);
                const expired = r && ((r.status === 'PENDING' || r.status === 'APPROVED') && r.expiresAt <= ev.at);
                // The new token is first-wins like PUT: a collision never
                // overwrites an existing record, and the receipt is marked
                // only when the new record actually lands.
                if (r && !r.reofferReceipt && (r.status === 'EXPIRED' || expired) && !map.has(ev.rec.token)) {
                    map.set(ev.rec.token, { ...ev.rec });
                    r.reofferReceipt = { by: ev.by, at: ev.at };
                }
            } else if (ev.op === 'OUTCOME') {
                const r = map.get(ev.token);
                if (r && r.consumedBy && r.consumedBy === ev.by && !r.outcome) r.outcome = ev.outcome;
            }
        }
    }

    /** Raw fold of the log (no expiry view), cached incrementally by byte
     *  offset. Never exposed to callers: load() hands out copies. */
    private rawFold(): Map<string, ConsentRecord> {
        this.migrateLegacy();
        const tail = readAppendedLines(this.file, this.cache?.reader ?? null, this.readerChunkBytes);
        if (!this.cache || tail.reset) this.cache = { reader: tail.state, map: new Map() };
        try {
            const size = fs.statSync(this.file).size; // stat only for telemetry; ENOENT raced with the reader is fine
            if (size > WARN_BYTES && !this.warnedSize) {
                this.warnedSize = true;
                console.warn(`[CONSENT_LEDGER] log is ${size} bytes (>${WARN_BYTES}); compaction is tracked debt - streaming reads keep availability, this is the operational alarm to run it`);
            }
        } catch { /* file removed between read and stat: next read handles it */ }
        if (tail.lines.length > 0) {
            const events: LedgerEvent[] = [];
            for (const line of tail.lines) {
                if (!line) continue;
                try {
                    const ev = JSON.parse(line) as LedgerEvent;
                    if (ev && typeof (ev as any).op === 'string') events.push(ev);
                } catch { /* torn line from a crash mid-append: skip - that writer died before its claim was durable */ }
            }
            this.foldInto(this.cache.map, events);
            if (this.cache.map.size > WARN_RECORDS && !this.warnedRecords) {
                this.warnedRecords = true;
                console.warn(`[CONSENT_LEDGER] ${this.cache.map.size} records in memory (>${WARN_RECORDS}); compaction is tracked debt - admission control bounds new pendings, this is the operational alarm`);
            }
        }
        this.cache.reader = tail.state;
        return this.cache.map;
    }

    /** Load view: fresh fold state (incremental), per-record COPIES with
     *  time-passed truth applied (PENDING/APPROVED past expiry -> EXPIRED, a
     *  non-decision, never a human rejection). Callers can never mutate the
     *  raw fold. */
    load(now: number = Date.now()): Map<string, ConsentRecord> {
        const raw = this.rawFold();
        const out = new Map<string, ConsentRecord>();
        for (const [token, r] of raw) {
            const copy = { ...r };
            if ((copy.status === 'PENDING' || copy.status === 'APPROVED') && copy.expiresAt <= now) {
                copy.status = 'EXPIRED';
            }
            out.set(token, copy);
        }
        return out;
    }

    get(token: string, now: number = Date.now()): ConsentRecord | undefined {
        return this.load(now).get(token);
    }

    all(now: number = Date.now()): ConsentRecord[] {
        return [...this.load(now).values()];
    }

    /** Live (PENDING, unexpired) proposals of one principal. */
    private livePendingCount(principalId: string, now: number): number {
        let n = 0;
        for (const r of this.rawFold().values()) {
            if (r.principalId === principalId && r.status === 'PENDING' && r.expiresAt > now) n++;
        }
        return n;
    }

    private admitNewPending(record: ConsentRecord): void {
        if (record.status !== 'PENDING') return; // decisions/consumes/outcomes are claims, not new proposals
        const now = Date.now();
        if (record.expiresAt <= now) return; // dead on arrival: no budget spent
        if (this.livePendingCount(record.principalId, now) >= this.maxLivePendingPerPrincipal) {
            throw new PendingAdmissionError(record.principalId, this.maxLivePendingPerPrincipal);
        }
    }

    put(record: ConsentRecord, opts: { admission?: boolean } = {}): void {
        if (opts.admission !== false) this.admitNewPending(record); // migration/import appends directly: audit replay is never blocked
        this.append({ op: 'PUT', rec: record });
        if (!this.get(record.token)) {
            throw new Error('[CONSENT_LEDGER] write verification failed: PUT did not land');
        }
    }

    /** Maintenance patch: expiresAt ONLY. Decisions go through decide();
     *  receipts and outcomes are claim-managed. */
    update(token: string, patch: { expiresAt?: number }): ConsentRecord | undefined {
        const current = this.get(token);
        if (!current) return undefined;
        // Fold-level guard is the backstop; refuse here so an ineligible
        // PATCH is never even written to the log.
        if (current.status !== 'PENDING' || current.expiresAt <= Date.now()) {
            throw new Error(`[CONSENT_LEDGER] PATCH refused for ${token}: expiresAt maintenance applies only to a live pending (status ${current.status}); it never re-arms a decided or expired record`);
        }
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

    /** A principal's explicit decision on their own pending record. The
     *  claim is appended; the RETURNED record is the current truth after
     *  the fold - the caller MUST report it, not assume the decision
     *  applied (a race may have decided first; REJECTED is terminal;
     *  decisions after consumption/expiry never apply). */
    decide(token: string, decision: 'APPROVED' | 'REJECTED', principalId: string, conversationId: string): ConsentRecord | undefined {
        this.append({ op: 'DECIDE', token, decision, by: this.claimant(), principalId, conversationId, at: Date.now() });
        return this.get(token);
    }

    /**
     * THE single execution permit: APPROVED -> CONSUMED, atomically, bound to
     * the principal + conversation the decision belongs to. Exactly one
     * caller across every process gets CONSUMED; everyone else gets a typed
     * loss and MUST NOT execute or retry. The claim is fsync'd BEFORE the
     * result is returned, so the permit is durable before any effect runs.
     * Consumption is all this layer proves: what the winner's effect did is
     * recorded separately (recordOutcome) and until then is UNKNOWN.
     */
    consumePermit(token: string, principalId: string, conversationId: string, now: number = Date.now()): ConsumeResult {
        const at = Date.now(); // claim time is stamped internally, never caller-supplied
        const r = this.get(token, now);
        if (!r) return { result: 'UNKNOWN' };
        if (r.principalId !== principalId) return { result: 'WRONG_PRINCIPAL' };
        if (r.conversationId !== conversationId) return { result: 'WRONG_CONVERSATION' };
        if (r.status === 'EXPIRED' || r.expiresAt <= at) return { result: 'EXPIRED' };
        if (r.status !== 'APPROVED') {
            return { result: r.status === 'CONSUMED' ? 'LOST' : 'NOT_APPROVED' };
        }
        const me = this.claimant();
        this.append({ op: 'CONSUME', token, by: me, principalId, conversationId, at });
        const after = this.get(token, at);
        if (after?.consumedBy === me) return { result: 'CONSUMED', record: after };
        // LOST covers both: another claimant won, or MY claim did not land
        // durably (torn write) - either way THIS caller holds no permit and
        // must not execute. Fail-closed.
        return { result: 'LOST' };
    }

    /**
     * Re-offer an EXPIRED proposal as a NEW pending record with full
     * provenance. Only time passing is reversible: explicit rejections and
     * consumed permits never re-offer. The FIRST re-offer claim wins:
     * concurrent re-offers of the same token produce exactly one new
     * pending. Re-offering is NOT approval.
     */
    reoffer(token: string, newRecord: Pick<ConsentRecord, 'token' | 'expiresAt'>, now: number = Date.now()): ReofferResult {
        const at = Date.now();
        const original = this.get(token, now);
        if (!original) return { ok: false, reason: 'UNKNOWN' };
        if (original.status === 'REJECTED') return { ok: false, reason: 'EXPLICITLY_REJECTED' };
        if (original.status === 'CONSUMED') return { ok: false, reason: 'ALREADY_CONSUMED' };
        if (original.reofferReceipt) return { ok: false, reason: 'ALREADY_REOFFERED' };
        if (original.status !== 'EXPIRED') return { ok: false, reason: 'NOT_EXPIRED' };
        if (this.rawFold().has(newRecord.token)) return { ok: false, reason: 'TOKEN_COLLISION' };
        const record: ConsentRecord = {
            ...original,
            token: newRecord.token,
            status: 'PENDING',
            createdAt: at,
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
        this.admitNewPending(record);
        this.append({ op: 'REOFFER', token, rec: record, by: me, at });
        const after = this.get(token, at);
        if (after?.reofferReceipt?.by === me) return { ok: true, record: this.get(record.token, at)! };
        return { ok: false, reason: 'ALREADY_REOFFERED' };
    }

    /**
     * Record what the permit WINNER observed after spending the one permit
     * (reconciliation evidence). The receipt (consumedBy of the CONSUMED
     * result) is required: the fold applies an OUTCOME only from the
     * winner's claimant id. First record wins and is never rewritten.
     * Returns false when the receipt is not the winner's, no permit was
     * consumed, or an outcome already exists; throws if a rightful write
     * failed to land. An absent outcome means UNKNOWN, never "executed".
     */
    recordOutcome(token: string, receipt: string, status: EffectOutcome['status'], detail?: string, now: number = Date.now()): boolean {
        const r = this.get(token, now);
        if (!r || !r.consumedBy || r.outcome) return false;
        if (r.consumedBy !== receipt) return false; // only the permit winner reports
        this.append({ op: 'OUTCOME', token, outcome: { status, at: Date.now(), detail }, by: receipt, at: Date.now() });
        if (!this.get(token)?.outcome) {
            throw new Error('[CONSENT_LEDGER] write verification failed: OUTCOME did not land');
        }
        return true;
    }
}
