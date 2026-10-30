/**
 * CHANNEL INGRESS PROVENANCE ENVELOPE (R7 contract layer).
 *
 * A bus payload field (`role`, `senderId`, a claimed `principalId`) is a
 * CLAIM, never authority: any in-process emitter or Redis publisher can write
 * it. The only way a channel message acquires an authenticated principal is a
 * signed envelope issued by the channel ingress AFTER identity resolution and
 * verified at the consumption point against the current issuer key.
 *
 * A VERIFIED envelope proves attributable ingress only: this exact message
 * (content digest, stable message id, channel + sender binding) arrived
 * through an authenticated channel ingress at a stated time, bound to this
 * principal and conversation. It NEVER approves an effect, spending, or an
 * owner assignment: those keep their own gates (confirmationGate /
 * effectGate / human confirmations).
 *
 * Keys: HMAC-SHA256 symmetric. Loaded from SILHOUETTE_INGRESS_KEY_FILE
 * (recommended mode 0600) or generated EPHEMERALLY per boot when unset.
 * An ephemeral key fails closed across restarts: envelopes signed by the
 * previous boot's key verify as UNKNOWN_KEY, never silently accept.
 *
 * DECLARED LIMIT: issuer and verifier share the symmetric key in-process, so
 * this layer does NOT protect the issuer from the executor. Issuer keys/code/
 * ledger outside the executor's write domain remain infrastructure work and
 * are explicitly NOT claimed here (see
 * docs/verification/owner-issuer-boundary-preparation.md).
 */
import crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { foldAppendedLines, type ReaderState } from './appendLogReader';

export const ENVELOPE_ISSUER = 'channel-ingress' as const;
export const ENVELOPE_VERSION = 1 as const;
export const DEFAULT_ENVELOPE_TTL_MS = 5 * 60 * 1000;

export interface IngressEnvelope {
    v: typeof ENVELOPE_VERSION;
    iss: typeof ENVELOPE_ISSUER;
    kid: string;
    nonce: string;
    iat: number;
    exp: number;
    channel: string;
    senderId: string;
    messageId: string;
    principalId: string | null;
    conversationId: string;
    contentDigest: string;
    sig: string;
}

export interface EnvelopeInput {
    channel: string;
    senderId: string;
    messageId: string;
    principalId: string | null;
    conversationId: string;
    content: string;
}

export type EnvelopeRejectReason =
    | 'MISSING_ENVELOPE'
    | 'MALFORMED'
    | 'UNKNOWN_KEY'
    | 'BAD_SIGNATURE'
    | 'EXPIRED'
    | 'CONTENT_MISMATCH'
    | 'CHANNEL_MISMATCH'
    | 'SENDER_MISMATCH'
    | 'MESSAGE_MISMATCH'
    | 'CONVERSATION_MISMATCH'
    | 'REPLAY'
    | 'ADMISSION_FULL';

export type EnvelopeVerdict =
    | { ok: true; principalId: string | null; conversationId: string }
    | { ok: false; reason: EnvelopeRejectReason };

const contentDigest = (content: string): string =>
    crypto.createHash('sha256').update(content ?? '', 'utf8').digest('hex');

/** Fixed-order canonical form of every signed field. Any added/removed/
 *  reordered field or altered value changes the signature input. */
const canonicalFields = (e: Omit<IngressEnvelope, 'sig'>): string =>
    JSON.stringify({
        v: e.v, iss: e.iss, kid: e.kid, nonce: e.nonce, iat: e.iat, exp: e.exp,
        channel: e.channel, senderId: e.senderId, messageId: e.messageId,
        principalId: e.principalId, conversationId: e.conversationId,
        contentDigest: e.contentDigest,
    });

interface ReplayEntry { messageId: string; nonce: string; exp: number; c: string }

const REPLAY_MAX_ROWS = 100_000;
const REPLAY_WARN_BYTES = 50 * 1024 * 1024;

/** Durable replay registry: seen (messageId, nonce) pairs persist across
 *  restarts so a re-emitted signed message never acquires authority twice.
 *
 *  ATOMICITY WITHOUT LOCKS: append-only JSONL claim log; a verifier
 *  appends its claim and re-reads; the FIRST live claim for a pair wins.
 *  O_APPEND gives one total order of lines and every verifier re-reads
 *  after its own append, so the first appender always sees itself win:
 *  exactly one winner across processes, no lock file, no stale recovery.
 *
 *  Durability: each claim is ONE write(2) (torn tail healed by prefixing
 *  the newline in the same write), short writes throw, and the write is
 *  fsync'd before checkAndMark returns - the mark is durable before the
 *  envelope acquires authority (covers OS crash, not hardware that lies
 *  about fsync). A torn final line (crash mid-append) is skipped on read;
 *  a verifier whose own claim cannot be read back is DENIED (fail-closed).
 *
 *  Reads: incremental by byte offset with a per-instance row cache pruned
 *  of expired entries; a read error other than ENOENT THROWS (never a
 *  silent empty store); reads are streaming (no file-size limit) and a
 *  live-row count beyond REPLAY_MAX_ROWS throw instead of degrading
 *  silently. Physical compaction remains deferred infrastructure work;
 *  growth past REPLAY_WARN_BYTES logs a one-time warning. */
