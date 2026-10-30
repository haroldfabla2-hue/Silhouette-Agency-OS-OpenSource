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

interface ReplayEntry { messageId: string; nonce: string; exp: number }

/** Durable replay registry: seen (messageId, nonce) pairs persist across
 *  restarts so a re-emitted signed message never acquires authority twice.
 *  Writes are tmp+rename (no torn state) with mode 0600. */
class ReplayStore {
    private seen: ReplayEntry[] | null = null;
    private readonly file: string;

    constructor(private readonly dir: string) {
        this.file = path.join(dir, 'ingress-replay.json');
    }

    private load(): ReplayEntry[] {
        if (this.seen) return this.seen;
        try {
            const rows = JSON.parse(fs.readFileSync(this.file, 'utf8')) as ReplayEntry[];
            this.seen = Array.isArray(rows) ? rows : [];
        } catch {
            this.seen = [];
        }
        return this.seen;
    }

    private save(): void {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.seen), { mode: 0o600 });
            fs.renameSync(tmp, this.file);
        } catch (e: any) {
            console.warn('[INGRESS] replay store persist failed:', e?.message);
        }
    }

    /** True when this (messageId, nonce) was already recorded. */
    has(messageId: string, nonce: string, now: number): boolean {
        const rows = this.load();
        return rows.some(r => r.messageId === messageId && r.nonce === nonce && r.exp > now);
    }

    /** Record a verified message. Only called AFTER every other check passes,
     *  so a rejected envelope never burns its nonce. */
    mark(messageId: string, nonce: string, exp: number, now: number): void {
        const rows = this.load();
        this.seen = rows.filter(r => r.exp > now);
        this.seen!.push({ messageId, nonce, exp });
        this.save();
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
        if (this.replay.has(e.messageId, e.nonce, now)) return { ok: false, reason: 'REPLAY' };
        this.replay.mark(e.messageId, e.nonce, e.exp!, now);
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
