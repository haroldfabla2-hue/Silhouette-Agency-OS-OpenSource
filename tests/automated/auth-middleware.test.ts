/**
 * AUTOMATED TEST SUITE: Auth Middleware
 * Tests Bearer token authentication middleware
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authMiddleware, resetTokenCache } from '../../server/middleware/authMiddleware';

// Helper to create mock Express req/res/next
function createMocks(overrides: { path?: string; authorization?: string } = {}) {
    const req: any = {
        path: overrides.path || '/v1/chat',
        headers: {} as Record<string, string>,
    };
    if (overrides.authorization) {
        req.headers.authorization = overrides.authorization;
    }

    const res: any = {
        statusCode: 200,
        body: null,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: any) {
            this.body = body;
            return this;
        },
    };

    const next = vi.fn();
    return { req, res, next };
}

describe('Auth Middleware', () => {
    afterEach(() => {
        resetTokenCache();
        vi.unstubAllEnvs();
    });

    it('should allow requests when no SILHOUETTE_API_TOKEN is configured (dev mode)', () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', '');
        resetTokenCache();

        const { req, res, next } = createMocks();
        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
    });

    it('should reject requests without Authorization header when token is set', () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', 'test-secret-token');
        resetTokenCache();

        const { req, res, next } = createMocks();
        authMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toContain('Authentication required');
    });

    it('should reject requests with invalid token', () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', 'correct-token');
        resetTokenCache();

        const { req, res, next } = createMocks({
            authorization: 'Bearer wrong-token',
        });
        authMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('should accept requests with valid token', () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', 'my-valid-token');
        resetTokenCache();

        const { req, res, next } = createMocks({
            authorization: 'Bearer my-valid-token',
        });
        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('should allow health check endpoints without auth', () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', 'secret');
        resetTokenCache();

        const healthPaths = ['/v1/system/status', '/v1/system/doctor', '/v1/system/health'];
        for (const path of healthPaths) {
            const { req, res, next } = createMocks({ path });
            authMiddleware(req, res, next);
            expect(next).toHaveBeenCalled();
        }
    });

    it('should reject malformed Authorization header', () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', 'secret');
        resetTokenCache();

        const { req, res, next } = createMocks({
            authorization: 'Basic dXNlcjpwYXNz',
        });
        authMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toContain('Invalid authorization format');
    });
});
