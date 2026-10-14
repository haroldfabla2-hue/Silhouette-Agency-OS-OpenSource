import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// FASE1: the session cookie exists for browser features that cannot set
// headers (EventSource streams, <img> media). Pinned contracts:
// 1. A valid session id in the HttpOnly cookie authenticates exactly like
//    the x-session-id header.
// 2. A forged cookie is rejected.
// 3. An explicit header wins over the cookie when both are present.
// 4. The cookie parser never throws on malformed input.

vi.mock('../../services/identityService', () => ({
    identityService: {
        hasAnyUser: vi.fn().mockReturnValue(true),
        validateSessionAndGetUser: vi.fn((sid: string) =>
            sid === 'good-session' ? { id: 'user-alberto', role: 'CREATOR' } : null)
    }
}));

import { authMiddleware, resetTokenCache, parseSessionCookie } from '../../server/middleware/authMiddleware';

beforeAll(() => {
    process.env.SILHOUETTE_API_KEY = 'fase1-test-token';
    resetTokenCache();
});

afterAll(() => {
    delete process.env.SILHOUETTE_API_KEY;
    resetTokenCache();
});

function createMocks(headers: Record<string, string> = {}) {
    const req: any = { path: '/v1/chat', headers };
    const res: any = {
        statusCode: 200, body: null,
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { this.body = body; return this; }
    };
    const next = vi.fn();
    return { req, res, next };
}

describe('parseSessionCookie', () => {
    it('extracts the session id from a multi-cookie header', () => {
        expect(parseSessionCookie('theme=dark; silhouette_session=abc-123; other=1')).toBe('abc-123');
    });
    it('returns null when the cookie is absent', () => {
        expect(parseSessionCookie('theme=dark')).toBeNull();
        expect(parseSessionCookie(undefined)).toBeNull();
    });
    it('returns null on malformed values without throwing', () => {
        expect(parseSessionCookie('silhouette_session')).toBeNull();
        expect(parseSessionCookie('silhouette_session=')).toBeNull();
    });
});

describe('authMiddleware: session cookie', () => {
    it('authenticates a valid session id presented only via cookie', async () => {
        const { req, res, next } = createMocks({ cookie: 'silhouette_session=good-session' });
        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user?.id).toBe('user-alberto');
    });

    it('rejects a forged cookie with 401', async () => {
        const { req, res, next } = createMocks({ cookie: 'silhouette_session=forged-session' });
        await authMiddleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('explicit x-session-id header wins over a forged cookie', async () => {
        const { req, res, next } = createMocks({
            'x-session-id': 'good-session',
            cookie: 'silhouette_session=forged-session'
        });
        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user?.id).toBe('user-alberto');
    });
});
