/**
 * [auth-connections] Operator-facing connection lifecycle.
 *
 * TWO DISTINCT OPERATIONS, kept honest:
 *
 * 1) ACCOUNT MANAGEMENT (start/list/switch/close): registers POINTERS to
 *    credentials that already exist (env var, vendor CLI home, token store
 *    entry). For 'command' accounts the VENDOR CLI owns its OAuth end to end:
 *    the operator runs the vendor's own official login once (per the route's
 *    officialSource doc) and Silhouette only references the result. Silhouette
 *    never initiates, drives or reuses a vendor CLI's OAuth.
 *
 * 2) OAUTH CONNECT (startOAuthConnect/completeOAuthConnect/cancelOAuthConnect):
 *    initiates a GENERIC RFC 6749+7636 loopback or RFC 8628 device-code login
 *    against an OAuth client registration the OPERATOR supplies (clientId +
 *    endpoints). The route catalog (officialRoutes) ships no vendor endpoints
 *    or client IDs: a real OAuth app registration per vendor is required and
 *    is the owner's to provide. Tokens land in the encrypted TokenFileStore
 *    (SILHOUETTE_TOKEN_KEY; fail-closed when unset) and the account is
 *    registered with a vault: pointer.
 *
 * closeConnection removes the registry row and best-effort purges the LOCAL
 * encrypted token copy. It does NOT revoke the vendor-side session or grant;
 * revocation requires the vendor's own flow. For 'command' accounts the
 * vendor CLI's login in its home dir persists untouched (vendor-managed).
 */
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AccountStore, type AuthMethod, type ProviderAccount } from './accountStore';
import { TokenFileStore } from './tokenFileStore';
import {
    buildAuthorizationUrl, exchangeAuthorizationCode, generatePkce, generateState,
    loopbackRedirectUri, startAuthorizationCodeWaiter, type AuthorizationCodeWaiter,
} from './oauthLoopback';
import { requestDeviceCode, pollDeviceToken } from './deviceCodeFlow';

export class ConnectionError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'ConnectionError'; }
}

const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const VALID_METHODS: AuthMethod[] = ['api-key', 'oauth-loopback', 'device-code', 'command', 'env'];
/** Pointer schemes the resolver knows how to honor. Anything else is rejected here, not at call time. */
const SECRET_REF_SCHEMES = ['env:', 'vault:', 'cli-home:']; // exact set honored by credentialResolver + cliTransport
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export interface StartConnectionInput {
    providerId: string;
    accountId: string;
    label: string;
    method: AuthMethod;
    secretRef: string;
}

export interface OAuthClientConfig {
    clientId: string;
    tokenUrl: string;
    authorizeUrl?: string;   // required for oauth-loopback
    deviceCodeUrl?: string;  // required for device-code
    scope?: string;
}

export interface PendingConnectInfo {
    pendingId: string;
    providerId: string;
    accountId: string;
    method: 'oauth-loopback' | 'device-code';
    authorizationUrl?: string;
    userCode?: string;
    verificationUri?: string;
    expiresInMs?: number;
}

interface PendingConnect {
    /** Principal (req.user.id) that initiated the connect; complete/cancel are bound to it. */
    principalId: string;
    info: PendingConnectInfo;
    label: string;
    config: OAuthClientConfig;
    abort: AbortController;
    waiter?: AuthorizationCodeWaiter;
    codePromise?: Promise<{ code: string; port: number }>;
    verifier?: string;
    redirectUri?: string;
    deviceCode?: string;
    intervalMs?: number;
}

function isPublicAddress(addr: string): boolean {
    const v = isIP(addr);
    if (v === 4) {
        const p = addr.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
        if (p[0] === 169 && p[1] === 254) return false;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
        if (p[0] === 192 && p[1] === 168) return false;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
        if (p[0] >= 224) return false; // multicast/reserved
        return true;
    }
    if (v === 6) {
        const a = addr.toLowerCase();
        if (a === '::1' || a === '::') return false;
        if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return false;
        if (a.startsWith('::ffff:')) { const m = a.slice(7); return isIP(m) === 4 ? isPublicAddress(m) : false; }
        return true;
    }
    return false;
}

