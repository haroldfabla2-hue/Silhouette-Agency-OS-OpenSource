// =============================================================================
// PASSWORD HASHING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
// Salted, slow password hashing using Node's built-in scrypt (no external deps).
// Replaces the previous unsalted SHA-256 hashing, while remaining backward
// compatible with legacy SHA-256 hashes so existing users can still log in (and
// are transparently upgraded on their next successful login).
//
// Stored format (new):  scrypt$<saltHex>$<hashHex>
// Legacy format:        <64-char hex>  (unsalted SHA-256)
// =============================================================================

import * as crypto from 'crypto';

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

/** Hash a plaintext password with a fresh random salt. */
export function hashPassword(plain: string): string {
    const salt = crypto.randomBytes(SALT_BYTES);
    const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
    return `${PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function timingSafeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
        return false;
    }
}

export interface VerifyResult {
    /** Whether the password matched. */
    valid: boolean;
    /** True when the stored hash uses the legacy format and should be re-hashed. */
    needsUpgrade: boolean;
}

/** Verify a plaintext password against a stored hash (scrypt or legacy SHA-256). */
export function verifyPassword(plain: string, stored: string | null | undefined): VerifyResult {
    if (!stored) return { valid: false, needsUpgrade: false };

    // New salted scrypt format
    if (stored.startsWith(`${PREFIX}$`)) {
        const [, saltHex, hashHex] = stored.split('$');
        if (!saltHex || !hashHex) return { valid: false, needsUpgrade: false };
        const derived = crypto.scryptSync(plain, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
        return { valid: timingSafeHexEqual(derived.toString('hex'), hashHex), needsUpgrade: false };
    }

    // Legacy unsalted SHA-256 (64 hex chars) — verify and flag for upgrade.
    if (/^[a-f0-9]{64}$/i.test(stored)) {
        const legacy = crypto.createHash('sha256').update(plain).digest('hex');
        return { valid: timingSafeHexEqual(legacy, stored.toLowerCase()), needsUpgrade: true };
    }

    return { valid: false, needsUpgrade: false };
}
