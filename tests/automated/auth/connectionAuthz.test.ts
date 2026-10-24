/**
 * AUTHORIZATION traversal through the REAL authMiddleware + REAL
 * identityService (tmp DB) + the real connection routes: anonymous -> 401,
 * USER session -> 403, ADMIN session -> 403, CREATOR session -> 200 with the
 * attributed principal visible to the handler, master Bearer token -> 200 as
 * system:api-token. User rows for ADMIN/USER are seeded directly in the tmp
 * identity DB (fixture data); sessions come from the real createSession.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

let dir: string;
let server: Server;
let base: string;
let sessions: Record<'CREATOR' | 'CREATOR2' | 'ADMIN' | 'USER', string>;
let creatorId: string;

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'authz-'));
    process.env.SILHOUETTE_DB_PATH = join(dir, 'identity.sqlite');
    process.env.SILHOUETTE_API_TOKEN = 'op-token-authz-test';
    const { identityService } = await import('../../../services/identityService');
    const { authMiddleware, resetTokenCache } = await import('../../../server/middleware/authMiddleware');
    const { createConnectionRouter } = await import('../../../server/routes/connections');
    const { ConnectionManager } = await import('../../../services/auth/connectionManager');
    const { AccountStore } = await import('../../../services/auth/accountStore');
    const { TokenFileStore } = await import('../../../services/auth/tokenFileStore');
    await identityService.init();
    resetTokenCache();

    const first = identityService.setupFirstUser('creator', 'fp-c', 'dev');
    creatorId = first.user.id;
    sessions = { CREATOR: first.session.id, CREATOR2: '', ADMIN: '', USER: '' };

    // Seed ADMIN + USER rows directly (no public role-setting API exists);
    // sessions are REAL via registerDevice + createSession.
    const db = new Database(join(dir, 'identity.sqlite'));
    const now = Date.now();
    for (const [id, role] of [['u-admin', 'ADMIN'], ['u-user', 'USER'], ['u-creator2', 'CREATOR']] as const) {
        db.prepare(`INSERT INTO users (id, email, password_hash, name, avatar_url, role, google_email, created_at, last_login)
                    VALUES (?, ?, NULL, ?, NULL, ?, NULL, ?, ?)`).run(id, `${id}@t.local`, id, role, now, now);
    }
    db.close();
    for (const id of ['u-admin', 'u-user', 'u-creator2'] as const) {
        const device = identityService.registerDevice(id, `fp-${id}`, 'dev');
        const s = identityService.createSession(id, device.id);
        sessions[id === 'u-admin' ? 'ADMIN' : id === 'u-user' ? 'USER' : 'CREATOR2'] = s.id;
    }

    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    const tokens = new TokenFileStore(dir, { SILHOUETTE_TOKEN_KEY: 'b'.repeat(64) } as NodeJS.ProcessEnv); // test key, tmp dir
    app.use('/v1/connections', createConnectionRouter(new ConnectionManager(new AccountStore(join(dir, 'accounts.db')), tokens)));
    server = await new Promise<Server>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/connections`;
});

afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
});

describe('connection routes through the REAL auth middleware', () => {
    it('anonymous is rejected 401 by the global middleware', async () => {
        const res = await fetch(base);
        expect(res.status).toBe(401);
    });
    it('a USER session is authenticated but forbidden from connections', async () => {
        const res = await fetch(base, { headers: { 'x-session-id': sessions.USER } });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('forbidden-role');
    });
    it('an ADMIN session is authenticated but still forbidden (CREATOR required)', async () => {
        const res = await fetch(base, { headers: { 'x-session-id': sessions.ADMIN } });
        expect(res.status).toBe(403);
    });
    it('a CREATOR session passes with the principal attributed to the handler', async () => {
        const res = await fetch(base, { headers: { 'x-session-id': sessions.CREATOR } });
        expect(res.status).toBe(200);
        expect((await res.json()).principal).toBe(creatorId);
    });
    it('the master Bearer token passes as system:api-token (role CREATOR)', async () => {
        const res = await fetch(base, { headers: { authorization: 'Bearer op-token-authz-test' } });
        expect(res.status).toBe(200);
        expect((await res.json()).principal).toBe('system:api-token');
    });
    it('a pending OAuth connect is bound to its initiating principal over HTTP', async () => {
        // oauth-loopback start performs no outbound call (URL build + loopback waiter only).
        const start = await fetch(`${base}/oauth/start`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': sessions.CREATOR },
            body: JSON.stringify({
                providerId: 'OPENAI_CODEX', accountId: 'bind-test', label: 'B', method: 'oauth-loopback',
                config: { clientId: 'c', authorizeUrl: 'https://example.com/authorize', tokenUrl: 'https://example.com/token' },
            }),
        });
        expect(start.status).toBe(201);
        const { pending } = await start.json();
        const cancelOther = await fetch(`${base}/oauth/${pending.pendingId}/cancel`, { method: 'POST', headers: { 'x-session-id': sessions.CREATOR2 } });
        expect(cancelOther.status).toBe(403);
        expect((await cancelOther.json()).error).toBe('forbidden-principal');
        const cancelOwner = await fetch(`${base}/oauth/${pending.pendingId}/cancel`, { method: 'POST', headers: { 'x-session-id': sessions.CREATOR } });
        expect(cancelOwner.status).toBe(200);
    });
    it('a USER session cannot mutate connections either', async () => {
        const res = await fetch(base, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': sessions.USER },
            body: JSON.stringify({ providerId: 'OPENAI_CODEX', accountId: 'x', label: 'x', method: 'env', secretRef: 'env:X' }),
        });
        expect(res.status).toBe(403);
    });
});
