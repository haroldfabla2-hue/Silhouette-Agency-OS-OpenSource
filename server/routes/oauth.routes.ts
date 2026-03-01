// ═══════════════════════════════════════════════════════════════
// GENERIC OAUTH CALLBACK ROUTE
// ═══════════════════════════════════════════════════════════════
// Handles authorization code exchange for any OAuth2 integration
// configured in the Settings UI. Stores tokens in the server-side
// secrets vault (SQLite) and closes the popup window.
// ═══════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { sqliteService } from '../../services/sqliteService';

const router = Router();

// Escape HTML entities to prevent XSS in template
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * GET /oauth/callback
 * 
 * Query params:
 *   code   - Authorization code from the OAuth provider
 *   state  - JSON-encoded { serviceId, redirectUri } passed during auth start
 *   error  - OAuth error (if any)
 * 
 * Flow:
 * 1. Receive auth code from provider redirect
 * 2. Look up client_id and client_secret from secrets vault
 * 3. Exchange code for tokens via provider's token endpoint
 * 4. Store tokens in secrets vault under the service ID
 * 5. Close popup with success/error message back to parent window
 */
router.get('/callback', async (req: Request, res: Response) => {
    try {
        const code = req.query.code as string;
        const stateRaw = req.query.state as string;
        const error = req.query.error as string;

        // Handle OAuth error from provider
        if (error) {
            return res.send(renderResult(false, `OAuth Error: ${escapeHtml(error)}`));
        }

        if (!code) {
            return res.status(400).send(renderResult(false, 'Missing authorization code'));
        }

        // Decode state to know which service this callback is for
        let state: { serviceId: string; redirectUri?: string } = { serviceId: 'unknown' };
        try {
            if (stateRaw) {
                state = JSON.parse(Buffer.from(stateRaw, 'base64').toString('utf-8'));
            }
        } catch {
            // State might not be JSON — treat as serviceId directly
            state = { serviceId: stateRaw || 'unknown' };
        }

        const { serviceId } = state;

        // Look up integration config from secrets vault
        const integrationConfig = sqliteService.getConfig(`secretsVault_${serviceId}`);
        const oauthConfig = sqliteService.getConfig(`oauthConfig_${serviceId}`);

        // Build token exchange request
        const tokenEndpoint = oauthConfig?.tokenUrl;
        const clientId = integrationConfig?.clientId || oauthConfig?.clientId;
        const clientSecret = integrationConfig?.clientSecret || oauthConfig?.clientSecret;
        const redirectUri = state.redirectUri || oauthConfig?.redirectUri || `${req.protocol}://${req.get('host')}/oauth/callback`;

        if (tokenEndpoint && clientId && clientSecret) {
            // Exchange authorization code for access/refresh tokens
            const tokenResponse = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                }).toString(),
            });

            if (!tokenResponse.ok) {
                const errorBody = await tokenResponse.text();
                console.error(`[OAUTH] Token exchange failed for ${serviceId}:`, errorBody);
                return res.send(renderResult(false, `Token exchange failed: ${tokenResponse.status}`));
            }

            const tokens = await tokenResponse.json();

            // Store tokens in the secrets vault
            const existingSecrets = sqliteService.getConfig(`secretsVault_${serviceId}`) || {};
            sqliteService.setConfig(`secretsVault_${serviceId}`, {
                ...existingSecrets,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                tokenType: tokens.token_type,
                expiresAt: tokens.expires_in
                    ? Date.now() + (tokens.expires_in * 1000)
                    : undefined,
                scope: tokens.scope,
                oauthConnected: true,
                oauthConnectedAt: Date.now(),
            });

            console.log(`[OAUTH] ✅ Tokens stored for ${serviceId}`);
            return res.send(renderResult(true, `${escapeHtml(serviceId)} connected successfully!`));
        } else {
            // No token endpoint configured — just store the auth code
            // This handles cases where the frontend does its own token exchange
            const existingSecrets = sqliteService.getConfig(`secretsVault_${serviceId}`) || {};
            sqliteService.setConfig(`secretsVault_${serviceId}`, {
                ...existingSecrets,
                authorizationCode: code,
                oauthConnected: true,
                oauthConnectedAt: Date.now(),
            });

            console.log(`[OAUTH] ✅ Auth code stored for ${serviceId} (no token endpoint configured)`);
            return res.send(renderResult(true, `${escapeHtml(serviceId)} authorization code received.`));
        }
    } catch (e: any) {
        console.error('[OAUTH] Callback error:', e);
        return res.status(500).send(renderResult(false, `Internal error: ${escapeHtml(e.message)}`));
    }
});

/**
 * Renders an HTML page that shows success/error and notifies the parent window.
 * The popup auto-closes after 2 seconds.
 */
function renderResult(success: boolean, message: string): string {
    const color = success ? '#00ff88' : '#ff4444';
    const icon = success ? '✅' : '❌';
    return `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth ${success ? 'Success' : 'Error'}</title>
    <style>
        body {
            background: #0a0a0a; color: white; font-family: system-ui, sans-serif;
            display: flex; align-items: center; justify-content: center;
            height: 100vh; margin: 0;
        }
        .card {
            text-align: center; padding: 40px;
            background: #111; border: 1px solid ${color}33;
            border-radius: 16px; box-shadow: 0 0 40px ${color}22;
        }
        h1 { color: ${color}; font-size: 24px; margin-bottom: 8px; }
        p { color: #888; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>${icon} ${success ? 'Connected' : 'Failed'}</h1>
        <p>${message}</p>
        <p style="color:#555; font-size:11px; margin-top:16px;">This window will close automatically...</p>
    </div>
    <script>
        // Notify parent window (Settings UI) about the result
        if (window.opener) {
            window.opener.postMessage({
                type: 'OAUTH_CALLBACK',
                success: ${success},
                message: '${message.replace(/'/g, "\\'")}'
            }, '*');
        }
        setTimeout(() => window.close(), 2000);
    </script>
</body>
</html>`;
}

export default router;
