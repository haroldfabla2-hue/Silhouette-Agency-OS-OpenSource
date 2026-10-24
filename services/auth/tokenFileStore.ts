/**
 * [auth-connections] Encrypted token file store. This is NOT a vault and is
 * not named as one: it is a 0600-file custody format with AES-256-GCM at
 * rest, keyed by SILHOUETTE_TOKEN_KEY (64 hex chars, same protection domain
 * as the existing .env API keys). Declared limits: the key lives in the
 * process environment (an OS-level read of the process or its env file
 * defeats it); there is no HSM/KMS; the store dir is excluded from file
 * backups by name - restoring tokens means re-login, not file restore.
 * Writes fail closed without a key: tokens are never written in plaintext.
 * Refresh-time writes must pass the refresh lock fence (assertFence) so a
 * stale holder's late write is rejected before it lands.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { HeldRefreshLock } from './refreshLock';
import { assertFence } from './refreshLock';

export interface StoredToken {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string; // ISO
    scopes?: string[];
    obtainedAt: string;
}

export const TOKEN_STORE_DIR_NAME = 'auth-tokens';
export const TOKEN_KEY_ENV = 'SILHOUETTE_TOKEN_KEY';

export class TokenKeyMissing extends Error {
    constructor() { super(`${TOKEN_KEY_ENV} not set: refusing to read or write tokens without the encryption key`); }
}

export class TokenFileStore {
    readonly dir: string;
    private key: Buffer;
    constructor(baseDir: string, env: NodeJS.ProcessEnv = process.env) {
        this.dir = join(baseDir, TOKEN_STORE_DIR_NAME);
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        chmodSync(this.dir, 0o700);
        const hex = (env[TOKEN_KEY_ENV] || '').trim();
        if (!/^[0-9a-f]{64}$/i.test(hex)) throw new TokenKeyMissing();
        this.key = Buffer.from(hex, 'hex');
    }

    static isAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^[0-9a-f]{64}$/i.test((env[TOKEN_KEY_ENV] || '').trim());
    }

    private path(name: string): string {
        if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) throw new Error('Invalid token name');
        return join(this.dir, `${name}.token.json`);
    }

    private encrypt(plain: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    }

    private decrypt(payload: string): string {
        const parsed = JSON.parse(payload);
        if (parsed?.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) throw new Error('corrupt token payload');
        const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(parsed.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8');
    }

    /** Write guarded by the refresh fence when one is held (refresh path). */
    write(name: string, token: StoredToken, held?: HeldRefreshLock): void {
        if (held) assertFence(held);
        if (!token.accessToken) throw new Error('accessToken required');
        const target = this.path(name);
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, this.encrypt(JSON.stringify(token)), { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, target);
    }

    read(name: string): StoredToken | undefined {
        try {
            const p = this.path(name);
            const mode = statSync(p).mode & 0o777;
            if (mode !== 0o600) throw new Error(`token file permissions must be 600, found ${mode.toString(8)}`);
            const parsed = JSON.parse(this.decrypt(readFileSync(p, 'utf8')));
            if (typeof parsed?.accessToken !== 'string') throw new Error('corrupt token file');
            return parsed as StoredToken;
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw err;
        }
    }

    /** Display-safe view: never returns secret material. */
    redacted(name: string): { present: boolean; expiresAt?: string; scopes?: string[]; accessToken: string } {
        const t = this.read(name);
        if (!t) return { present: false, accessToken: '<none>' };
        return {
            present: true,
            ...(t.expiresAt ? { expiresAt: t.expiresAt } : {}),
            ...(t.scopes ? { scopes: t.scopes } : {}),
            accessToken: `<redacted:${t.accessToken.length} chars>`,
        };
    }
}

/** Never log raw token values; use this anywhere a token might appear in output. */
export function redactSecret(value: string): string {
    return `<redacted:${value.length} chars>`;
}