/**
 * Endpoint policy (SSRF guard for operator-supplied OAuth endpoints):
 * - scheme https; http only toward a loopback host (declared test/dev use);
 * - unless allowPrivateEndpoints (declared test mode), the host must not BE
 *   a private/special IP literal nor RESOLVE to one (DNS checked at start);
 * - redirects are refused by every fetcher downstream (redirect: 'error').
 * Declared residual limit: DNS re-binding between this check and the actual
 * request (TOCTOU) is not pinned.
 */
async function assertEndpointAllowed(endpoint: string, field: string, allowPrivate: boolean): Promise<void> {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new ConnectionError('invalid-endpoint', `${field} is not a URL`); }
    const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !isLoopbackHttp) {
        throw new ConnectionError('insecure-endpoint', `${field} must be https (http only for loopback test endpoints)`);
    }
    if (allowPrivate) return;
    if (isIP(url.hostname)) {
        if (!isPublicAddress(url.hostname)) throw new ConnectionError('private-endpoint', `${field} points at a non-public address`);
        return;
    }
    let addresses: { address: string }[];
    try { addresses = await lookup(url.hostname, { all: true }); } catch { throw new ConnectionError('unresolvable-endpoint', `${field} host does not resolve`); }
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
        throw new ConnectionError('private-endpoint', `${field} resolves to a non-public address`);
    }
}

export class ConnectionManager {
    private pending = new Map<string, PendingConnect>();

    constructor(
        private readonly store: AccountStore,
        private readonly tokens?: TokenFileStore,
        private readonly options: { allowPrivateEndpoints?: boolean } = {},
    ) {}

    // ── 1) Account management (pointers to pre-configured credentials) ──────

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

    /**
     * Close = remove the registry row + purge OUR local encrypted token copy
     * when the account points at the token store. NOT a vendor-side
     * revocation; the vendor grant/session stays valid at the provider.
     */
    closeConnection(providerId: string, accountId: string): { account: ProviderAccount; localTokenPurged: boolean } {
        const account = this.store.list().find(a => a.providerId === providerId && a.accountId === accountId);
        if (!account) throw new ConnectionError('not-found', `no account ${accountId} for ${providerId}`);
        let localTokenPurged = false;
        if (account.secretRef.startsWith('vault:') && this.tokens) {
            try { localTokenPurged = this.tokens.remove(account.secretRef.slice('vault:'.length)); } catch { localTokenPurged = false; }
        }
        this.store.remove(providerId, accountId);
        return { account, localTokenPurged };
    }

    // ── 2) OAuth connect (operator-supplied client registration) ────────────

    async startOAuthConnect(input: {
        providerId: string; accountId: string; label: string;
        method: 'oauth-loopback' | 'device-code'; config: OAuthClientConfig;
    }, principalId: string): Promise<PendingConnectInfo> {
        if (!principalId?.trim()) throw new ConnectionError('invalid-principal', 'initiating principal is required');
        if (!this.tokens) {
            throw new ConnectionError('token-store-unavailable', 'SILHOUETTE_TOKEN_KEY not configured: OAuth token custody unavailable; refusing to start a login whose tokens have nowhere safe to land');
        }
        if (!ACCOUNT_ID.test(input.accountId || '')) throw new ConnectionError('invalid-account-id', 'bad accountId');
        if (!input.config?.clientId?.trim()) throw new ConnectionError('invalid-config', 'config.clientId (operator-registered OAuth app) is required');
        const allowPrivate = this.options.allowPrivateEndpoints === true;
        await assertEndpointAllowed(input.config.tokenUrl, 'config.tokenUrl', allowPrivate);
        if (this.store.list().some(a => a.providerId === input.providerId && a.accountId === input.accountId)) {
            throw new ConnectionError('duplicate', `account ${input.accountId} already exists for ${input.providerId}`);
        }

        const pendingId = randomBytes(12).toString('hex');
        const abort = new AbortController();
        const base: PendingConnectInfo = { pendingId, providerId: input.providerId, accountId: input.accountId, method: input.method };
        const entry: PendingConnect = { principalId, info: base, label: input.label || input.accountId, config: input.config, abort };

        if (input.method === 'oauth-loopback') {
            if (!input.config.authorizeUrl) throw new ConnectionError('invalid-config', 'config.authorizeUrl required for oauth-loopback');
            await assertEndpointAllowed(input.config.authorizeUrl, 'config.authorizeUrl', allowPrivate);
            const state = generateState();
            const pkce = generatePkce();
            const waiter = await startAuthorizationCodeWaiter({ state, signal: abort.signal });
            const redirectUri = loopbackRedirectUri(waiter.port);
            entry.waiter = waiter;
            entry.verifier = pkce.verifier;
            entry.redirectUri = redirectUri;
            entry.codePromise = waiter.waitForCode;
            entry.codePromise.catch(() => { /* settles via complete/cancel/timeout; never unhandled */ });
            base.authorizationUrl = buildAuthorizationUrl(input.config.authorizeUrl, {
                clientId: input.config.clientId, redirectUri, state, codeChallenge: pkce.challenge,
                ...(input.config.scope ? { scope: input.config.scope } : {}),
            });
        } else {
            if (!input.config.deviceCodeUrl) throw new ConnectionError('invalid-config', 'config.deviceCodeUrl required for device-code');
            await assertEndpointAllowed(input.config.deviceCodeUrl, 'config.deviceCodeUrl', allowPrivate);
            const dc = await requestDeviceCode(input.config.deviceCodeUrl, input.config.clientId, input.config.scope);
            entry.deviceCode = dc.deviceCode;
            entry.intervalMs = dc.intervalMs;
            base.userCode = dc.userCode;
            base.verificationUri = dc.verificationUri;
            base.expiresInMs = dc.expiresInMs;
        }

        this.pending.set(pendingId, entry);
        return base;
    }

