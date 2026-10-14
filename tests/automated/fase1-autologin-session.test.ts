import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

// FASE1 PR-A: /v1/identity/auto-login validated the trusted device and returned
// success WITHOUT creating a session or cookie. The SPA rendered authenticated
// while every API call failed 401 - the UI looked frozen on return visits.
// Pinned contracts:
// 1. A successful auto-login creates a session for (user.id, device.id),
//    sets the HttpOnly cookie, and returns the session in the body.
// 2. If the device row cannot be resolved, the route refuses (401) instead of
//    faking an authenticated state.
// 3. Unknown fingerprints still get success:false (no session created).

const mocks = vi.hoisted(() => ({
    tryAutoLogin: vi.fn(),
    getDeviceByFingerprint: vi.fn(),
    createSession: vi.fn(),
    hasAnyUsers: vi.fn().mockReturnValue(true),
    init: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../services/identityService', () => ({
    identityService: {
        init: mocks.init,
        tryAutoLogin: mocks.tryAutoLogin,
        getDeviceByFingerprint: mocks.getDeviceByFingerprint,
        createSession: mocks.createSession,
        hasAnyUsers: mocks.hasAnyUsers
    }
}));

import identityRouter from '../../server/routes/v1/identity.routes';

async function post(path: string, body: any): Promise<{ status: number; body: any; setCookie: string | undefined }> {
    const app = express();
    app.use(express.json());
    app.use('/v1/identity', identityRouter);
    const server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as any).port;
    try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return { status: res.status, body: await res.json(), setCookie: res.headers.get('set-cookie') ?? undefined };
    } finally {
        server.closeAllConnections?.();
        await new Promise(r => server.close(r));
    }
}

describe('auto-login issues a real session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDeviceByFingerprint.mockReturnValue({ id: 'dev-1', name: 'QA browser', trusted: true });
        mocks.createSession.mockReturnValue({ id: 'sess-123', userId: 'u-1', deviceId: 'dev-1', expiresAt: Date.now() + 1000, createdAt: Date.now() });
    });

    it('creates a session, sets the cookie, and returns the session', async () => {
        mocks.tryAutoLogin.mockResolvedValue({ id: 'u-1', email: null, name: 'Alberto', role: 'CREATOR', googleLinked: false });
        const r = await post('/v1/identity/auto-login', { fingerprint: 'abc123' });
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
        expect(r.body.session?.id).toBe('sess-123');
        expect(mocks.createSession).toHaveBeenCalledWith('u-1', 'dev-1');
        expect(r.setCookie).toContain('silhouette_session=sess-123');
        expect(r.setCookie).toContain('HttpOnly');
    });

    it('refuses when the device row cannot be resolved', async () => {
        mocks.tryAutoLogin.mockResolvedValue({ id: 'u-1', email: null, name: 'Alberto', role: 'CREATOR', googleLinked: false });
        mocks.getDeviceByFingerprint.mockReturnValue(undefined);
        const r = await post('/v1/identity/auto-login', { fingerprint: 'abc123' });
        expect(r.status).toBe(401);
        expect(r.body.success).toBe(false);
        expect(mocks.createSession).not.toHaveBeenCalled();
    });

    it('creates no session for unknown fingerprints', async () => {
        mocks.tryAutoLogin.mockResolvedValue(null);
        const r = await post('/v1/identity/auto-login', { fingerprint: 'nope' });
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(false);
        expect(mocks.createSession).not.toHaveBeenCalled();
    });
});
