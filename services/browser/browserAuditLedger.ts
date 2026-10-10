// =============================================================================
// SILHOUETTE CRYPTOGRAPHIC BROWSER AUDIT LEDGER (PHASE 23 - SUPREMACY)
// Frame-by-Frame Cryptographically Signed Visual Replay Trail using Ed25519
// Hash-Chaining. Mathematically proves every screenshot, click, and DOM action.
// =============================================================================

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';
import {
    ReceiptSigner, createEd25519Signer, generateReceiptKeyPair, receiptKeyId,
} from '../procedureReceiptSigner';
import { verify as edVerify, createPublicKey } from 'crypto';

export interface AuditFrame {
    frameIndex: number;
    actionType: string;
    targetDescription?: string;
    coordinates?: { x: number; y: number };
    timestamp: number;
    url: string;
    screenshotHash: string; // SHA-256 of visual screenshot
    domHash: string;        // SHA-256 of visible DOM state
    previousFrameHash: string;
    frameHash: string;      // Current combined block hash
    signature?: string;     // Ed25519 signature (base64) over frameHash
    keyId?: string;
}

export interface AuditSession {
    sessionId: string;
    startTime: number;
    endTime?: number;
    initialUrl: string;
    frames: AuditFrame[];
    chainRootHash: string;
    latestHash: string;
    status: 'RECORDING' | 'SEALED';
    /** Public key that verifies every signature of this session. */
    publicKeyPem?: string;
    keyId?: string;
    /** CONFIGURED = key supplied by the owner (trust anchor). EPHEMERAL = per-process key, proves integrity only, not origin. */
    keySource?: 'CONFIGURED' | 'EPHEMERAL';
    /** Ed25519 signature over the seal record (sessionId, root, latest, frameCount, start, end). */
    sealSignature?: string;
    frameCount?: number;
}

export interface VerificationResult { valid: boolean; reason?: string }


/** Hash over EVERY field of a frame, so any edit (description, time, coordinates...) breaks it. */
export function computeFrameHash(f: Pick<AuditFrame, 'frameIndex' | 'actionType' | 'targetDescription' | 'coordinates' | 'timestamp' | 'url' | 'screenshotHash' | 'domHash' | 'previousFrameHash'>): string {
    const data = JSON.stringify([
        f.frameIndex, f.actionType, f.targetDescription ?? null, f.coordinates ?? null,
        f.timestamp, f.url, f.screenshotHash, f.domHash, f.previousFrameHash,
    ]);
    return crypto.createHash('sha256').update(data).digest('hex');
}

export function sealRecord(s: Pick<AuditSession, 'sessionId' | 'chainRootHash' | 'latestHash' | 'startTime' | 'endTime' | 'initialUrl'>, frameCount: number): string {
    return JSON.stringify(['SEAL', s.sessionId, s.initialUrl, s.chainRootHash, s.latestHash, frameCount, s.startTime, s.endTime ?? null]);
}

function edOk(publicKeyPem: string, message: string, sigB64: string | undefined): boolean {
    if (!sigB64) return false;
    try { return edVerify(null, Buffer.from(message), createPublicKey(publicKeyPem), Buffer.from(sigB64, 'base64')); }
    catch { return false; }
}

/**
 * Pure verification of a (sealed) session or manifest. Checks: root, chain links, full frame hashes,
 * every frame signature, key id, timestamp ordering and bounds, and the seal signature that commits to
 * the frame count and terminal hash (so deleting the last frame is detected).
 */
