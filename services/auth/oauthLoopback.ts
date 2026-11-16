/**
 * [auth-connections] Generic OAuth authorization-code flow over a loopback
 * callback, the standard pattern OpenClaw implements in
 * src/llm/utils/oauth/anthropic.ts (MIT, commit d25ac78): PKCE S256, state,
 * localhost-only bind, bounded wait, abortable. Implementation is our own;
 * no vendor client IDs here - client registration comes from officialRoutes
 * config once the owner chooses a provider and plan. E2E login is PENDING
 * owner authorization; this module is the transport mechanism only.
 */
import { createServer, type Server } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

export interface PkcePair { verifier: string; challenge: string; }

export function generatePkce(): PkcePair {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

export function generateState(): string {
    return randomBytes(16).toString('base64url');
}

export function buildAuthorizationUrl(base: string, params: {
    clientId: string; redirectUri: string; state: string; codeChallenge: string; scope?: string;
}): string {
    const url = new URL(base);
    if (!isHttpsOrLoopback(url)) throw new Error('authorization endpoint must be https (http only for loopback test endpoints)');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (params.scope) url.searchParams.set('scope', params.scope);
    return url.toString();
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

export class OAuthCallbackError extends Error {}

/**
 * Listen on a loopback-only address for the OAuth redirect. Returns the
 * authorization code after state validation. Always closes its server.
 */
export interface AuthorizationCodeWaiter {
    port: number;
    waitForCode: Promise<{ code: string; port: number }>;
    closed: Promise<void>;
    close(): Promise<void>;
}

/**
 * Start the loopback listener and resolve ONLY once the socket is bound, so
 * no redirect can race the listen. `waitForCode` settles on the callback.
 */
export async function startAuthorizationCodeWaiter(options: {
    port?: number;
    path?: string;
    state: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<AuthorizationCodeWaiter> {
    if (options.signal?.aborted) throw new OAuthCallbackError('login cancelled');
    const path = options.path ?? '/callback';
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    let port = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveCode!: (value: { code: string; port: number }) => void;
    let rejectCode!: (error: unknown) => void;
    const waitForCode = new Promise<{ code: string; port: number }>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
    // Attach immediately: cancellation can precede the caller receiving the waiter.
    void waitForCode.catch(() => undefined);
    let resolveClosed!: () => void;
    let rejectClosed!: (error: unknown) => void;
    const closed = new Promise<void>((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
    void closed.catch(() => undefined);
    let closeStarted = false;
    let bound!: Promise<void>;
    const closeServer = () => {
        if (closeStarted) return closed;
        closeStarted = true;
        void bound.then(() => {
            server.close(error => { if (error) rejectClosed(error); else resolveClosed(); });
            server.closeIdleConnections();
        }, () => resolveClosed());
        return closed;
    };
    const finish = (error?: unknown, code?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) rejectCode(error); else resolveCode({ code: code!, port });
        void closeServer();
    };
    const onAbort = () => finish(new OAuthCallbackError('login cancelled'));
    const server = createServer((req, res) => {
        try {
            const url = new URL(req.url || '/', 'http://127.0.0.1');
            if (url.pathname !== path) { res.writeHead(404).end('not found'); return; }
            const state = url.searchParams.get('state');
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            if (error) { res.writeHead(200).end('Authorization failed; you can close this tab.'); finish(new OAuthCallbackError(`provider returned error: ${error}`)); return; }
            if (!state || state !== options.state) { res.writeHead(400).end('Invalid state.'); finish(new OAuthCallbackError('state mismatch')); return; }
            if (!code) { res.writeHead(400).end('Missing code.'); return; }
            res.writeHead(200).end('Authorization received; you can close this tab.');
            finish(undefined, code);
        } catch (error) { finish(error); }
    });
    bound = new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', error => finish(error));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try { await bound; }
    catch (error) { finish(error); await closed; throw error; }
    port = (server.address() as import('node:net').AddressInfo).port;
    if (options.signal?.aborted || settled) { finish(new OAuthCallbackError('login cancelled')); await closeServer(); throw new OAuthCallbackError('login cancelled'); }
    timer = setTimeout(() => finish(new OAuthCallbackError('callback timeout')), timeoutMs);
    return { port, waitForCode, closed, close: () => { finish(new OAuthCallbackError('login cancelled')); return closeServer(); } };
}

/** Convenience: start the waiter and await the callback in one call. */
export async function waitForAuthorizationCode(options: {
    port?: number;
    path?: string;
    state: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<{ code: string; port: number }> {
    const waiter = await startAuthorizationCodeWaiter(options);
    try { return await waiter.waitForCode; } finally { await waiter.closed; }
}

/** https everywhere; http only toward a loopback host (local test/dev authorization servers). */
function isHttpsOrLoopback(url: URL): boolean {
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
}

export interface TokenExchangeResult {
    accessToken: string;
    refreshToken?: string;
    expiresInSec?: number;
    scope?: string;
}

/**
 * RFC 6749 4.1.3 + RFC 7636 verifier: swap the loopback code for tokens at
 * the provider's token endpoint. Same endpoint policy as the authorize URL.
 */
export async function exchangeAuthorizationCode(
    tokenUrl: string,
    params: { clientId: string; code: string; redirectUri: string; codeVerifier: string },
    fetcher: typeof fetch = fetch,
): Promise<TokenExchangeResult> {
    const url = new URL(tokenUrl);
    if (!isHttpsOrLoopback(url)) throw new OAuthCallbackError('token endpoint must be https (http only for loopback test endpoints)');
    const res = await fetcher(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: params.clientId,
            code: params.code,
            redirect_uri: params.redirectUri,
            code_verifier: params.codeVerifier,
        }),
        redirect: 'error',
    });
    if (!res.ok) { await res.body?.cancel(); throw new OAuthCallbackError(`token exchange failed: HTTP ${res.status}`); }
    const data: any = await res.json();
    if (typeof data?.access_token !== 'string' || !data.access_token) throw new OAuthCallbackError('invalid token response: missing access_token');
    return {
        accessToken: data.access_token,
        ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
        ...(Number.isFinite(Number(data.expires_in)) ? { expiresInSec: Number(data.expires_in) } : {}),
        ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
    };
}

export function loopbackRedirectUri(port: number, path = '/callback'): string {
    return `http://127.0.0.1:${port}${path}`;
}
