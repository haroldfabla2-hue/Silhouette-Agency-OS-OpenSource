import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/** Signs bytes with a key the CALLER owns. Keys are never generated, stored or defaulted by the ledger. */
export interface ReceiptSigner { readonly keyId: string; sign(payload: Buffer): Buffer }
export interface SignedReceiptEntry { seq: number; runId: string; payload: string; entryHash: string; signature: string; keyId: string }
export interface ReceiptPayload {
    v: 1; runId: string; procedureId: string; version: number; ownerId: string; contractHash: string;
    epoch: number; state: 'SUCCEEDED' | 'FAILED' | 'REVOKED'; receipt: string; completedAt: number; prevEntryHash: string;
}
export const GENESIS_HASH = '0'.repeat(64);

export function generateReceiptKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}
/** keyId is the SHA-256 of the SPKI public key, so it cannot be chosen independently of the key. */
export function receiptKeyId(publicKeyPem: string): string {
    return createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32);
}
export function createEd25519Signer(privateKeyPem: string): ReceiptSigner {
    const key: KeyObject = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Receipt signer requires an Ed25519 key');
    const keyId = receiptKeyId(createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString());
    return { keyId, sign: payload => sign(null, payload, key) };
}
export function canonicalPayload(p: ReceiptPayload): string {
    // Fixed key order so the signed bytes are reproducible.
    return JSON.stringify({ v: p.v, runId: p.runId, procedureId: p.procedureId, version: p.version, ownerId: p.ownerId, contractHash: p.contractHash, epoch: p.epoch, state: p.state, receipt: p.receipt, completedAt: p.completedAt, prevEntryHash: p.prevEntryHash });
}
export const entryHashOf = (payload: string): string => createHash('sha256').update(payload).digest('hex');
export function verifyEntrySignature(entry: Pick<SignedReceiptEntry, 'payload' | 'entryHash' | 'signature' | 'keyId'>, publicKeyPem: string): boolean {
    try {
        if (receiptKeyId(publicKeyPem) !== entry.keyId || entryHashOf(entry.payload) !== entry.entryHash) return false;
        return verify(null, Buffer.from(entry.payload), createPublicKey(publicKeyPem), Buffer.from(entry.signature, 'base64'));
    } catch { return false; }
}

export interface KeyRotationEntry { seq: number; payload: string; signature: string; oldKeyId: string; newKeyId: string }
export interface RotationPayload { v: 1; kind: 'ROTATE'; oldKeyId: string; newKeyId: string; newPublicKeyPem: string; prevEntryHash: string; at: number }
export function canonicalRotation(p: RotationPayload): string {
    return JSON.stringify({ v: p.v, kind: p.kind, oldKeyId: p.oldKeyId, newKeyId: p.newKeyId, newPublicKeyPem: p.newPublicKeyPem, prevEntryHash: p.prevEntryHash, at: p.at });
}
/** A rotation is valid only if signed by the key it retires and it names a new key whose id matches its public key. */
export function verifyRotationSignature(entry: Pick<KeyRotationEntry, 'payload' | 'signature'>, oldPublicKeyPem: string): RotationPayload | undefined {
    try {
        const p = JSON.parse(entry.payload) as RotationPayload;
        if (p.v !== 1 || p.kind !== 'ROTATE' || receiptKeyId(oldPublicKeyPem) !== p.oldKeyId || receiptKeyId(p.newPublicKeyPem) !== p.newKeyId || p.oldKeyId === p.newKeyId) return undefined;
        if (canonicalRotation(p) !== entry.payload) return undefined;
        return verify(null, Buffer.from(entry.payload), createPublicKey(oldPublicKeyPem), Buffer.from(entry.signature, 'base64')) ? p : undefined;
    } catch { return undefined; }
}