export class ReplayStore {
    private readonly file: string;
    private readonly legacyFile: string;
    private cache: { reader: ReaderState; rows: ReplayEntry[] } | null = null;
    private warnedSize = false;
    private readerChunkBytes: number;
    private readonly maxRows: number;
    /** Sampling state for the durable denial audit: one META marker per
     *  window carrying the suppressed count (in-memory: a crash loses the
     *  pending suppressed count - the trail proves the abuse existed, it
     *  is not an exact counter). */
    private metaAudit = { last: 0, suppressed: 0 };

    constructor(private readonly dir: string, opts: { readerChunkBytes?: number; maxRows?: number; wallNow?: () => number; monoNow?: () => number } = {}) {
        this.file = path.join(dir, 'ingress-replay.jsonl');
        this.legacyFile = path.join(dir, 'ingress-replay.json');
        this.readerChunkBytes = opts.readerChunkBytes ?? 1024 * 1024;
        this.maxRows = opts.maxRows ?? REPLAY_MAX_ROWS;
        this.wallFn = opts.wallNow ?? (() => Date.now());
        this.wallAtBoot = this.wallFn();
        this.hrAtBoot = process.hrtime.bigint();
        this.monoFn = opts.monoNow ?? (() => this.wallAtBoot + Number((process.hrtime.bigint() - this.hrAtBoot) / 1_000_000n));
    }