export function verifySession(session: AuditSession, publicKeyPem?: string): VerificationResult {
    const pem = publicKeyPem ?? session.publicKeyPem;
    if (!pem) return { valid: false, reason: 'NO_PUBLIC_KEY' };
    let keyId: string;
    try { keyId = receiptKeyId(pem); } catch { return { valid: false, reason: 'BAD_PUBLIC_KEY' }; }
    if (session.keyId && session.keyId !== keyId) return { valid: false, reason: 'KEY_ID_MISMATCH' };

    let expectedPrev = session.chainRootHash;
    let lastTs = session.startTime;
    for (let i = 0; i < session.frames.length; i++) {
        const f = session.frames[i];
        if (f.frameIndex !== i) return { valid: false, reason: `BAD_INDEX_${i}` };
        if (f.previousFrameHash !== expectedPrev) return { valid: false, reason: `BROKEN_CHAIN_${i}` };
        if (computeFrameHash(f) !== f.frameHash) return { valid: false, reason: `BAD_FRAME_HASH_${i}` };
        if (!edOk(pem, f.frameHash, f.signature)) return { valid: false, reason: `BAD_SIGNATURE_${i}` };
        if (f.keyId && f.keyId !== keyId) return { valid: false, reason: `FRAME_KEY_MISMATCH_${i}` };
        if (typeof f.timestamp !== 'number' || f.timestamp < lastTs) return { valid: false, reason: `BAD_TIMESTAMP_${i}` };
        lastTs = f.timestamp;
        expectedPrev = f.frameHash;
    }
    if (session.status !== 'SEALED') return { valid: false, reason: 'NOT_SEALED' };
    if (session.endTime !== undefined && lastTs > session.endTime) return { valid: false, reason: 'FRAME_AFTER_END' };
    if (session.latestHash !== expectedPrev) return { valid: false, reason: 'TERMINAL_HASH_MISMATCH' };
    if (session.frameCount !== session.frames.length) return { valid: false, reason: 'FRAME_COUNT_MISMATCH' };
    if (!edOk(pem, sealRecord(session, session.frames.length), session.sealSignature)) return { valid: false, reason: 'BAD_SEAL_SIGNATURE' };
    return { valid: true };
}

export class BrowserAuditLedger {
    private sessions: Map<string, AuditSession> = new Map();
    private activeSessionId: string | null = null;
    private readonly auditDir: string;

    private signer: ReceiptSigner;
    private publicKeyPem: string;
    private keySource: 'CONFIGURED' | 'EPHEMERAL';

    /**
     * Key policy: never a hardcoded default. Use BROWSER_AUDIT_SIGNING_KEY (Ed25519 PKCS8 PEM) when
     * the owner provides it (trust anchor). Otherwise a random per-process Ed25519 key is generated and
     * the session is labelled EPHEMERAL (integrity yes, origin attestation no).
     */
    constructor(signerOverride?: { privateKeyPem: string; publicKeyPem: string; source: 'CONFIGURED' | 'EPHEMERAL' }) {
        this.auditDir = path.resolve(process.cwd(), 'uploads', 'audit_trails');
        const envPem = (process.env.BROWSER_AUDIT_SIGNING_KEY || '').replace(/\\n/g, '\n').trim();
        let priv: string; let pub: string; let src: 'CONFIGURED' | 'EPHEMERAL';
        if (signerOverride) { priv = signerOverride.privateKeyPem; pub = signerOverride.publicKeyPem; src = signerOverride.source; }
        else if (envPem) {
            const { createPrivateKey, createPublicKey: cpk } = crypto;
            priv = envPem;
            pub = cpk(createPrivateKey(envPem)).export({ type: 'spki', format: 'pem' }).toString();
            src = 'CONFIGURED';
        } else { const kp = generateReceiptKeyPair(); priv = kp.privateKeyPem; pub = kp.publicKeyPem; src = 'EPHEMERAL'; }
        this.signer = createEd25519Signer(priv);
        this.publicKeyPem = pub;
        this.keySource = src;
    }

