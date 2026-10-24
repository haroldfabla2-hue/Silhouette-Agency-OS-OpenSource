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
    if (url.protocol !== 'https:') throw new Error('authorization endpoint must be https');
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
    const path = options.path ?? '/callback';
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    let server!: Server;
    let boundPort = 0;
    const waitForCode = new Promise<{ code: string; port: number }>((resolve, reject) => {
        let settled = false;
        const done = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            server.close();
            fn();
        };
        server = createServer((req, res) => {
            try {
                const url = new URL(req.url || '/', 'http://127.0.0.1');
                if (url.pathname !== path) { res.writeHead(404).end('not found'); return; }
                const state = url.searchParams.get('state');
                const code = url.searchParams.get('code');
                const error = url.searchParams.get('error');
                if (error) { res.writeHead(200).end('Authorization failed; you can close this tab.'); done(() => reject(new OAuthCallbackError(`provider returned error: ${error}`))); return; }
                if (!state || state !== options.state) { res.writeHead(400).end('Invalid state.'); done(() => reject(new OAuthCallbackError('state mismatch'))); return; }
                if (!code) { res.writeHead(400).end('Missing code.'); return; }
                res.writeHead(200).end('Authorization received; you can close this tab.');
                done(() => resolve({ code, port: boundPort }));
            } catch (err) { done(() => reject(err)); }
        });
        const timer = setTimeout(() => done(() => reject(new OAuthCallbackError('callback timeout'))), timeoutMs);
        const onAbort = () => done(() => reject(new OAuthCallbackError('login cancelled')));
        options.signal?.addEventListener('abort', onAbort, { once: true });
        server.on('error', (err) => done(() => reject(err)));
    });
    await new Promise<void>((res, rej) => {
        server.once('error', rej);
        server.listen(options.port ?? 0, '127.0.0.1', res);
    });
    boundPort = (server.address() as any).port;
    if (options.signal?.aborted) { server.close(); throw new OAuthCallbackError('login cancelled'); }
    return { port: boundPort, waitForCode };
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
    return waiter.waitForCode;
}

export function loopbackRedirectUri(port: number, path = '/callback'): string {
    return `http://127.0.0.1:${port}${path}`;
}
