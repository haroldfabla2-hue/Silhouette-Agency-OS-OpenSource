/**
 * [auth-connections] Operator-facing connection lifecycle: start / list /
 * switch / close a provider connection. This is the service layer behind the
 * /v1/connections routes (server/routes/connections.ts); HTTP requests reach
 * it only through the global authMiddleware (Bearer SILHOUETTE_API_KEY), which
 * is the operator-auth convention in server/app.ts. The manager adds the
 * validation the raw AccountStore does not enforce: secretRef scheme
 * allowlist, accountId shape, and honest status reporting.
 */
import { AccountStore, type AuthMethod, type ProviderAccount } from './accountStore';

export class ConnectionError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'ConnectionError'; }
}

const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const VALID_METHODS: AuthMethod[] = ['api-key', 'oauth-loopback', 'device-code', 'command', 'env'];
/** Pointer schemes the resolver knows how to honor. Anything else is rejected here, not at call time. */
const SECRET_REF_SCHEMES = ['env:', 'vault:', 'cli-home:']; // exact set honored by credentialResolver + cliTransport

export interface StartConnectionInput {
    providerId: string;
    accountId: string;
    label: string;
    method: AuthMethod;
    secretRef: string;
}

export class ConnectionManager {
    constructor(private readonly store: AccountStore) {}

    startConnection(input: StartConnectionInput): ProviderAccount {
        if (!input.providerId?.trim()) throw new ConnectionError('invalid-provider', 'providerId is required');
        if (!ACCOUNT_ID.test(input.accountId || '')) {
            throw new ConnectionError('invalid-account-id', 'accountId must be 1-64 chars of [a-z0-9._-], starting alphanumeric');
        }
        if (!VALID_METHODS.includes(input.method)) {
            throw new ConnectionError('invalid-method', `method must be one of ${VALID_METHODS.join(', ')}`);
        }
        if (!SECRET_REF_SCHEMES.some(s => (input.secretRef || '').startsWith(s))) {
            throw new ConnectionError('invalid-secret-ref', `secretRef must start with one of ${SECRET_REF_SCHEMES.join(', ')}`);
        }
        if (this.store.list().some(a => a.providerId === input.providerId && a.accountId === input.accountId)) {
            throw new ConnectionError('duplicate', `account ${input.accountId} already exists for ${input.providerId}`);
        }
        this.store.add({
            providerId: input.providerId, accountId: input.accountId,
            label: input.label || input.accountId, method: input.method, secretRef: input.secretRef,
        });
        return this.store.list().find(a => a.providerId === input.providerId && a.accountId === input.accountId)!;
    }

    listConnections(providerId?: string): ProviderAccount[] {
        const all = this.store.list();
        return providerId ? all.filter(a => a.providerId === providerId) : all;
    }

    switchConnection(providerId: string, accountId: string): ProviderAccount {
        const account = this.store.list().find(a => a.providerId === providerId && a.accountId === accountId);
        if (!account) throw new ConnectionError('not-found', `no account ${accountId} for ${providerId}`);
        this.store.activate(providerId, accountId);
        return account;
    }

    closeConnection(providerId: string, accountId: string): void {
        if (!this.store.remove(providerId, accountId)) {
            throw new ConnectionError('not-found', `no account ${accountId} for ${providerId}`);
        }
    }
}
