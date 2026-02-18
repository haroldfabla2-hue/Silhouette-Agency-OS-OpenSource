// =============================================================================
// AUTHENTICATION MIDDLEWARE
// Validates Bearer token on all API requests.
// Token is configured via SILHOUETTE_API_TOKEN env variable.
// =============================================================================

import { Request, Response, NextFunction } from 'express';

// ─── Public Endpoints (no auth required) ─────────────────────────────────────

const PUBLIC_PATHS = new Set([
    '/v1/system/status',
    '/v1/system/doctor',
    '/v1/system/health',
]);

/**
 * Check if a request path should bypass authentication.
 */
function isPublicPath(path: string): boolean {
    // Exact match
    if (PUBLIC_PATHS.has(path)) return true;
    // Prefix match for sub-paths like /v1/system/doctor/full
    for (const pub of PUBLIC_PATHS) {
        if (path.startsWith(pub + '/')) return true;
    }
    return false;
}

// ─── Token Resolver ──────────────────────────────────────────────────────────

let _cachedToken: string | null = null;

/**
 * Lazily resolve the API token from environment.
 * This avoids issues with env not being loaded at import time.
 */
function getToken(): string | null {
    if (_cachedToken !== null) return _cachedToken;
    _cachedToken = process.env.SILHOUETTE_API_TOKEN || '';
    return _cachedToken;
}

/**
 * Reset the cached token (useful for testing).
 */
export function resetTokenCache(): void {
    _cachedToken = null;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Express middleware that enforces Bearer token authentication.
 *
 * - If no SILHOUETTE_API_TOKEN is set, auth is DISABLED (dev mode).
 * - Public paths (health checks) are always allowed.
 * - All other requests require: `Authorization: Bearer <token>`
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    // 1. Skip auth for public endpoints
    if (isPublicPath(req.path)) {
        next();
        return;
    }

    // 2. If no token is configured, skip auth (development mode)
    const serverToken = getToken();
    if (!serverToken) {
        next();
        return;
    }

    // 3. Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({
            error: 'Authentication required',
            hint: 'Set Authorization: Bearer <SILHOUETTE_API_TOKEN> header',
        });
        return;
    }

    // 4. Validate format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        res.status(401).json({
            error: 'Invalid authorization format',
            hint: 'Expected: Authorization: Bearer <token>',
        });
        return;
    }

    // 5. Compare tokens (constant-time comparison for security)
    const clientToken = parts[1];
    if (!timingSafeEqual(clientToken, serverToken)) {
        res.status(403).json({ error: 'Invalid API token' });
        return;
    }

    // 6. Authenticated — proceed
    next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
