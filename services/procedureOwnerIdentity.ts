import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

/** Minimal CBOR reader: only what WebAuthn attestation objects and COSE keys use (maps, arrays, ints, bytes, text, bool/null). */
function cbor(buf: Buffer, at = 0, depth = 0): { value: unknown; end: number } {
    if (depth > 8 || at >= buf.length) throw new Error('Bad CBOR');
    const head = buf[at], major = head >> 5, info = head & 31; let p = at + 1, n: number;
    if (info < 24) n = info;
    else if (info === 24) { n = buf[p]; p += 1; }
    else if (info === 25) { n = buf.readUInt16BE(p); p += 2; }
    else if (info === 26) { n = buf.readUInt32BE(p); p += 4; }
    else throw new Error('Unsupported CBOR length');
    if (p > buf.length) throw new Error('Bad CBOR');
    switch (major) {
        case 0: return { value: n, end: p };
        case 1: return { value: -1 - n, end: p };
        case 2: case 3: { if (p + n > buf.length) throw new Error('Bad CBOR'); const s = buf.subarray(p, p + n); return { value: major === 2 ? Buffer.from(s) : s.toString('utf8'), end: p + n }; }
        case 4: { const a: unknown[] = []; for (let i = 0; i < n; i++) { const r = cbor(buf, p, depth + 1); a.push(r.value); p = r.end; } return { value: a, end: p }; }
        case 5: { const m = new Map<unknown, unknown>(); for (let i = 0; i < n; i++) { const k = cbor(buf, p, depth + 1); const v = cbor(buf, k.end, depth + 1); m.set(k.value, v.value); p = v.end; } return { value: m, end: p }; }
        case 7: if (info === 20) return { value: false, end: p }; if (info === 21) return { value: true, end: p }; if (info === 22) return { value: null, end: p }; throw new Error('Unsupported CBOR');
        default: throw new Error('Unsupported CBOR');
    }
}
const b64u = (b: Buffer): string => b.toString('base64url');
const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_AT = 0x40;
export interface OwnerIdentityConfig { rpId: string; origins: string[]; challengeTtlMs?: number }
export interface RegistrationResponse { clientDataJSON: string; attestationObject: string } // base64url
export interface AssertionResponse { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string } // base64url
export const newChallenge = (): string => b64u(randomBytes(32));

interface ParsedAuthData { rpIdHash: Buffer; flags: number; signCount: number; rest: Buffer }
function parseAuthData(ad: Buffer): ParsedAuthData {
    if (ad.length < 37) throw new Error('Short authenticator data');
    return { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33), rest: ad.subarray(37) };
}
function checkClient(clientDataJSON: string, type: string, challenge: string, cfg: OwnerIdentityConfig): void {
    let c: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
    try { c = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')); } catch { throw new Error('Bad clientDataJSON'); }
    if (c.type !== type) throw new Error('Wrong ceremony type');
    const a = Buffer.from(String(c.challenge)), b = Buffer.from(challenge);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Challenge mismatch');
    if (typeof c.origin !== 'string' || !cfg.origins.includes(c.origin)) throw new Error('Origin not allowed');
    if (c.crossOrigin === true) throw new Error('Cross-origin ceremony refused');
}
/** Registration with attestation "none": proves possession of a fresh key bound to our challenge/origin/rpId, NOT the authenticator make or model. */
export function verifyRegistration(r: RegistrationResponse, challenge: string, cfg: OwnerIdentityConfig): { credentialId: string; publicKeyPem: string; signCount: number } {
    checkClient(r.clientDataJSON, 'webauthn.create', challenge, cfg);
    const att = cbor(Buffer.from(r.attestationObject, 'base64url')).value;
    if (!(att instanceof Map) || att.get('fmt') !== 'none') throw new Error('Only attestation "none" is supported');
    const ad = att.get('authData'); if (!Buffer.isBuffer(ad)) throw new Error('Missing authData');
    const p = parseAuthData(ad);
    if (!p.rpIdHash.equals(sha256(cfg.rpId))) throw new Error('rpId mismatch');
    if ((p.flags & FLAG_UP) === 0 || (p.flags & FLAG_UV) === 0 || (p.flags & FLAG_AT) === 0) throw new Error('User presence, verification and attested data required');
    if (p.rest.length < 18) throw new Error('Short attested data');
    const idLen = p.rest.readUInt16BE(16); if (idLen < 16 || idLen > 1023 || p.rest.length < 18 + idLen) throw new Error('Bad credential id');
    const credentialId = b64u(Buffer.from(p.rest.subarray(18, 18 + idLen)));
    const key = cbor(p.rest, 18 + idLen).value;
    if (!(key instanceof Map) || key.get(1) !== 2 || key.get(3) !== -7 || key.get(-1) !== 1) throw new Error('Only ES256 (P-256) credentials are supported');
    const x = key.get(-2), y = key.get(-3); if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('Bad public key');
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) }, format: 'jwk' });
    return { credentialId, publicKeyPem: pub.export({ type: 'spki', format: 'pem' }).toString(), signCount: p.signCount };
}
/** Assertion: user presence AND verification required; signature over authData||SHA-256(clientDataJSON); counter must advance when the authenticator uses one. */
export function verifyAssertion(a: AssertionResponse, challenge: string, publicKeyPem: string, storedSignCount: number, cfg: OwnerIdentityConfig): { signCount: number } {
    checkClient(a.clientDataJSON, 'webauthn.get', challenge, cfg);
    const ad = Buffer.from(a.authenticatorData, 'base64url'), p = parseAuthData(ad);
    if (!p.rpIdHash.equals(sha256(cfg.rpId))) throw new Error('rpId mismatch');
    if ((p.flags & FLAG_UP) === 0 || (p.flags & FLAG_UV) === 0) throw new Error('User presence and verification required');
    const signed = Buffer.concat([ad, sha256(Buffer.from(a.clientDataJSON, 'base64url'))]);
    let ok = false; try { ok = verify('sha256', signed, createPublicKey(publicKeyPem), Buffer.from(a.signature, 'base64url')); } catch { ok = false; }
    if (!ok) throw new Error('Bad assertion signature');
    if ((p.signCount !== 0 || storedSignCount !== 0) && p.signCount <= storedSignCount) throw new Error('Authenticator counter did not advance (possible cloned credential)');
    return { signCount: p.signCount };
}
