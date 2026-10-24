/**
 * [auth-connections] Connects account management to the real transport:
 * resolves the credential for a provider's ACTIVE account so
 * OpenAICompatibleClient can call the provider with it. secretRef forms:
 *   env:VAR_NAME     -> process.env[VAR_NAME] (existing route, zero storage)
 *   vault:<name>     -> TokenVault read (0600 enforced, expiry checked)
 * Anything else is rejected. Secret values are never logged here.
 */
import type { ProviderDefinition } from '../llm/providerRegistry';
import { AccountStore } from './accountStore';
import { TokenVault } from './tokenVault';

export interface ResolvedCredential {
    key: string;
    source: 'env' | 'vault';
    accountId: string;
}

export class CredentialResolver {
    constructor(private store: AccountStore, private vault: TokenVault, private env: NodeJS.ProcessEnv = process.env) {}

    /** Resolve the active account's credential; undefined = caller falls back to provider env var. */
    resolve(provider: ProviderDefinition): ResolvedCredential | undefined {
        const account = this.store.active(provider.id);
        if (!account) return undefined;
        const ref = account.secretRef;
        if (ref.startsWith('env:')) {
            const key = this.env[ref.slice(4)];
            if (!key) { this.store.setStatus(provider.id, account.accountId, 'error', 'env var not set'); return undefined; }
            return { key, source: 'env', accountId: account.accountId };
        }
        if (ref.startsWith('vault:')) {
            const token = this.vault.read(ref.slice(6));
            if (!token) { this.store.setStatus(provider.id, account.accountId, 'error', 'token missing'); return undefined; }
            if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) {
                this.store.setStatus(provider.id, account.accountId, 'expired', 'token expired');
                return undefined;
            }
            return { key: token.accessToken, source: 'vault', accountId: account.accountId };
        }
        this.store.setStatus(provider.id, account.accountId, 'error', 'unknown secretRef form');
        return undefined;
    }
}
