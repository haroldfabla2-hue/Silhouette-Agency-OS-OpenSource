import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { ProcedureApprovalLedger } from '../../services/procedureApprovalLedger';
import type { Procedure } from '../../services/memoryEvidence';
import type { AssertionResponse } from '../../services/procedureOwnerIdentity';

/**
 * SOFTWARE authenticator: real P-256 keys and real ECDSA signatures in the exact WebAuthn byte formats,
 * but NOT a hardware device or a browser. It proves the server-side verification logic, not any platform authenticator.
 */
const RP = 'review.test', ORIGIN = 'https://review.test';
const b64u = (b: Buffer) => b.toString('base64url'), sha = (x: Buffer | string) => createHash('sha256').update(x).digest();
const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cInt = (n: number) => n >= 0 ? head(0, n) : head(1, -1 - n);
const cBytes = (b: Buffer) => Buffer.concat([head(2, b.length), b]), cText = (s: string) => Buffer.concat([head(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cMap = (pairs: [Buffer, Buffer][]) => Buffer.concat([head(5, pairs.length), ...pairs.flat()]);
class Authenticator {
    private priv: KeyObject; private pubJwk: { x: string; y: string }; readonly credId = randomBytes(32); counter = 0;
    constructor() { const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }); this.priv = privateKey; this.pubJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }; }
    private authData(flags: number, withKey: boolean): Buffer {
        const c = Buffer.alloc(4); c.writeUInt32BE(this.counter);
        const base = Buffer.concat([sha(RP), Buffer.from([flags]), c]);
        if (!withKey) return base;
        const cose = cMap([[cInt(1), cInt(2)], [cInt(3), cInt(-7)], [cInt(-1), cInt(1)], [cInt(-2), cBytes(Buffer.from(this.pubJwk.x, 'base64url'))], [cInt(-3), cBytes(Buffer.from(this.pubJwk.y, 'base64url'))]]);
        const idLen = Buffer.alloc(2); idLen.writeUInt16BE(this.credId.length);
        return Buffer.concat([base, Buffer.alloc(16), idLen, this.credId, cose]);
    }
    register(challenge: string, origin = ORIGIN, flags = 0x45) {
        const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
        const att = cMap([[cText('fmt'), cText('none')], [cText('attStmt'), cMap([])], [cText('authData'), cBytes(this.authData(flags, true))]]);
        return { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(att) };
    }
    assert(challenge: string, o: { origin?: string; flags?: number; bumpCounter?: boolean; type?: string; credId?: Buffer } = {}): AssertionResponse {
        if (o.bumpCounter !== false) this.counter += 1;
        const clientDataJSON = Buffer.from(JSON.stringify({ type: o.type ?? 'webauthn.get', challenge, origin: o.origin ?? ORIGIN, crossOrigin: false }));
        const ad = this.authData(o.flags ?? 0x05, false);
        const signature = createSign('sha256').update(Buffer.concat([ad, sha(clientDataJSON)])).sign(this.priv);
        return { credentialId: b64u(o.credId ?? this.credId), clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(ad), signature: b64u(signature) };
    }
}
const directories: string[] = []; const handles: ProcedureApprovalLedger[] = [];
afterEach(async () => { handles.splice(0).forEach(x => x.close()); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
const procedure = (): Procedure => ({ id: 'p', version: 1, ownerId: 'owner-a', sourceIds: ['s'], preconditions: ['t'], postconditions: ['h'], context: 'test-only', successfulRuns: 0, failedRuns: 0, state: 'PROPOSED', steps: [JSON.stringify({ schema: 1, steps: [{ op: 'write', path: 'out.txt', text: 'x' }, { op: 'assert', path: 'out.txt', sha256: sha('x').toString('hex') }] })] });
async function enrolled(ttl?: number) {
    const dir = await mkdtemp(join(tmpdir(), 'idn-')); directories.push(dir);
    const ledger = new ProcedureApprovalLedger(join(dir, 'l.sqlite'), { ownerIdentity: { rpId: RP, origins: [ORIGIN], challengeTtlMs: ttl } }); handles.push(ledger);
    const auth = new Authenticator(); const p = procedure(), hash = ledger.register(p);
    const ch = ledger.issueEnrollmentChallenge(p.ownerId); ledger.enrollCredential(p.ownerId, ch, auth.register(ch));
    return { ledger, auth, p, hash };
}
const approve = (l: ProcedureApprovalLedger, p: Procedure, hash: string, a: Authenticator, o: Parameters<Authenticator['assert']>[1] = {}) => {
    const ch = l.issueDecisionChallenge(p.id, p.version, p.ownerId, hash, 'approve', 'reviewed exact contract');
    l.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'approve', 'reviewed exact contract', ch, a.assert(ch, o));
};
describe('owner identity: WebAuthn assertion gate (software authenticator)', () => {
    it('blocks the plain decide() path once identity is configured, approves with a valid assertion, then reserve works', async () => {
        const { ledger, auth, p, hash } = await enrolled();
        expect(() => ledger.decide(p.id, p.version, p.ownerId, hash, 'approve', 'x')).toThrow('assertion required');
        approve(ledger, p, hash, auth);
        expect(ledger.reserve(p.id, p.version, p.ownerId, hash).epoch).toBe(1);
    });
    it('a challenge is single-use and bound to the exact decision, reason, contract and owner', async () => {
        const { ledger, auth, p, hash } = await enrolled();
        const ch = ledger.issueDecisionChallenge(p.id, p.version, p.ownerId, hash, 'approve', 'reason A');
        expect(() => ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'approve', 'reason B', ch, auth.assert(ch))).toThrow('different decision');
        expect(() => ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'approve', 'reason A', ch, auth.assert(ch))).toThrow('used');
        const ch2 = ledger.issueDecisionChallenge(p.id, p.version, p.ownerId, hash, 'approve', 'r');
        ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'approve', 'r', ch2, auth.assert(ch2));
        expect(() => ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'approve', 'r', ch2, auth.assert(ch2))).toThrow('used');
    });
    it('rejects wrong origin, missing user verification, wrong ceremony type, unknown credential and a forged signature', async () => {
        const { ledger, auth, p, hash } = await enrolled();
        const attempt = (o: Parameters<Authenticator['assert']>[1]) => () => approve(ledger, p, hash, auth, o);
        expect(attempt({ origin: 'https://evil.test' })).toThrow('Origin');
        expect(attempt({ flags: 0x01 })).toThrow('verification required');
        expect(attempt({ type: 'webauthn.create' })).toThrow('ceremony');
        expect(attempt({ credId: randomBytes(32) })).toThrow('not enrolled');
        const other = new Authenticator(); other.counter = 50; // different key, same credential id is impossible to enroll, so forge by reusing the id
        const ch = ledger.issueDecisionChallenge(p.id, p.version, p.ownerId, hash, 'approve', 'r');
        const forged = other.assert(ch, { credId: auth.credId });
        expect(() => ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'approve', 'r', ch, forged)).toThrow('signature');
        expect(() => ledger.reserve(p.id, p.version, p.ownerId, hash)).toThrow('not approved');
    });
    it('detects a replayed/cloned authenticator by its counter, and a failed attempt burns the challenge', async () => {
        const { ledger, auth, p, hash } = await enrolled();
        approve(ledger, p, hash, auth); // counter 1 stored
        const ch = ledger.issueDecisionChallenge(p.id, p.version, p.ownerId, hash, 'revoke', 'r');
        expect(() => ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'revoke', 'r', ch, auth.assert(ch, { bumpCounter: false }))).toThrow('counter');
        expect(() => ledger.decideWithAssertion(p.id, p.version, p.ownerId, hash, 'revoke', 'r', ch, auth.assert(ch))).toThrow('used');
    });
    it('expired challenges and a contract that changed after issue are refused', async () => {
        const e = await enrolled(1); const ch = e.ledger.issueDecisionChallenge(e.p.id, e.p.version, e.p.ownerId, e.hash, 'approve', 'r');
        await new Promise(r => setTimeout(r, 15));
        expect(() => e.ledger.decideWithAssertion(e.p.id, e.p.version, e.p.ownerId, e.hash, 'approve', 'r', ch, e.auth.assert(ch))).toThrow('expired');
        const f = await enrolled(); const stale = f.ledger.issueDecisionChallenge(f.p.id, f.p.version, f.p.ownerId, f.hash, 'approve', 'r');
        approve(f.ledger, f.p, f.hash, f.auth); // epoch moves
        expect(() => f.ledger.decideWithAssertion(f.p.id, f.p.version, f.p.ownerId, f.hash, 'approve', 'r', stale, f.auth.assert(stale))).toThrow('changed');
    });
    it('a credential enrolled for one owner cannot decide for another; enrollment rejects bad flags/origin and reuse', async () => {
        const { ledger, auth } = await enrolled();
        const other = { ...procedure(), ownerId: 'owner-b' }; const h2 = ledger.register(other);
        const ch = ledger.issueDecisionChallenge(other.id, 1, 'owner-b', h2, 'approve', 'r');
        expect(() => ledger.decideWithAssertion(other.id, 1, 'owner-b', h2, 'approve', 'r', ch, auth.assert(ch))).toThrow('not enrolled');
        const a2 = new Authenticator();
        let e = ledger.issueEnrollmentChallenge('owner-a'); expect(() => ledger.enrollCredential('owner-a', e, a2.register(e, ORIGIN, 0x41))).toThrow('verification');
        e = ledger.issueEnrollmentChallenge('owner-a'); expect(() => ledger.enrollCredential('owner-a', e, a2.register(e, 'https://evil.test'))).toThrow('Origin');
        e = ledger.issueEnrollmentChallenge('owner-a'); expect(() => ledger.enrollCredential('owner-a', e, auth.register(e))).toThrow('already enrolled');
        e = ledger.issueEnrollmentChallenge('owner-a'); expect(() => ledger.enrollCredential('owner-b', e, a2.register(e))).toThrow('enrollment challenge');
    });
    it('without ownerIdentity the ledger behaves as before (caller-authenticated decide)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'idn-')); directories.push(dir);
        const l = new ProcedureApprovalLedger(join(dir, 'l.sqlite')); handles.push(l); const p = procedure(), hash = l.register(p);
        l.decide(p.id, 1, p.ownerId, hash, 'approve', 'ok'); expect(l.reserve(p.id, 1, p.ownerId, hash).epoch).toBe(1);
        expect(() => l.issueEnrollmentChallenge('x')).toThrow('not configured');
    });
});
