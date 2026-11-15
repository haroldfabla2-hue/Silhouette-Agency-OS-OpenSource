/**
 * AUTOMATED TEST SUITE: Rate Limiter
 * Tests rate limiting middleware configuration
 */
import { describe, it, expect } from 'vitest';
import { globalLimiter, chatLimiter, adminLimiter } from '../../server/middleware/rateLimiter';

describe('Rate Limiter', () => {
    it('should export globalLimiter as a function (middleware)', () => {
        expect(typeof globalLimiter).toBe('function');
    });

    it('should export chatLimiter as a function (middleware)', () => {
        expect(typeof chatLimiter).toBe('function');
    });

    it('should export adminLimiter as a function (middleware)', () => {
        expect(typeof adminLimiter).toBe('function');
    });

    it('all limiters should be distinct instances', () => {
        expect(globalLimiter).not.toBe(chatLimiter);
        expect(chatLimiter).not.toBe(adminLimiter);
        expect(globalLimiter).not.toBe(adminLimiter);
    });
});
