// =============================================================================
// AUTHENTICATION MIDDLEWARE
// Validates Bearer token on all API requests.
// Token is configured via SILHOUETTE_API_KEY env variable.
// =============================================================================

import { Request, Response, NextFunction } from 'express';

// ─── Public Endpoints (no auth required) ─────────────────────────────────────

const PUBLIC_PATHS = new Set([
    // NOTE: /v1/system/status|doctor|health removed 2026-10-18 (PR #194):
    // they leaked the backend connection inventory to unauthenticated
    // scanners. The frontend always sends the API token, so it is unaffected.
    // Identity - Setup and Auth
    '/v1/identity/setup-status',
    '/v1/identity/setup',
    '/v1/identity/auto-login',
    '/v1/identity/is-setup',
    '/v1/identity/login',
    '/v1/drive/auth',
    '/v1/drive/callback',
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


/**
 * Read the login session id from the HttpOnly session cookie. Browser
 * features that cannot set headers (EventSource streams, <img> media)
 * authenticate through this cookie instead of the x-session-id header.
 */
export function parseSessionCookie(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/(?:^|;\s*)silhouette_session=([^;\s]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

// ─── Token Resolver ──────────────────────────────────────────────────────────

let _cachedToken: string | null = null;

/**
 * Lazily resolve the API token from environment.
 * This avoids issues with env not being loaded at import time.
 */
function getToken(): string | null {
    if (_cachedToken !== null) return _cachedToken;
    _cachedToken = process.env.SILHOUETTE_API_KEY || process.env.SILHOUETTE_API_TOKEN || '';

    // [SECURITY HARDENING] Fail fast in production if token is missing
    if (!_cachedToken && process.env.NODE_ENV === 'production') {
        console.error('[FATAL SECURITY EXCEPTION] SILHOUETTE_API_KEY is NOT set in production environment.');
        console.error('Refusing to start in open mode. Please set an API key.');
        process.exit(1);
    }

    return _cachedToken;
}

/**
 * Reset the cached token (useful for testing).
 */
export function resetTokenCache(): void {
    _cachedToken = null;
    _insecureWarned = false;
}

let _insecureWarned = false;

/**
 * Determine whether running token-less is acceptable for this deployment.
 *
 * Without an API token the API is wide open, so we only permit it when the
 * server is bound to the loopback interface (local development), or when the
 * operator has explicitly accepted the risk via SILHOUETTE_ALLOW_INSECURE=true.
 *
 * Otherwise — i.e. a network-exposed server with no token — we refuse the
 * bypass and force callers to authenticate.
 */
function isTokenlessBypassAllowed(): boolean {
    if (/^(1|true|yes|on)$/i.test(process.env.SILHOUETTE_ALLOW_INSECURE || '')) {
        if (!_insecureWarned) {
            console.warn('[AUTH] ⚠️ SILHOUETTE_ALLOW_INSECURE is set — running with NO authentication. Do not use in production.');
            _insecureWarned = true;
        }
        return true;
    }

    const host = (process.env.SILHOUETTE_HOST || process.env.HOST || '').trim().toLowerCase();
    // Treat an unset host as loopback ONLY in non-production. In production a
    // missing token already aborts boot via getToken().
    const loopbackHosts = new Set(['', '127.0.0.1', 'localhost', '::1']);
    const boundToLoopback = loopbackHosts.has(host);

    if (boundToLoopback && !_insecureWarned) {
        console.warn('[AUTH] 🔓 No API token configured — auth disabled for loopback-only access. Set SILHOUETTE_API_TOKEN to secure the API.');
        _insecureWarned = true;
    }
    return boundToLoopback;
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

    // [SECURITY] Fail-closed boot: the identity store must be ready before any
    // auth decision. Before the first identity route call initializes it, every
    // check below (session validation, empty-database detection) would run
    // against a null database and permit anonymous access.
    try {
        const { identityService } = await import('../../services/identityService');
        if (typeof identityService.isInitialized === 'function' && !identityService.isInitialized()) {
            await identityService.init();
        }
    } catch (e) {
        console.error('[AUTH] Identity store unavailable; denying request (fail-closed).', e);
        res.status(503).json({
            error: 'Service initializing',
            hint: 'Identity store not ready; retry shortly.',
        });
        return;
    }

    // 2. If no token is configured, only bypass when it is safe to do so
    //    (loopback-only, or explicit opt-in). A network-exposed token-less
    //    server is refused — closing the previous "wide open" hole.
    const serverToken = getToken();
    if (!serverToken) {
        if (isTokenlessBypassAllowed()) {
            // [R4] Root fix: the bypass used to assign req.user=null BEFORE
            // validating a presented login session, so a logged-in user on a
            // token-less local install was demoted to 'anonymous' and all
            // memory landed in a shared global identity. Validate the session
            // header when present; only truly unidentified requests stay null.
            const sessionId = (req.headers['x-session-id'] as string) || parseSessionCookie(req.headers.cookie) || '';
            if (sessionId) {
                try {
                    const { identityService } = await import('../../services/identityService');
                    const sessionUser = identityService.validateSessionAndGetUser(sessionId);
                    if (sessionUser) {
                        (req as any).user = sessionUser;
                        next();
                        return;
                    }
                } catch (e) {
                    console.error('[AUTH] Failed to validate session (tokenless bypass)', e);
                }
            }
            (req as any).user = null;
            next();
            return;
        }
        res.status(401).json({
            error: 'Authentication required',
            hint: 'This server is network-exposed with no API token. Set SILHOUETTE_API_TOKEN, or set SILHOUETTE_ALLOW_INSECURE=true to explicitly run without auth.',
        });
        return;
    }

    // 3. Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;

    // NEW: Check for session ID from local login
    const sessionId = (req.headers['x-session-id'] as string) || parseSessionCookie(req.headers.cookie) || '';

    if (sessionId) {
        // Validate local session securely & per request
        try {
            const { identityService } = await import('../../services/identityService');
            const sessionUser = identityService.validateSessionAndGetUser(sessionId);

            if (sessionUser) {
                // Attach the user strictly to this request's lifecycle.
                // Do NOT rely on identityService.getCurrentUser() later in the pipeline.
                (req as any).user = sessionUser;
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
        // 6. Authenticated via the master API token. This credential already
        //    authorizes every endpoint (including exec approvals); leaving
        //    req.user unset silently demoted it to GUEST downstream — chat tool
        //    execution was blocked for the operator's own key. Give it an
        //    explicit system identity instead.
        (req as any).user = { id: 'system:api-token', role: 'CREATOR' };
        next();
        return;
    }

    console.log(`[AUTH DEBUG] Returning 403 for path: ${req.path}, OriginalUrl: ${req.originalUrl}, isPublic: ${isPublicPath(req.path)}`);
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
