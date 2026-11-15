/**
 * [auth-connections] Token custody with controlled permissions, redaction
 * and a declared backup story - the conditions Main set for any Silhouette
 * token file. Files: 0600, dir 0700, atomic replace (tmp+rename). Reads for
 * display go through redact(). Backup: the vault dir is excluded from file
 * backups by name (data/auth-vault/); restoring tokens is a re-login, not a
 * file restore. This is a custody format, not an authorization to log in.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HeldRefreshLock } from './refreshLock';
import { assertFence } from './refreshLock';

export interface StoredToken {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string; // ISO
    scopes?: string[];
    obtainedAt: string;
}

export const VAULT_DIR_NAME = 'auth-vault';

export class TokenVault {
    readonly dir: string;
    constructor(baseDir: string) {
        this.dir = join(baseDir, VAULT_DIR_NAME);
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        chmodSync(this.dir, 0o700);
    }

    private path(name: string): string {
        if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) throw new Error('Invalid token name');
        return join(this.dir, `${name}.token.json`);
    }

    /** Write guarded by the refresh fence when one is held (refresh path). */
    write(name: string, token: StoredToken, held?: HeldRefreshLock): void {
        if (held) assertFence(held);
        if (!token.accessToken) throw new Error('accessToken required');
        const target = this.path(name);
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, JSON.stringify(token), { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, target);
    }

    read(name: string): StoredToken | undefined {
        try {
            const p = this.path(name);
            const mode = statSync(p).mode & 0o777;
            if (mode !== 0o600) throw new Error(`token file permissions must be 600, found ${mode.toString(8)}`);
            const parsed = JSON.parse(readFileSync(p, 'utf8'));
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
