/**
 * [auth-connections] Multi-account registry per provider (pattern verified
 * in OpenCode docs: saved accounts with one active, switchable by label).
 * Stores METADATA ONLY - never token material. Secrets stay in the env var
 * or file the account's secretRef names; this store never reads or logs them.
 * SQLite via better-sqlite3, matching services/database conventions.
 */
import Database from 'better-sqlite3';

export type AuthMethod = 'api-key' | 'oauth-loopback' | 'device-code' | 'command' | 'env';
export type AccountStatus = 'pending' | 'active' | 'expired' | 'error' | 'revoked';

export interface ProviderAccount {
    providerId: string;
    accountId: string;
    label: string;
    method: AuthMethod;
    status: AccountStatus;
    /** Where the secret lives, e.g. "env:OPENAI_API_KEY" or "file:tokens/codex-work.json". Never the secret itself. */
    secretRef: string;
    createdAt: string;
    updatedAt: string;
    lastError?: string;
}

export class AccountStore {
    private db: Database.Database;
    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`CREATE TABLE IF NOT EXISTS provider_accounts (
            provider_id TEXT NOT NULL,
            account_id TEXT NOT NULL,
            label TEXT NOT NULL,
            method TEXT NOT NULL,
            status TEXT NOT NULL,
            secret_ref TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_error TEXT,
            PRIMARY KEY (provider_id, account_id)
        )`);
    }

    add(input: Omit<ProviderAccount, 'createdAt' | 'updatedAt' | 'status'> & { status?: AccountStatus }): ProviderAccount {
        if (!/^[A-Z][A-Z0-9_-]*$/.test(input.providerId)) throw new Error('Invalid provider id');
        if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(input.accountId)) throw new Error('Invalid account id');
        if (!input.secretRef || /^(sk-|AIza|ghp_|xox|eyJ)/.test(input.secretRef)) {
            throw new Error('secretRef must name where the secret lives, never contain it');
        }
        const now = new Date().toISOString();
        const account: ProviderAccount = { ...input, status: input.status ?? 'pending', createdAt: now, updatedAt: now };
        this.db.prepare(`INSERT INTO provider_accounts
            (provider_id, account_id, label, method, status, secret_ref, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(account.providerId, account.accountId, account.label, account.method,
                account.status, account.secretRef, account.createdAt, account.updatedAt);
        return account;
    }

    /** Newest account becomes active unless one is explicitly switched. */
    activate(providerId: string, accountId: string): void {
        const tx = this.db.transaction(() => {
            const found = this.db.prepare('SELECT 1 FROM provider_accounts WHERE provider_id=? AND account_id=?')
                .get(providerId, accountId);
            if (!found) throw new Error(`No account ${accountId} for ${providerId}`);
            this.db.prepare('UPDATE provider_accounts SET active=0 WHERE provider_id=?').run(providerId);
            this.db.prepare(`UPDATE provider_accounts SET active=1, status='active', updated_at=? WHERE provider_id=? AND account_id=?`)
                .run(new Date().toISOString(), providerId, accountId);
        });
        tx();
    }

    active(providerId: string): ProviderAccount | undefined {
        const row = this.db.prepare('SELECT * FROM provider_accounts WHERE provider_id=? AND active=1').get(providerId) as any;
        return row ? this.toAccount(row) : undefined;
    }

    list(providerId?: string): ProviderAccount[] {
        const rows = (providerId
            ? this.db.prepare('SELECT * FROM provider_accounts WHERE provider_id=? ORDER BY created_at DESC').all(providerId)
            : this.db.prepare('SELECT * FROM provider_accounts ORDER BY provider_id, created_at DESC').all()) as any[];
        return rows.map(r => this.toAccount(r));
    }

    setStatus(providerId: string, accountId: string, status: AccountStatus, lastError?: string): void {
        this.db.prepare('UPDATE provider_accounts SET status=?, last_error=?, updated_at=? WHERE provider_id=? AND account_id=?')
            .run(status, lastError ?? null, new Date().toISOString(), providerId, accountId);
    }

    remove(providerId: string, accountId: string): boolean {
        return this.db.prepare('DELETE FROM provider_accounts WHERE provider_id=? AND account_id=?')
            .run(providerId, accountId).changes > 0;
    }

    close(): void { this.db.close(); }

    private toAccount(row: any): ProviderAccount {
        return {
            providerId: row.provider_id, accountId: row.account_id, label: row.label,
            method: row.method, status: row.status, secretRef: row.secret_ref,
            createdAt: row.created_at, updatedAt: row.updated_at,
            ...(row.last_error ? { lastError: row.last_error } : {}),
        };
    }
}
