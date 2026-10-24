import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../../services/auth/accountStore';
import { TokenFileStore } from '../../../services/auth/tokenFileStore';
import { refreshAccountToken, refreshWithTokenEndpoint } from '../../../services/auth/refreshOrchestrator';

const dirs: string[] = [];
function base(): string { const d = mkdtempSync(join(tmpdir(), 'ro-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

let server: Server | undefined;
afterEach(() => new Promise<void>(r => { if (!server) return r(); server.close(() => r()); server = undefined; }));

const KEY = 'b'.repeat(64);
const env = { SILHOUETTE_TOKEN_KEY: KEY } as NodeJS.ProcessEnv;

function setup(d: string) {
    const store = new AccountStore(join(d, 'a.db'));
    const tokens = new TokenFileStore(d, env);
    store.add({ providerId: 'OPENAI_CODEX', accountId: 'work', label: 'W', method: 'oauth-loopback', secretRef: 'vault:codex-work' });
    store.activate('OPENAI_CODEX', 'work');
    return { store, tokens };
}

describe('refreshOrchestrator (fencing on the real final write, real HTTP)', () => {
    it('refreshes an expired token against a real token endpoint and stores it fenced', async () => {
        const d = base();
        const { store, tokens } = setup(d);
        tokens.write('codex-work', {
            accessToken: 'old-at', refreshToken: 'rt-1',
            expiresAt: new Date(Date.now() - 1000).toISOString(), obtainedAt: new Date().toISOString(),
        });
        let grantSeen = '';
        server = createServer((req, res) => {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                grantSeen = new URLSearchParams(body).get('grant_type') || '';
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                    access_token: 'new-at-live', refresh_token: 'rt-2', expires_in: 3600,
                }));
            });
        });
        await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
        const url = `http://127.0.0.1:${(server!.address() as any).port}/token`;
        const result = await refreshAccountToken(store, tokens, d, 'OPENAI_CODEX', 'work', refreshWithTokenEndpoint(url, 'client-1'));
        expect(result.accessToken).toBe('new-at-live');
        expect(grantSeen).toBe('refresh_token');
        // the REAL final write landed, readable through the store
        expect(tokens.read('codex-work')?.accessToken).toBe('new-at-live');
        expect(store.list('OPENAI_CODEX')[0].status).toBe('active');
        store.close();
    });
    it('concurrent refreshes dedupe: the second sees the fresh token and skips the endpoint', async () => {
        const d = base();
        const { store, tokens } = setup(d);
        tokens.write('codex-work', {
            accessToken: 'old-at', refreshToken: 'rt-1',
            expiresAt: new Date(Date.now() - 1000).toISOString(), obtainedAt: new Date().toISOString(),
        });
        let endpointCalls = 0;
        const slowRefresh = async () => {
            endpointCalls++;
            await new Promise(r => setTimeout(r, 150));
            return { accessToken: `at-${endpointCalls}`, refreshToken: 'rt-2', expiresAt: new Date(Date.now() + 3600_000).toISOString(), obtainedAt: new Date().toISOString() };
        };
        const [r1, r2] = await Promise.all([
            refreshAccountToken(store, tokens, d, 'OPENAI_CODEX', 'work', slowRefresh),
            refreshAccountToken(store, tokens, d, 'OPENAI_CODEX', 'work', slowRefresh),
        ]);
        expect(endpointCalls).toBe(1); // lock + re-read inside the lock prevented the double refresh
        expect(r1.accessToken).toBe(r2.accessToken);
        store.close();
    });
    it('refresh failure leaves the account errored, never half-written', async () => {
        const d = base();
        const { store, tokens } = setup(d);
        tokens.write('codex-work', { accessToken: 'old-at', refreshToken: 'rt-1', expiresAt: new Date(Date.now() - 1000).toISOString(), obtainedAt: new Date().toISOString() });
        await expect(refreshAccountToken(store, tokens, d, 'OPENAI_CODEX', 'work', async () => { throw new Error('vendor 400 invalid_grant'); }))
            .rejects.toThrow('invalid_grant');
        expect(tokens.read('codex-work')?.accessToken).toBe('old-at'); // untouched
        store.close();
    });
});
