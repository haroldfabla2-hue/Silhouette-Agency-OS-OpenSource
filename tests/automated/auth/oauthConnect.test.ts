/**
 * OAuth CONNECT mechanics against a DECLARED DOUBLE authorization server
 * (plain http on 127.0.0.1 - the https-or-loopback policy admits loopback
 * http for exactly this). Proves the generic RFC 6749+7636 loopback flow,
 * the RFC 8628 device-code flow, cancellation and close-time local token
 * purge. It is NOT a vendor login: no vendor endpoints, client IDs or
 * accounts are involved - those remain pending the owner's OAuth app
 * registration and per-connection authorization.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AccountStore } from '../../../services/auth/accountStore';
import { TokenFileStore } from '../../../services/auth/tokenFileStore';
import { ConnectionManager, ConnectionError } from '../../../services/auth/connectionManager';

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
    while (servers.length) await new Promise<void>(r => servers.pop()!.close(() => r()));
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const TEST_KEY = 'a'.repeat(64);

/** Declared-double authorization server: loopback /authorize + /token + /device/code + /device/token. */
async function startDoubleAS() {
    const state = { deviceApproved: false, lastTokenBody: '' };
    const server = createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname === '/authorize' && req.method === 'GET') {
            const redirect = url.searchParams.get('redirect_uri')!;
            const sep = redirect.includes('?') ? '&' : '?';
            res.writeHead(302, { location: `${redirect}${sep}code=double-code-1&state=${url.searchParams.get('state')}` });
            res.end();
            return;
        }
        if ((url.pathname === '/token' || url.pathname === '/device/code' || url.pathname === '/device/token') && req.method === 'POST') {
            let body = '';
            req.on('data', c => (body += c));
            req.on('end', () => {
                state.lastTokenBody = body;
                const p = new URLSearchParams(body);
                res.setHeader('content-type', 'application/json');
                if (url.pathname === '/device/code') {
                    res.end(JSON.stringify({ device_code: 'dc-1', user_code: 'ABCD-EFGH', verification_uri: 'https://double.example/activate', interval: 1, expires_in: 60 }));
                } else if (url.pathname === '/device/token') {
                    if (!state.deviceApproved) { res.writeHead(400); res.end(JSON.stringify({ error: 'authorization_pending' })); return; }
                    res.end(JSON.stringify({ access_token: 'atk-device-1', refresh_token: 'rtk-device-1', expires_in: 3600, scope: 'scope1 scope2' }));
                } else {
                    if (p.get('code') !== 'double-code-1' || !p.get('code_verifier')) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_grant' })); return; }
                    res.end(JSON.stringify({ access_token: 'atk-loopback-1', refresh_token: 'rtk-loopback-1', expires_in: 3600 }));
                }
            });
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    return { asBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state };
}

async function setup() {
    const d = mkdtempSync(join(tmpdir(), 'oauth-conn-')); dirs.push(d);
    const store = new AccountStore(join(d, 'a.db'));
    const tokens = new TokenFileStore(d, { SILHOUETTE_TOKEN_KEY: TEST_KEY } as NodeJS.ProcessEnv);
    return { d, store, tokens, manager: new ConnectionManager(store, tokens) };
}

