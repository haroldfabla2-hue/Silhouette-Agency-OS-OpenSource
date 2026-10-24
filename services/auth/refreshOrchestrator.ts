/**
 * [auth-connections] Refresh orchestration: the fencing is applied to the
 * REAL final write, not a test helper. Flow: acquire the cross-process lock
 * (new fence) -> re-read the token (another process may have refreshed while
 * we waited) -> call the route's refresh (real HTTP to the vendor endpoint)
 * -> write through assertFence inside the lock -> mark the account active.
 * A stale holder reaches tokens.write() with an old fence and is rejected.
 * Vendor OAuth login/refresh endpoints remain PENDING owner authorization.
 */
import type { AccountStore } from './accountStore';
import type { TokenFileStore, StoredToken } from './tokenFileStore';
import { withRefreshLock } from './refreshLock';

export type RefreshFn = (current: StoredToken | undefined) => Promise<StoredToken>;

/** Real OAuth refresh_token grant against the vendor endpoint (RFC 6749 §6). */
export function refreshWithTokenEndpoint(
    tokenUrl: string, clientId: string, fetcher: typeof fetch = fetch,
): RefreshFn {
    return async (current) => {
        if (!current?.refreshToken) throw new Error('no refresh token: re-login required');
        const res = await fetcher(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: current.refreshToken }),
            redirect: 'error',
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}${data?.error ? ` ${data.error}` : ''}`);
        if (typeof data?.access_token !== 'string') throw new Error('invalid refresh response');
        return {
            accessToken: data.access_token,
            refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : current.refreshToken,
            ...(Number.isFinite(data.expires_in) ? { expiresAt: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() } : {}),
            obtainedAt: new Date().toISOString(),
        };
    };
}

const REFRESH_SKEW_MS = 30_000;

/**
 * Refresh one account's vault token under the fenced lock. Returns the
 * token now in force (fresh or already-refreshed by another process).
 */
export async function refreshAccountToken(
    store: AccountStore,
    tokens: TokenFileStore,
    lockDir: string,
    providerId: string,
    accountId: string,
    refreshFn: RefreshFn,
): Promise<StoredToken> {
    const account = store.list(providerId).find(a => a.accountId === accountId);
    if (!account) throw new Error(`No account ${accountId} for ${providerId}`);
    if (!account.secretRef.startsWith('vault:')) throw new Error('refresh applies to vault-backed accounts');
    const name = account.secretRef.slice(6);
    return withRefreshLock(lockDir, `${providerId}-${accountId}`, async (held) => {
        const current = tokens.read(name);
        if (current?.expiresAt && Date.parse(current.expiresAt) - REFRESH_SKEW_MS > Date.now()) {
            return current; // another process refreshed while we waited for the lock
        }
        const next = await refreshFn(current);
        tokens.write(name, next, held); // the fenced REAL final write
        store.setStatus(providerId, accountId, 'active');
        return next;
    });
}
