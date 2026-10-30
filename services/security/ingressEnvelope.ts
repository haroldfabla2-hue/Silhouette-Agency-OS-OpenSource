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
    | 'REPLAY';

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

/** Durable replay registry: seen (messageId, nonce) pairs persist across
 *  restarts so a re-emitted signed message never acquires authority twice.
 *
 *  ATOMICITY WITHOUT LOCKS (H3-root fix): the store is an append-only
 *  JSONL claim log. A verifier appends its claim and re-reads the file;
 *  the FIRST live claim for a pair wins. O_APPEND gives one total order
 *  of lines and every verifier re-reads after its own append, so the
 *  first appender always sees itself win and any later appender always
 *  sees the earlier claim: exactly one winner, across processes, with NO
 *  lock file and no stale-lock recovery. (The previous O_EXCL lock +
 *  stale-unlink recovery had a stat->unlink TOCTOU where two recoverers
 *  could both hold the lock; that class is eliminated by removing the
 *  lock, not patched.)
 *
 *  Crash semantics, fail-closed: a claim appended by a process that then
 *  dies persists, so the envelope is burned (never double authority); a
 *  torn line from a crash mid-append is skipped on read, and if THIS
 *  verifier's claim cannot be read back the check returns false (deny).
 *  Dead entries (exp <= now) are ignored on read.
 *
 *  DECLARED LIMIT: append-only; physical compaction (safe only via
 *  quiescing or generation files) is deferred to the infrastructure
 *  decision - growth is one short line per verified envelope. */
class ReplayStore {
    private readonly file: string;
    private readonly legacyFile: string;

    constructor(private readonly dir: string) {
        this.file = path.join(dir, 'ingress-replay.jsonl');
        this.legacyFile = path.join(dir, 'ingress-replay.json');
    }

    private appendLine(obj: unknown): void {
        fs.mkdirSync(this.dir, { recursive: true });
        // O_APPEND + torn-tail healing: a crash mid-append leaves a partial
        // line without a newline; close it or the next claim merges into
        // the fragment and is skipped with it (fail-closed but burned).
        const fd = fs.openSync(this.file, 'a+', 0o600);
        try {
            const st = fs.fstatSync(fd);
            if (st.size > 0) {
                const last = Buffer.alloc(1);
                fs.readSync(fd, last, 0, 1, st.size - 1);
                if (last[0] !== 0x0a) fs.writeSync(fd, '\n');
            }
            fs.writeSync(fd, JSON.stringify(obj) + '\n');
        } finally {
            fs.closeSync(fd);
        }
    }

    private readLive(now: number): ReplayEntry[] {
        // One-time continuity import of the pre-append-log store.
        if (!fs.existsSync(this.file) && fs.existsSync(this.legacyFile)) {
            try {
                const rows = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8')) as { messageId: string; nonce: string; exp: number }[];
                for (const r of Array.isArray(rows) ? rows : []) {
                    if (r && typeof r.messageId === 'string' && typeof r.nonce === 'string') {
                        this.appendLine({ m: r.messageId, n: r.nonce, e: r.exp, c: 'migrated' });
                    }
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
        const rows: ReplayEntry[] = [];
        for (const line of raw.split('\n')) {
            if (!line) continue;
            try {
                const r = JSON.parse(line);
                if (r && typeof r.m === 'string' && typeof r.n === 'string' && typeof r.e === 'number' && r.e > now) {
                    rows.push({ messageId: r.m, nonce: r.n, exp: r.e, c: String(r.c ?? '') });
                }
            } catch { /* torn line from a crash mid-append: skip - that writer died before deciding */ }
        }
        return rows;
    }

    /** Atomic across processes: returns TRUE when this (messageId, nonce)
     *  was just recorded (first verifier wins), FALSE when it was already
     *  recorded (replay) or the claim did not land durably (fail-closed
     *  deny). Only called AFTER every other check passes, so a rejected
     *  envelope never burns its nonce. */
    checkAndMark(messageId: string, nonce: string, exp: number, now: number): boolean {
        if (this.readLive(now).some(r => r.messageId === messageId && r.nonce === nonce)) return false;
        const me = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
        this.appendLine({ m: messageId, n: nonce, e: exp, c: me });
        const first = this.readLive(now).find(r => r.messageId === messageId && r.nonce === nonce);
        return !!first && first.c === me;
    }
}

export class IngressAuthority {
    private readonly key: Buffer;
    readonly keyId: string;
    private readonly replay: ReplayStore;
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly ephemeral: boolean;

    constructor(opts: { key?: Buffer; keyFile?: string; replayDir: string; ttlMs?: number; now?: () => number }) {
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
        this.replay = new ReplayStore(opts.replayDir);
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
        const iat = this.now();
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
        if (now > e.exp!) return { ok: false, reason: 'EXPIRED' };
        if (e.channel !== actual.channel) return { ok: false, reason: 'CHANNEL_MISMATCH' };
        if (e.senderId !== actual.senderId) return { ok: false, reason: 'SENDER_MISMATCH' };
        if (e.messageId !== actual.messageId) return { ok: false, reason: 'MESSAGE_MISMATCH' };
        if (e.conversationId !== actual.conversationId) return { ok: false, reason: 'CONVERSATION_MISMATCH' };
        if (e.contentDigest !== contentDigest(actual.content)) return { ok: false, reason: 'CONTENT_MISMATCH' };
        if (!this.replay.checkAndMark(e.messageId, e.nonce, e.exp!, now)) {
            return { ok: false, reason: 'REPLAY' };
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