    /**
     * Finish a pending connect: awaits the loopback callback or polls the
     * device grant to completion, stores the tokens in the encrypted store
     * and registers the account with its vault: pointer.
     */
    async completeOAuthConnect(pendingId: string, principalId: string): Promise<ProviderAccount> {
        const entry = this.pending.get(pendingId);
        if (!entry) throw new ConnectionError('not-found', `no pending connection ${pendingId}`);
        if (entry.principalId !== principalId) {
            throw new ConnectionError('forbidden-principal', 'pending connection belongs to a different principal');
        }
        try {
            let token: { accessToken: string; refreshToken?: string; expiresInSec?: number; scope?: string };
            if (entry.info.method === 'oauth-loopback') {
                const { code } = await entry.codePromise!;
                token = await exchangeAuthorizationCode(entry.config.tokenUrl, {
                    clientId: entry.config.clientId, code, redirectUri: entry.redirectUri!, codeVerifier: entry.verifier!,
                });
            } else {
                const result = await pollDeviceToken(entry.config.tokenUrl, entry.config.clientId, entry.deviceCode!, {
                    intervalMs: entry.intervalMs ?? 5000, timeoutMs: entry.info.expiresInMs ?? 900_000, signal: entry.abort.signal,
                });
                token = {
                    accessToken: result.accessToken,
                    ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
                    ...(result.expiresInSec ? { expiresInSec: result.expiresInSec } : {}),
                    ...(result.scopes ? { scope: result.scopes.join(' ') } : {}),
                };
            }
            const tokenName = `oauth-${entry.info.providerId.toLowerCase()}-${entry.info.accountId}`;
            this.tokens!.write(tokenName, {
                accessToken: token.accessToken,
                ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
                ...(token.expiresInSec ? { expiresAt: new Date(Date.now() + token.expiresInSec * 1000).toISOString() } : {}),
                ...(token.scope ? { scopes: token.scope.split(' ') } : {}),
                obtainedAt: new Date().toISOString(),
            });
            const account = this.startConnection({
                providerId: entry.info.providerId, accountId: entry.info.accountId,
                label: entry.label, method: entry.info.method, secretRef: `vault:${tokenName}`,
            });
            return account;
        } finally {
            entry.abort.abort();
            this.pending.delete(pendingId);
        }
    }

    /** Cancel a pending connect: aborts the waiter/poll. Vendor side was never touched beyond the initial code request. */
    cancelOAuthConnect(pendingId: string, principalId: string): void {
        const entry = this.pending.get(pendingId);
        if (!entry) throw new ConnectionError('not-found', `no pending connection ${pendingId}`);
        if (entry.principalId !== principalId) {
            throw new ConnectionError('forbidden-principal', 'pending connection belongs to a different principal');
        }
        entry.abort.abort();
        this.pending.delete(pendingId);
    }
}
