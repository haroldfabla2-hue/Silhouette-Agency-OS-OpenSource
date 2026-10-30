/**
 * DURABLE CONSENT LEDGER (R8).
 *
 * The confirmation gate's records are security evidence, not a cache:
 * proposals, explicit decisions, expiries and the single execution permit
 * survive restarts and abrupt process termination, and are never rewritten
 * into a different truth. Expiry-without-decision is EXPIRED, never a human
 * rejection; a consumed permit keeps its receipt (who/when), and
 * outcome-unknown stays out of this layer entirely (no retry authority is
 * minted here).
 *
 * Atomicity: every mutation runs under a cross-process lock file
 * (O_EXCL create + stale-lock recovery), and the consume-permit transition
 * APPROVED -> CONSUMED reloads from disk under that lock. Two concurrent
 * final consumers - same process or different processes - get exactly ONE
 * permit. Writes are tmp+rename, mode 0600.
 *
 * Declared limits: this is a same-host store; the lock file and 0600
 * permissions are not a boundary against an attacker with the executor's OS
 * user (that separation is infrastructure work, see
 * docs/verification/owner-issuer-boundary-preparation.md). Records are
 * durable evidence, not protection from a privileged writer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ConsentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED';

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
    /** Provenance when this record re-offers an earlier expired one. */
    reofferOf?: string;
    reofferCount?: number;
}

export type ConsumeResult =
    | { result: 'CONSUMED'; record: ConsentRecord }
    | { result: 'LOST' | 'NOT_APPROVED' | 'WRONG_PRINCIPAL' | 'WRONG_CONVERSATION' | 'EXPIRED' | 'UNKNOWN' };

export type ReofferResult =
    | { ok: true; record: ConsentRecord }
    | { ok: false; reason: 'UNKNOWN' | 'NOT_EXPIRED' | 'ALREADY_CONSUMED' | 'EXPLICITLY_REJECTED' };

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 15;
const LOCK_TIMEOUT_MS = 10_000;

export class ConsentLedger {
    private readonly file: string;
    private readonly lockFile: string;

    constructor(private readonly dir: string) {
        this.file = path.join(dir, 'pending-effects.json');
        this.lockFile = `${this.file}.lock`;
    }

    private readDisk(): Map<string, ConsentRecord> {
        try {
            const rows = JSON.parse(fs.readFileSync(this.file, 'utf8')) as ConsentRecord[];
            const map = new Map<string, ConsentRecord>();
            for (const r of Array.isArray(rows) ? rows : []) {
                if (r && typeof r.token === 'string') map.set(r.token, r);
            }
            return map;
        } catch {
            return new Map();
        }
    }

