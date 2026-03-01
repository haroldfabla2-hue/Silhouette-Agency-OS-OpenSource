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
    // Identity - Setup and Auth
    '/v1/identity/is-setup',
    '/v1/identity/setup',
    '/v1/identity/login'
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

    // [SECURITY HARDENING] Fail fast in production if token is missing
    if (!_cachedToken && process.env.NODE_ENV === 'production') {
        console.error('[FATAL SECURITY EXCEPTION] SILHOUETTE_API_TOKEN is NOT set in production environment.');
        console.error('Refusing to start in open mode. Please set an API token.');
        process.exit(1);
    }

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
 * Express middleware that enforces authentication.
 *
 * It checks three authentication methods:
 * 1. Bearer Token (SILHOUETTE_API_TOKEN for system-to-system)
 * 2. x-session-id Header (Local login session)
 * 3. Empty database (Allows setup)
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    // NEW: Check for session ID from local login
    const sessionId = req.headers['x-session-id'] as string;

    if (sessionId) {
        // Validate local session
        try {
            const { identityService } = await import('../../services/identityService');
            // Check if session is valid by resolving current active session
            // For real security this should do a DB check for the session ID. 
            // For alpha we trust the active singleton if headers match, or implement a real check on identityService.
            // Let's implement a real check for the session token.
            const sessionValid = identityService.validateSession(sessionId);

            if (sessionValid) {
                next();
                return;
            }
        } catch (e) {
            console.error('[AUTH] Failed to validate session', e);
        }
    }

    if (!authHeader) {
        // Check if database is completely empty (first time setup allowed)
        try {
            const { identityService } = await import('../../services/identityService');
            if (!identityService.hasAnyUser()) {
                console.log('[AUTH] 🚦 Database empty. Permitting access for First-Time Setup.');
                next();
                return;
            }
        } catch (e) {
            // ignore
        }

        res.status(401).json({
            error: 'Authentication required',
            hint: 'Set Authorization: Bearer <token> or login via /v1/identity/login',
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
    if (serverToken && timingSafeEqual(clientToken, serverToken)) {
        // 6. Authenticated via API token — proceed
        next();
        return;
    }

    res.status(403).json({ error: 'Invalid API token or Session' });
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