describe('OAuth connect (declared-double AS; NOT a vendor login)', () => {
    it('loopback: start -> provider redirect -> complete stores tokens + registers vault: account', async () => {
        const { asBase } = await startDoubleAS();
        const { store, tokens, manager } = await setup();
        const pending = await manager.startOAuthConnect({
            providerId: 'OPENAI_CODEX', accountId: 'work', label: 'W', method: 'oauth-loopback',
            config: { clientId: 'double-client', authorizeUrl: `${asBase}/authorize`, tokenUrl: `${asBase}/token` },
        });
        expect(pending.authorizationUrl).toContain('code_challenge=');
        // Simulated browser: the provider redirects to the loopback waiter.
        const r = await fetch(pending.authorizationUrl!, { redirect: 'manual' });
        expect(r.status).toBe(302);
        await fetch(r.headers.get('location')!); // lands on the waiter
        const account = await manager.completeOAuthConnect(pending.pendingId);
        expect(account.method).toBe('oauth-loopback');
        expect(account.secretRef).toMatch(/^vault:oauth-openai_codex-work$/);
        const saved = tokens.read('oauth-openai_codex-work');
        expect(saved?.accessToken).toBe('atk-loopback-1');
        store.close();
    });
    it('device-code: start -> approve -> complete stores tokens + registers', async () => {
        const { asBase, state } = await startDoubleAS();
        const { store, tokens, manager } = await setup();
        const pending = await manager.startOAuthConnect({
            providerId: 'GITHUB_COPILOT', accountId: 'oss', label: 'O', method: 'device-code',
            config: { clientId: 'double-client', deviceCodeUrl: `${asBase}/device/code`, tokenUrl: `${asBase}/device/token` },
        });
        expect(pending.userCode).toBe('ABCD-EFGH');
        expect(pending.verificationUri).toBe('https://double.example/activate');
        state.deviceApproved = true;
        const account = await manager.completeOAuthConnect(pending.pendingId);
        expect(account.method).toBe('device-code');
        expect(tokens.read('oauth-github_copilot-oss')?.accessToken).toBe('atk-device-1');
        store.close();
    });
    it('cancel aborts a pending loopback connect and registers nothing', async () => {
        const { asBase } = await startDoubleAS();
        const { store, manager } = await setup();
        const pending = await manager.startOAuthConnect({
            providerId: 'OPENAI_CODEX', accountId: 'work', label: 'W', method: 'oauth-loopback',
            config: { clientId: 'double-client', authorizeUrl: `${asBase}/authorize`, tokenUrl: `${asBase}/token` },
        });
        manager.cancelOAuthConnect(pending.pendingId);
        expect(store.list()).toHaveLength(0);
        await expect(manager.completeOAuthConnect(pending.pendingId)).rejects.toThrow(ConnectionError);
        store.close();
    });
    it('close purges the local encrypted token copy but does not claim vendor revocation', async () => {
        const { asBase, state } = await startDoubleAS();
        const { store, tokens, manager } = await setup();
        const pending = await manager.startOAuthConnect({
            providerId: 'GITHUB_COPILOT', accountId: 'oss', label: 'O', method: 'device-code',
            config: { clientId: 'double-client', deviceCodeUrl: `${asBase}/device/code`, tokenUrl: `${asBase}/device/token` },
        });
        state.deviceApproved = true;
        await manager.completeOAuthConnect(pending.pendingId);
        const { localTokenPurged } = manager.closeConnection('GITHUB_COPILOT', 'oss');
        expect(localTokenPurged).toBe(true);
        expect(tokens.read('oauth-github_copilot-oss')).toBeUndefined();
        expect(store.list()).toHaveLength(0);
        store.close();
    });
    it('refuses non-https non-loopback endpoints and missing token custody', async () => {
        const { store, manager } = await setup();
        await expect(manager.startOAuthConnect({
            providerId: 'P', accountId: 'a', label: 'l', method: 'device-code',
            config: { clientId: 'c', deviceCodeUrl: 'http://169.254.1.1/device', tokenUrl: 'http://169.254.1.1/token' },
        })).rejects.toThrow(/https/);
        const noTokens = new ConnectionManager(store); // no TokenFileStore = SILHOUETTE_TOKEN_KEY unset
        await expect(noTokens.startOAuthConnect({
            providerId: 'P', accountId: 'a', label: 'l', method: 'device-code',
            config: { clientId: 'c', deviceCodeUrl: 'https://example.com/dc', tokenUrl: 'https://example.com/t' },
        })).rejects.toThrow(/SILHOUETTE_TOKEN_KEY/);
        store.close();
    });
});
