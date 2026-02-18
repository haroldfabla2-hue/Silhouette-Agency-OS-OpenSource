// =============================================================================
// RATE LIMITER MIDDLEWARE
// Protects the API from abuse and excessive requests.
// Uses express-rate-limit with configurable windows.
// =============================================================================

import rateLimit from 'express-rate-limit';

// ─── Global Rate Limiter ─────────────────────────────────────────────────────

/**
 * Global rate limiter: 100 requests per minute per IP.
 * Applies to all endpoints.
 */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    standardHeaders: true,    // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,     // Disable `X-RateLimit-*` headers
    message: {
        error: 'Too many requests',
        retryAfterMs: 60_000,
        hint: 'Rate limit: 100 requests per minute',
    },
});

// ─── Chat Rate Limiter ───────────────────────────────────────────────────────

/**
 * Chat/LLM rate limiter: 30 requests per minute per IP.
 * These endpoints are expensive (LLM inference).
 */
export const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many chat requests',
        retryAfterMs: 60_000,
        hint: 'Chat rate limit: 30 requests per minute',
    },
});

// ─── Admin Rate Limiter ──────────────────────────────────────────────────────

/**
 * Admin rate limiter: 10 requests per minute per IP.
 * Extra restrictive for sensitive operations.
 */
export const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many admin requests',
        retryAfterMs: 60_000,
        hint: 'Admin rate limit: 10 requests per minute',
    },
});