    private writeDisk(map: Map<string, ConsentRecord>): void {
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...map.values()], null, 1), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    /** Reconcile time-passed truth: PENDING/APPROVED past expiry become
     *  EXPIRED (a non-decision), never REJECTED. Records are kept. */
    private reconcile(map: Map<string, ConsentRecord>, now: number): boolean {
        let changed = false;
        for (const r of map.values()) {
            if ((r.status === 'PENDING' || r.status === 'APPROVED') && r.expiresAt <= now) {
                r.status = 'EXPIRED';
                changed = true;
            }
        }
        return changed;
    }

    /** Load view: ALWAYS a fresh disk read, reconciled. Decisions made by
     *  another process must be visible here - a cache would hide them. */
    load(now: number = Date.now()): Map<string, ConsentRecord> {
        const map = this.readDisk();
        if (this.reconcile(map, now)) this.writeDisk(map);
        return map;
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
                        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                            fs.unlinkSync(this.lockFile); // holder died mid-mutation
                            continue;
                        }
                    } catch { /* lock vanished: retry */ }
                    if (Date.now() - start > LOCK_TIMEOUT_MS) {
                        throw new Error('[CONSENT_LEDGER] lock timeout');
                    }
                    const until = Date.now() + LOCK_RETRY_MS;
                    while (Date.now() < until) { /* short spin; mutations are sub-ms */ }
                    continue;
                }
                throw e;
            }
        }
    }

    private releaseLock(): void {
        try { fs.unlinkSync(this.lockFile); } catch { /* already gone */ }
    }

    /** Mutate under the cross-process lock with a FRESH disk view; the in-
     *  memory cache is replaced by the post-mutation truth. */
    private mutate<T>(fn: (map: Map<string, ConsentRecord>) => { out: T; dirty: boolean }): T {
        this.acquireLock();
        try {
            const map = this.readDisk();
            this.reconcile(map, Date.now());
            const { out, dirty } = fn(map);
            if (dirty) this.writeDisk(map);
            return out;
        } finally {
            this.releaseLock();
        }
    }

    get(token: string, now: number = Date.now()): ConsentRecord | undefined {
        return this.load(now).get(token);
    }

    all(now: number = Date.now()): ConsentRecord[] {
        return [...this.load(now).values()];
    }

    put(record: ConsentRecord): void {
        this.mutate(map => ({ out: undefined, dirty: (map.set(record.token, record), true) }));
    }

    update(token: string, patch: Partial<ConsentRecord>): ConsentRecord | undefined {
        return this.mutate(map => {
            const r = map.get(token);
            if (!r) return { out: undefined, dirty: false };
            Object.assign(r, patch);
            map.set(token, r);
            return { out: r, dirty: true };
        });
    }

    /**
     * THE single execution permit: APPROVED -> CONSUMED, atomically, bound to
     * the principal + conversation the decision belongs to. Exactly one
     * caller across every process gets CONSUMED; everyone else gets a typed
     * loss and MUST NOT execute or retry. The CONSUMED record keeps its
     * receipt (consumedAt); if the process dies after consuming but before
     * acting, the receipt is what later reconciliation trusts - this layer
     * never issues replacement authority.
     */
    consumePermit(token: string, principalId: string, conversationId: string, now: number = Date.now()): ConsumeResult {
        return this.mutate(map => {
            const r = map.get(token);
            if (!r) return { out: { result: 'UNKNOWN' } as ConsumeResult, dirty: false };
            if (r.principalId !== principalId) return { out: { result: 'WRONG_PRINCIPAL' } as ConsumeResult, dirty: false };
            if (r.conversationId !== conversationId) return { out: { result: 'WRONG_CONVERSATION' } as ConsumeResult, dirty: false };
            if (r.status === 'EXPIRED' || r.expiresAt <= now) return { out: { result: 'EXPIRED' } as ConsumeResult, dirty: false };
            if (r.status !== 'APPROVED') {
                return { out: { result: r.status === 'CONSUMED' ? 'LOST' : 'NOT_APPROVED' } as ConsumeResult, dirty: false };
            }
            r.status = 'CONSUMED';
            r.consumedAt = now;
            map.set(token, r);
            return { out: { result: 'CONSUMED', record: { ...r } } as ConsumeResult, dirty: true };
        });
    }

    /**
     * Re-offer an EXPIRED proposal as a NEW pending record with full
     * provenance (original token, original creation time, reoffer count).
     * Explicit rejections and consumed permits are never re-offered: a "no"
     * and a done stay done; only time passing is reversible. Re-offering is
     * NOT approval: the new record awaits its own explicit decision.
     */
    reoffer(token: string, newRecord: Pick<ConsentRecord, 'token' | 'expiresAt'>, now: number = Date.now()): ReofferResult {
        return this.mutate(map => {
            const original = map.get(token);
            if (!original) return { out: { ok: false, reason: 'UNKNOWN' } as ReofferResult, dirty: false };
            if (original.status === 'REJECTED') return { out: { ok: false, reason: 'EXPLICITLY_REJECTED' } as ReofferResult, dirty: false };
            if (original.status === 'CONSUMED') return { out: { ok: false, reason: 'ALREADY_CONSUMED' } as ReofferResult, dirty: false };
            if (original.status !== 'EXPIRED') return { out: { ok: false, reason: 'NOT_EXPIRED' } as ReofferResult, dirty: false };
            const record: ConsentRecord = {
                ...original,
                token: newRecord.token,
                status: 'PENDING',
                createdAt: now,
                expiresAt: newRecord.expiresAt,
                approvedAt: undefined,
                rejectedAt: undefined,
                consumedAt: undefined,
                reofferOf: original.reofferOf ?? original.token,
                reofferCount: (original.reofferCount ?? 0) + 1,
            };
            map.set(record.token, record);
            return { out: { ok: true, record: { ...record } } as ReofferResult, dirty: true };
        });
    }
}