    /**
     * Starts a new cryptographically anchored visual audit session.
     */
    public startSession(initialUrl: string): string {
        const sessionId = `audit_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
        const rootHash = crypto.createHash('sha256').update(`ROOT:${sessionId}:${Date.now()}:${initialUrl}`).digest('hex');

        const session: AuditSession = {
            sessionId,
            startTime: Date.now(),
            initialUrl,
            frames: [],
            chainRootHash: rootHash,
            latestHash: rootHash,
            status: 'RECORDING',
            publicKeyPem: this.publicKeyPem,
            keyId: this.signer.keyId,
            keySource: this.keySource
        };

        this.sessions.set(sessionId, session);
        this.activeSessionId = sessionId;

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'BrowserAuditLedger',
            event: 'AUDIT_SESSION_STARTED',
            sessionId,
            initialUrl
        });

        return sessionId;
    }

    /**
     * Appends a frame to the cryptographic hash chain.
     */
    public async recordFrame(params: {
        actionType: string;
        targetDescription?: string;
        coordinates?: { x: number; y: number };
        url: string;
        screenshotBuffer?: Buffer;
        domContent?: string;
    }): Promise<AuditFrame | null> {
        if (!this.activeSessionId) return null;
        const session = this.sessions.get(this.activeSessionId);
        if (!session || session.status !== 'RECORDING') return null;

        const frameIndex = session.frames.length;
        const previousHash = session.latestHash;

        // 1. Compute visual and DOM SHA-256 digests
        const screenshotHash = params.screenshotBuffer
            ? crypto.createHash('sha256').update(params.screenshotBuffer).digest('hex')
            : '0'.repeat(64);

        const domHash = params.domContent
            ? crypto.createHash('sha256').update(params.domContent).digest('hex')
            : '0'.repeat(64);

        // 2. Frame hash covers every field; 3. Ed25519 signature over the hash
        const timestamp = Date.now();
        const base = {
            frameIndex,
            actionType: params.actionType,
            targetDescription: params.targetDescription,
            coordinates: params.coordinates,
            timestamp,
            url: params.url,
            screenshotHash,
            domHash,
            previousFrameHash: previousHash,
        };
        const frameHash = computeFrameHash(base);
        const signature = this.signer.sign(Buffer.from(frameHash)).toString('base64');

        const frame: AuditFrame = { ...base, frameHash, signature, keyId: this.signer.keyId };

        session.frames.push(frame);
        session.latestHash = frameHash;

        return structuredClone(frame);
    }

    /**
     * Seals the session, verifies the chain integrity, and writes the audit report to disk.
     */
    public async sealSession(sessionId?: string): Promise<{ session: AuditSession; isValid: boolean; reportPath: string }> {
        const targetId = sessionId || this.activeSessionId;
        if (!targetId) throw new Error('No active audit session to seal.');

        const session = this.sessions.get(targetId);
        if (!session) throw new Error(`Audit session ${targetId} not found.`);

        if (session.status === 'SEALED') throw new Error(`Audit session ${targetId} is already sealed.`);
        session.status = 'SEALED';
        session.endTime = Date.now();
        session.frameCount = session.frames.length;
        session.sealSignature = this.signer.sign(Buffer.from(sealRecord(session, session.frames.length))).toString('base64');

        // Full verification (signatures, timestamps, descriptions, terminal hash, frame count)
        const verification = verifySession(session, this.publicKeyPem);
        const isValid = verification.valid;

        // Write report file to disk
        await fs.mkdir(this.auditDir, { recursive: true });
        const reportPath = path.join(this.auditDir, `${targetId}_audit_manifest.json`);
        await fs.writeFile(reportPath, JSON.stringify({ ...session, isValid, invalidReason: verification.reason }, null, 2));

        if (this.activeSessionId === targetId) {
            this.activeSessionId = null;
        }

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'BrowserAuditLedger',
            event: 'AUDIT_SESSION_SEALED',
            sessionId: targetId,
            frameCount: session.frames.length,
            isValid
        });

        return { session: structuredClone(session), isValid, reportPath };
    }

    /**
     * Gets session info.
     */
    public getSession(sessionId: string): AuditSession | undefined {
        const s = this.sessions.get(sessionId);
        return s ? structuredClone(s) : undefined; // copy: callers can never mutate the ledger
    }
}

export const browserAuditLedger = new BrowserAuditLedger();
