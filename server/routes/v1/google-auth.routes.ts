// =============================================================================
// GOOGLE AUTH ROUTES
// Initiates OAuth2 flow for Google Workspace integration.
// The callback is handled by the existing /oauth/callback route.
// =============================================================================

import { Router, Request, Response } from 'express';
import { sqliteService } from '../../../services/sqliteService';

const router = Router();

// All Google Workspace scopes organized by service
const GOOGLE_SCOPES: Record<string, string[]> = {
    calendar: ['https://www.googleapis.com/auth/calendar'],
    drive: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.readonly',
    ],
    gmail: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
    ],
    docs: ['https://www.googleapis.com/auth/documents'],
    sheets: ['https://www.googleapis.com/auth/spreadsheets'],
    slides: ['https://www.googleapis.com/auth/presentations'],
    forms: ['https://www.googleapis.com/auth/forms.body'],
    places: ['https://www.googleapis.com/auth/cloud-platform'], // Places API uses API key, but scope needed for billing
};

/**
 * GET /v1/google-auth/start?services=calendar,drive,gmail
 * 
 * Generates an OAuth2 authorization URL and redirects the user to Google's
 * consent screen. Query param `services` is a comma-separated list of
 * Google Workspace services to request access for.
 * 
 * If no services are specified, requests all available scopes.
 */
router.get('/start', (req: Request, res: Response) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return res.status(400).json({
                error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local',
            });
        }

        // Parse requested services
        const servicesParam = (req.query.services as string) || '';
        const requestedServices = servicesParam
            ? servicesParam.split(',').map(s => s.trim().toLowerCase())
            : Object.keys(GOOGLE_SCOPES);

        // Build scopes
        const scopes: string[] = ['openid', 'email', 'profile'];
        for (const service of requestedServices) {
            if (GOOGLE_SCOPES[service]) {
                scopes.push(...GOOGLE_SCOPES[service]);
            }
        }

        const redirectUri = `${req.protocol}://${req.get('host')}/oauth/callback`;
        const state = Buffer.from(JSON.stringify({
            serviceId: 'google-workspace',
            redirectUri,
        })).toString('base64');

        // Store OAuth config for the callback handler
        sqliteService.setConfig('oauthConfig_google-workspace', {
            tokenUrl: 'https://oauth2.googleapis.com/token',
            clientId,
            clientSecret,
            redirectUri,
        });

        // Build Google OAuth2 URL
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', [...new Set(scopes)].join(' '));
        authUrl.searchParams.set('access_type', 'offline'); // Get refresh token
        authUrl.searchParams.set('prompt', 'consent');
        authUrl.searchParams.set('state', state);

        return res.redirect(authUrl.toString());
    } catch (err: any) {
        console.error('[GoogleAuth] Start error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * GET /v1/google-auth/status
 * 
 * Returns the current OAuth2 connection status for Google Workspace.
 */
router.get('/status', (_req: Request, res: Response) => {
    try {
        const secrets = sqliteService.getConfig('secretsVault_google-workspace');
        const connected = !!secrets?.oauthConnected;
        const expiresAt = secrets?.expiresAt;
        const expired = expiresAt ? Date.now() > expiresAt : false;

        return res.json({
            connected,
            expired,
            connectedAt: secrets?.oauthConnectedAt,
            expiresAt,
            scope: secrets?.scope,
            hasRefreshToken: !!secrets?.refreshToken,
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /v1/google-auth/refresh
 * 
 * Refreshes the Google access token using the stored refresh token.
 */
router.post('/refresh', async (_req: Request, res: Response) => {
    try {
        const secrets = sqliteService.getConfig('secretsVault_google-workspace');
        if (!secrets?.refreshToken) {
            return res.status(400).json({ error: 'No refresh token available. Re-authorize via /start.' });
        }

        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: secrets.refreshToken,
                client_id: clientId!,
                client_secret: clientSecret!,
            }).toString(),
        });

        if (!tokenResponse.ok) {
            const err = await tokenResponse.text();
            return res.status(400).json({ error: 'Token refresh failed', details: err });
        }

        const tokens = await tokenResponse.json();
        sqliteService.setConfig('secretsVault_google-workspace', {
            ...secrets,
            accessToken: tokens.access_token,
            expiresAt: Date.now() + (tokens.expires_in * 1000),
            scope: tokens.scope || secrets.scope,
        });

        return res.json({ success: true, expiresAt: Date.now() + (tokens.expires_in * 1000) });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

export default router;
