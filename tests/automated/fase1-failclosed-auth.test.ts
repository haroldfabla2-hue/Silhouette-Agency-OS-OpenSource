import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// FASE1 fail-closed boot: before the first identity route call initializes the
// identity store, the auth gate must initialize it on demand and never read a
// null database as an empty one. Pinned contracts:
// 1. Uninitialized store -> the gate calls init() before deciding.
// 2. After init with existing users, an anonymous request is rejected (401).
// 3. First-time setup is permitted only when the store is confirmed empty AFTER init.
// 4. If init() fails, the request is denied (503) and never permitted.

const h = vi.hoisted(() => ({
    usersExist: true,
    initialized: false,
    initSpy: vi.fn(),
}));

vi.mock('../../services/identityService', () => ({
    identityService: {
        isInitialized: vi.fn(() => h.initialized),
        init: h.initSpy,
        hasAnyUser: vi.fn(() => h.initialized && h.usersExist),
        validateSessionAndGetUser: vi.fn(() => null)
    }
}));

import { authMiddleware, resetTokenCache } from '../../server/middleware/authMiddleware';

beforeAll(() => {
    process.env.SILHOUETTE_API_KEY = 'failclosed-test-token';
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

describe('fail-closed boot gate', () => {
    it('initializes the identity store on demand, then rejects anonymous access when users exist', async () => {
        h.initialized = false; h.usersExist = true;
        h.initSpy.mockReset().mockImplementation(async () => { h.initialized = true; });
        const { req, res, next } = createMocks();
        await authMiddleware(req, res, next);
        expect(h.initSpy).toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('permits first-time setup only after the store is confirmed empty', async () => {
        h.initialized = false; h.usersExist = false;
        h.initSpy.mockReset().mockImplementation(async () => { h.initialized = true; });
        const { req, res, next } = createMocks();
        await authMiddleware(req, res, next);
        expect(h.initSpy).toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    it('denies with 503 and never permits when the store cannot initialize', async () => {
        h.initialized = false; h.usersExist = true;
        h.initSpy.mockReset().mockRejectedValue(new Error('db locked'));
        const { req, res, next } = createMocks();
        await authMiddleware(req, res, next);
        expect(res.statusCode).toBe(503);
        expect(next).not.toHaveBeenCalled();
    });
});