    private appendLine(obj: unknown): void {
        fs.mkdirSync(this.dir, { recursive: true });
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
            const data = Buffer.from(prefix + JSON.stringify(obj) + '\n', 'utf8');
            if (fs.writeSync(fd, data, 0, data.length) !== data.length) {
                throw new Error('[INGRESS] short write: replay claim is not durable');
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

    private migrateLegacy(): void {
        let raw: string;
        try {
            raw = fs.readFileSync(this.legacyFile, 'utf8');
        } catch {
            return;
        }
        try {
            const rows = JSON.parse(raw) as { messageId: string; nonce: string; exp: number }[];
            for (const r of Array.isArray(rows) ? rows : []) {
                if (r && typeof r.messageId === 'string' && typeof r.nonce === 'string') {
                    this.appendLine({ m: r.messageId, n: r.nonce, e: r.exp, c: 'migrated' });
                }
            }
            fs.renameSync(this.legacyFile, `${this.legacyFile}.imported`);
        } catch {
            try { fs.renameSync(this.legacyFile, `${this.legacyFile}.unreadable-${Date.now()}`); } catch { /* keep as-is */ }
        }
    }

    /** Two clocks, used in the SAFE direction each:
     *  - ISSUE and EXPIRE on the SAME notion (max(wall, mono), see
     *    validityNow): emission and verification can never disagree, so a
     *    backward wall jump past the TTL does NOT make every new envelope
     *    EXPIRED until restart (mono stays ahead; a restart re-anchors).
     *  - PRUNE a mark only when BOTH clocks consider it dead
     *    (exp <= min(wall, mono)): a backward wall jump then retains marks
     *    longer (memory cost, never authority). Forgetting a live mark is
     *    what would reopen a replay window, so retention errs long.
     *  - EXPIRE an envelope when EITHER clock considers it dead
     *    (exp <= max(wall, mono)): accepting a dead envelope is the
     *    authority failure; rejecting a live one costs the sender a
     *    re-issue with a fresh exp (availability, fails closed).
     *  mono is anchored to the wall clock at boot (wallAtBoot + hrtime
     *  delta), so in normal operation both agree. A fresh process
     *  re-folds the whole log and re-anchors: a restart cannot open a
     *  replay window, it can only retain more. */
    private readonly wallAtBoot: number;
    private readonly hrAtBoot: bigint;
    private readonly wallFn: () => number;
    private readonly monoFn: () => number;
    /** The ONE validity notion shared by issuance and verification:
     *  max(wall, mono). Issuance stamps iat/exp from this same clock. */
    public validityNow(): number {
        return Math.max(this.wallFn(), this.monoFn());
    }
    /** Envelope expiry for verification: dead when EITHER clock says so. */
    public isExpiredByAnyClock(exp: number): boolean {
        return exp <= this.validityNow();
    }

    private readLive(now: number): ReplayEntry[] {
        this.migrateLegacy();
        let rows = this.cache?.rows;
        const state = foldAppendedLines(this.file, this.cache?.reader ?? null,
            () => { rows = []; }, // identity/continuity change: rebuild from the lines that follow
            (line) => {
                if (!line || !rows) return;
                try {
                    const r = JSON.parse(line);
                    if (r && typeof r.m === 'string' && typeof r.n === 'string' && typeof r.e === 'number') {
                        if (r.m.startsWith('__META__')) return; // audit markers: durable in the file, never live rows
                        rows.push({ messageId: r.m, nonce: r.n, exp: r.e, c: String(r.c ?? '') });
                    }
                } catch { /* torn line from a crash mid-append: skip */ }
            },
            this.readerChunkBytes);
        this.cache = { reader: state, rows: rows ?? [] }; // ENOENT: onReset never fires, start empty
        try {
            const size = fs.statSync(this.file).size; // telemetry only; ENOENT raced with the reader is fine
            if (size > REPLAY_WARN_BYTES && !this.warnedSize) {
                this.warnedSize = true;
                console.warn(`[INGRESS] replay log is ${size} bytes; compaction is tracked debt - streaming reads keep verification available, this is the operational alarm to run it`);
            }
        } catch { /* file removed between read and stat: next read handles it */ }
        const pruneAt = Math.min(this.wallFn(), this.monoFn()); // retain while EITHER clock says alive
        this.cache.rows = this.cache.rows.filter(r => r.exp > pruneAt);
        return this.cache.rows;
    }

    /** Atomic across processes: TRUE when this (messageId, nonce) was just
     *  recorded (first verifier wins); FALSE when already recorded (replay)
     *  or when THIS verifier's claim cannot be read back (fail-closed
     *  deny). The claim is fsync'd before returning TRUE. Only called AFTER
     *  every other check passes, so a rejected envelope never burns its
     *  nonce. */
    /** TRUE only when THIS call durably recorded the first mark. */
    checkAndMark(messageId: string, nonce: string, exp: number, now: number): 'MARKED' | 'REPLAY' | 'ADMISSION_FULL' {
        const live = this.readLive(now);
        if (live.some(r => r.messageId === messageId && r.nonce === nonce)) return 'REPLAY';
        if (live.length >= this.maxRows) {
            // Admission full: refuse only NEW marks (fail-closed deny for the
            // new message); verification of already-recorded envelopes keeps
            // working at any size. Rows prune by expiry, so the window drains.
            // The refusal is durable (auditable META marker in the log) and
            // typed - it is never reported as a replay.
            console.error(`[INGRESS] replay-mark admission full (${this.maxRows} live rows); refusing new mark, existing verification unaffected`);
            // Durable audit, SAMPLED like the ledger: one marker per window
            // (with the suppressed count), so a flood cannot amplify disk
            // writes and fsync latency through the audit trail itself.
            if (now - this.metaAudit.last >= 60_000) {
                this.appendLine({ m: '__META__ADMISSION_FULL__', n: crypto.randomBytes(6).toString('hex'), e: now + 60_000, c: 'store', s: this.metaAudit.suppressed } as any);
                this.metaAudit = { last: now, suppressed: 0 };
            } else {
                this.metaAudit.suppressed++;
            }
            return 'ADMISSION_FULL';
        }
        const me = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
        this.appendLine({ m: messageId, n: nonce, e: exp, c: me });
        const first = this.readLive(now).find(r => r.messageId === messageId && r.nonce === nonce);
        return !!first && first.c === me ? 'MARKED' : 'REPLAY';
    }
}

export class IngressAuthority {
    private readonly key: Buffer;
    readonly keyId: string;
    private readonly replay: ReplayStore;
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly ephemeral: boolean;

    constructor(opts: { key?: Buffer; keyFile?: string; replayDir: string; ttlMs?: number; now?: () => number; monoNow?: () => number }) {
        if (opts.key) {
            this.key = opts.key;
            this.ephemeral = false;
        } else if (opts.keyFile) {
            this.key = Buffer.from(fs.readFileSync(opts.keyFile, 'utf8').trim(), 'hex');
            this.ephemeral = false;
        } else {
            this.key = crypto.randomBytes(32);
            this.ephemeral = true;
            console.warn('[INGRESS] No SILHOUETTE_INGRESS_KEY_FILE configured: using an EPHEMERAL per-boot issuer key. ' +
                'Envelopes do not survive restarts (fail-closed UNKNOWN_KEY). A pinned, protected issuer key is infrastructure work not claimed here.');
        }
        this.keyId = crypto.createHash('sha256').update(this.key).digest('hex').slice(0, 16);
        // The authority's clocks ARE the store's clocks: issuance and
        // verification share one validity notion through the store.
        this.replay = new ReplayStore(opts.replayDir, { wallNow: opts.now, monoNow: opts.monoNow });
        this.ttlMs = opts.ttlMs ?? DEFAULT_ENVELOPE_TTL_MS;
        this.now = opts.now ?? Date.now;
    }

    get isEphemeralKey(): boolean { return this.ephemeral; }

    private sign(fields: Omit<IngressEnvelope, 'sig'>): string {
        return crypto.createHmac('sha256', this.key).update(canonicalFields(fields), 'utf8').digest('hex');
    }

    /** Issue a provenance envelope for one resolved incoming message. A null
     *  principalId is a GUEST message: authentic, and still without authority. */
    issue(input: EnvelopeInput): IngressEnvelope {
        // max(wall, mono) - the SAME notion verify() expires by: a backward
        // wall jump past the TTL then never makes every new envelope EXPIRED.
        const iat = this.replay.validityNow();
        const fields: Omit<IngressEnvelope, 'sig'> = {
            v: ENVELOPE_VERSION,
            iss: ENVELOPE_ISSUER,
            kid: this.keyId,
            nonce: crypto.randomBytes(16).toString('hex'),
            iat,
            exp: iat + this.ttlMs,
            channel: input.channel,
            senderId: input.senderId,
            messageId: input.messageId,
            principalId: input.principalId,
            conversationId: input.conversationId,
            contentDigest: contentDigest(input.content),
        };
        return { ...fields, sig: this.sign(fields) };
    }

    /**
     * Verify an envelope against the CURRENT key and the ACTUAL payload fields
     * the consumer is about to use. Fail-closed and typed: any doubt means no
     * authority. The replay mark is recorded only after every other check
     * passes, so a denial never consumes a nonce.
     */
    verify(envelope: unknown, actual: EnvelopeInput): EnvelopeVerdict {
        if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'MISSING_ENVELOPE' };
        const e = envelope as Partial<IngressEnvelope>;
        if (e.v !== ENVELOPE_VERSION || e.iss !== ENVELOPE_ISSUER ||
            typeof e.kid !== 'string' || typeof e.nonce !== 'string' ||
            typeof e.iat !== 'number' || typeof e.exp !== 'number' ||
            typeof e.channel !== 'string' || typeof e.senderId !== 'string' ||
            typeof e.messageId !== 'string' || typeof e.conversationId !== 'string' ||
            typeof e.contentDigest !== 'string' || typeof e.sig !== 'string' ||
            !(e.principalId === null || typeof e.principalId === 'string')) {
            return { ok: false, reason: 'MALFORMED' };
        }
        if (e.kid !== this.keyId) return { ok: false, reason: 'UNKNOWN_KEY' };
        const fields = e as Omit<IngressEnvelope, 'sig'>;
        const expected = Buffer.from(this.sign(fields));
        const presented = Buffer.from(String(e.sig));
        if (expected.length !== presented.length || !crypto.timingSafeEqual(expected, presented)) {
            return { ok: false, reason: 'BAD_SIGNATURE' };
        }
        const now = this.now();
        // Expiry and pruning share one notion: the envelope is dead when
        // EITHER clock says so (max), marks are retained while EITHER says
        // alive (min). A backward wall jump can never make a dead envelope
        // valid again, and a live mark is never forgotten while its
        // envelope could still verify.
        if (this.replay.isExpiredByAnyClock(e.exp!)) return { ok: false, reason: 'EXPIRED' };
        if (e.channel !== actual.channel) return { ok: false, reason: 'CHANNEL_MISMATCH' };
        if (e.senderId !== actual.senderId) return { ok: false, reason: 'SENDER_MISMATCH' };
        if (e.messageId !== actual.messageId) return { ok: false, reason: 'MESSAGE_MISMATCH' };
        if (e.conversationId !== actual.conversationId) return { ok: false, reason: 'CONVERSATION_MISMATCH' };
        if (e.contentDigest !== contentDigest(actual.content)) return { ok: false, reason: 'CONTENT_MISMATCH' };
        const mark = this.replay.checkAndMark(e.messageId, e.nonce, e.exp!, now);
        if (mark !== 'MARKED') {
            return { ok: false, reason: mark }; // 'REPLAY' or 'ADMISSION_FULL' - typed, never conflated
        }
        return { ok: true, principalId: e.principalId!, conversationId: e.conversationId! };
    }
}

/** Default process-wide issuer/verifier. Key comes from
 *  SILHOUETTE_INGRESS_KEY_FILE or is ephemeral per boot (see header). */
export const channelIngress = new IngressAuthority({
    keyFile: process.env.SILHOUETTE_INGRESS_KEY_FILE || undefined,
    replayDir: process.env.INGRESS_REPLAY_DIR || path.join(process.cwd(), 'data'),
    ttlMs: Number(process.env.INGRESS_ENVELOPE_TTL_MS ?? DEFAULT_ENVELOPE_TTL_MS) || DEFAULT_ENVELOPE_TTL_MS,
});
