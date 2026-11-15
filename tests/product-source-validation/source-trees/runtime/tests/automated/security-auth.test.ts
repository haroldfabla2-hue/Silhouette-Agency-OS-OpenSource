/**
 * AUTOMATED TEST SUITE: Security — password hashing & auth bypass policy
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { hashPassword, verifyPassword } from '../../server/utils/password';

describe('Security: password hashing', () => {
    it('produces a salted scrypt hash (not plaintext, not bare sha256)', () => {
        const h = hashPassword('correct horse battery staple');
        expect(h.startsWith('scrypt$')).toBe(true);
        expect(h).not.toContain('correct horse');
        expect(h.split('$')).toHaveLength(3);
    });

    it('uses a unique salt per call (same password → different hashes)', () => {
        expect(hashPassword('pw')).not.toBe(hashPassword('pw'));
    });

    it('verifies a correct password and rejects a wrong one', () => {
        const plain = 'vitest-password-input-not-a-real-secret';
        const h = hashPassword(plain);
        expect(verifyPassword(plain, h).valid).toBe(true);
        expect(verifyPassword('vitest-wrong-password-input', h).valid).toBe(false);
    });

    it('accepts legacy unsalted SHA-256 hashes and flags them for upgrade', () => {
        const legacy = crypto.createHash('sha256').update('legacypw').digest('hex');
        const result = verifyPassword('legacypw', legacy);
        expect(result.valid).toBe(true);
        expect(result.needsUpgrade).toBe(true);
    });

    it('fails closed on empty/garbage stored hashes', () => {
        expect(verifyPassword('x', '').valid).toBe(false);
        expect(verifyPassword('x', null).valid).toBe(false);
        expect(verifyPassword('x', 'not-a-hash').valid).toBe(false);
    });
});

describe('Security: token-less auth bypass policy', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(async () => {
        const { resetTokenCache } = await import('../../server/middleware/authMiddleware');
        resetTokenCache();
    });

    afterEach(async () => {
        process.env = { ...ORIGINAL_ENV };
        const { resetTokenCache } = await import('../../server/middleware/authMiddleware');
        resetTokenCache();
        vi.restoreAllMocks();
    });

    function mockReqRes(path: string) {
        const req: any = { path, headers: {} };
        const res: any = {
            statusCode: 200,
            body: null,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: any) { this.body = payload; return this; },
        };
        return { req, res };
    }

    it('BLOCKS token-less access when bound to a non-loopback host', async () => {
        delete process.env.SILHOUETTE_API_KEY;
        delete process.env.SILHOUETTE_API_TOKEN;
        delete process.env.SILHOUETTE_ALLOW_INSECURE;
        process.env.NODE_ENV = 'development';
        process.env.SILHOUETTE_HOST = '0.0.0.0';

        const { authMiddleware, resetTokenCache } = await import('../../server/middleware/authMiddleware');
        resetTokenCache();
        const { req, res } = mockReqRes('/v1/system/secrets');
        let nextCalled = false;
        await authMiddleware(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(401);
    });

    it('ALLOWS token-less access on loopback host (local dev)', async () => {
        delete process.env.SILHOUETTE_API_KEY;
        delete process.env.SILHOUETTE_API_TOKEN;
        delete process.env.SILHOUETTE_ALLOW_INSECURE;
        process.env.NODE_ENV = 'development';
        process.env.SILHOUETTE_HOST = '127.0.0.1';

        const { authMiddleware, resetTokenCache } = await import('../../server/middleware/authMiddleware');
        resetTokenCache();
        const { req, res } = mockReqRes('/v1/system/info');
        let nextCalled = false;
        await authMiddleware(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
    });

    it('ALLOWS exposed host only with explicit SILHOUETTE_ALLOW_INSECURE opt-in', async () => {
        delete process.env.SILHOUETTE_API_KEY;
        delete process.env.SILHOUETTE_API_TOKEN;
        process.env.NODE_ENV = 'development';
        process.env.SILHOUETTE_HOST = '0.0.0.0';
        process.env.SILHOUETTE_ALLOW_INSECURE = 'true';

        const { authMiddleware, resetTokenCache } = await import('../../server/middleware/authMiddleware');
        resetTokenCache();
        const { req, res } = mockReqRes('/v1/system/info');
        let nextCalled = false;
        await authMiddleware(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
    });
});
