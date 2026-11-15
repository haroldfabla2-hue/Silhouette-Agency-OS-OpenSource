import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { generatePkce, generateState, buildAuthorizationUrl, waitForAuthorizationCode, startAuthorizationCodeWaiter, OAuthCallbackError, loopbackRedirectUri } from '../../../services/auth/oauthLoopback';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
    });
}

describe('oauthLoopback', () => {
    it('generates S256 PKCE and state', () => {
        const { verifier, challenge } = generatePkce();
        expect(verifier).not.toBe(challenge);
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(generateState()).not.toBe(generateState());
    });
    it('builds authorization URLs with https and required params only', () => {
        const url = buildAuthorizationUrl('https://provider.example/authorize', {
            clientId: 'client-1', redirectUri: 'http://127.0.0.1:9999/callback', state: 'st', codeChallenge: 'cc', scope: 'a b',
        });
        const u = new URL(url);
        expect(u.searchParams.get('response_type')).toBe('code');
        expect(u.searchParams.get('code_challenge_method')).toBe('S256');
        expect(u.searchParams.get('scope')).toBe('a b');
        expect(() => buildAuthorizationUrl('http://provider.example/a', { clientId: 'x', redirectUri: 'y', state: 's', codeChallenge: 'c' })).toThrow(/https/);
    });
    it('receives the code on loopback after state validation', async () => {
        const port = await freePort();
        const state = generateState();
        const waiter = await startAuthorizationCodeWaiter({ port, state, timeoutMs: 5000 });
        const assertion = expect(waiter.waitForCode).resolves.toEqual({ code: 'auth-code-1', port });
        const res = await fetch(`http://127.0.0.1:${waiter.port}/callback?code=auth-code-1&state=${state}`);
        expect(res.status).toBe(200);
        await assertion;
    });
    it('rejects a state mismatch (CSRF guard)', async () => {
        const port = await freePort();
        const waiter = await startAuthorizationCodeWaiter({ port, state: 'right', timeoutMs: 5000 });
        const assertion = expect(waiter.waitForCode).rejects.toThrow(/state mismatch/);
        await fetch(`http://127.0.0.1:${waiter.port}/callback?code=x&state=wrong`);
        await assertion;
    });
    it('surfaces provider errors and timeouts', async () => {
        const port = await freePort();
        const waiter = await startAuthorizationCodeWaiter({ port, state: 's', timeoutMs: 5000 });
        const assertion = expect(waiter.waitForCode).rejects.toBeInstanceOf(OAuthCallbackError);
        await fetch(`http://127.0.0.1:${waiter.port}/callback?error=access_denied&state=s`);
        await assertion;
        const port2 = await freePort();
        await expect(waitForAuthorizationCode({ port: port2, state: 's', timeoutMs: 50 })).rejects.toThrow(/timeout/);
    });
    it('redirect URI is loopback-only', () => {
        expect(loopbackRedirectUri(1234)).toBe('http://127.0.0.1:1234/callback');
    });
});
