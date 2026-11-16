import {ownedHttpHandler} from '../../runtime/ownedHttpIngress';
import {retainAcquiredIdentity} from '../../../services/runtime/identityLifecycle';
// =============================================================================
// Identity Routes
// Authentication, setup, device recognition, and Google linking endpoints
// =============================================================================

import { Router, Request, Response } from 'express';
import { parseSessionCookie } from '../../middleware/authMiddleware';
import { hashPassword } from '../../utils/password';

// [FASE1] Browser features that cannot set headers (EventSource, <img>) carry
// the login session in this HttpOnly cookie; the x-session-id header keeps
// working for clients that can set it.
const SESSION_COOKIE_NAME = 'silhouette_session';
function setSessionCookie(res: Response, session: { id: string; expiresAt?: number }): void {
    const maxAge = session.expiresAt ? Math.max(0, session.expiresAt - Date.now()) : 30 * 24 * 60 * 60 * 1000;
    res.cookie(SESSION_COOKIE_NAME, session.id, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge,
    });
}

const router = Router();
interface PendingIdentityRepository {id:number;gitOwner:string|null;gitRepo:string|null;registrationUserId:string;
    state:'PENDING_EXACT_PLAN_AND_AUTHENTICATED_APPROVAL';parameters:'VALID_SHAPE_ONLY'|'UNVERIFIED';
    credentialsRetained:false;configurationChanged:false;effectsStarted:false;durable:false}
const pendingIdentityRepositories:PendingIdentityRepository[]=[];
function recordPendingIdentityRepository(owner:unknown,repo:unknown,registrationUserId:string){
    const valid=typeof owner==='string'&&typeof repo==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)&&/^[A-Za-z0-9._-]{1,100}$/.test(repo)&&repo!=='.'&&repo!=='..';
    const record:PendingIdentityRepository={id:pendingIdentityRepositories.length+1,gitOwner:valid?owner:null,gitRepo:valid?repo:null,registrationUserId,
        state:'PENDING_EXACT_PLAN_AND_AUTHENTICATED_APPROVAL',parameters:valid?'VALID_SHAPE_ONLY':'UNVERIFIED',
        credentialsRetained:false,configurationChanged:false,effectsStarted:false,durable:false};
    pendingIdentityRepositories.push(record);return {...record};
}
// PRIVATE source outcome accessor, NOT proof of repository ownership/approval.
export function getPendingIdentityRepositoryEffects(){return pendingIdentityRepositories.map(r=>({...r}));}


/** Strip secret fields (password hash) from a user object before returning it. */
function sanitizeUser<T extends { passwordHash?: string } | null | undefined>(user: T): T {
    if (!user) return user;
    const { passwordHash, ...safe } = user as any;
    return safe as T;
}

// GET /v1/identity/setup-status - Check if initial setup is needed
router.get('/setup-status', ownedHttpHandler('identity:GET:/setup-status',async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const hasUsers = identityService.hasAnyUsers();

        if (!hasUsers) {
            return res.json({ needsSetup: true, googleLinked: false });
        }

        // Check if the creator has Google linked
        const status = identityService.getStatus();
        return res.json({
            needsSetup: false,
            googleLinked: status.googleLinked,
            authenticated: status.authenticated
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// NOTE: The POST /setup route with email/password/name is defined below (line ~96)
// The fingerprint-based setup was legacy and has been removed to avoid shadowing.

// GET /v1/identity/status - Get current auth status
router.get('/status', ownedHttpHandler('identity:GET:/status',async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();
        return res.json(identityService.getStatus());
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// GET /v1/identity/is-setup - Check if the initial admin has been created
router.get('/is-setup', ownedHttpHandler('identity:GET:/is-setup',async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();
        return res.json({ isSetup: identityService.hasAnyUser() });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// POST /v1/identity/setup - First time admin registration
router.post('/setup', ownedHttpHandler('identity:POST:/setup',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Missing email, password, or name' });
        }

        // Repository/config capability remains pending, separate from identity.
        // No token is copied, hashed, logged, persisted or returned. No env/git/
        // fetch/child process is started by submitting setup fields.
        const repositoryRequested=!!(req.body.gitToken&&req.body.gitOwner&&req.body.gitRepo);

        // Salted scrypt hashing (see server/utils/password.ts)
        const passwordHash = hashPassword(password);

        const user = await identityService.registerInitialAdmin(email, passwordHash, name);

        // Auto-login after setup
        const fingerprint = req.headers['user-agent'] || 'unknown-device';
        const deviceName = 'Initial Setup Device';
        const device = identityService.registerDevice(user.id, fingerprint, deviceName, true);
        const session = identityService.createSession(user.id, device.id);
        setSessionCookie(res, session);

        const repositoryEffects=repositoryRequested?recordPendingIdentityRepository(req.body.gitOwner,req.body.gitRepo,user.id):undefined;
        return res.json({ success: true, user: sanitizeUser(user), session,
            ...(repositoryEffects?{repositoryEffects}:{}),registration:'COMPLETED_RETURN',repositoryCapability:'UNVERIFIED' });
    } catch (error: any) {
        return res.status(400).json({ error: error.message }); // 400 for bad request like "already setup"
    }
}));

// POST /v1/identity/login - Local password login
router.post('/login', ownedHttpHandler('identity:POST:/login',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Missing email or password' });
        }

        const user = await identityService.loginLocalVerify(email, password);

        if (user) {
            const fingerprint = req.headers['user-agent'] || 'unknown-device';
            const device = identityService.registerDevice(user.id, fingerprint, 'Browser Login', true);
            const session = identityService.createSession(user.id, device.id);
            setSessionCookie(res, session);
            return res.json({
                success: true,
                user: sanitizeUser(user),
                device,
                session,
                isCreator: user && user.role === 'CREATOR'
            });
        }

        return res.status(401).json({ success: false, error: 'Invalid email or password' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// POST /v1/identity/auto-login - Try auto-login with device fingerprint
router.post('/auto-login', ownedHttpHandler('identity:POST:/auto-login',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const { fingerprint } = req.body;

        if (!fingerprint) {
            return res.status(400).json({ error: 'Missing fingerprint' });
        }

        const user = await identityService.tryAutoLogin(fingerprint);

        if (user) {
            // Auto-login must issue a REAL session: previously this returned success
            // with no session and no cookie, so the SPA rendered authenticated while
            // every API call failed 401 (the UI looked frozen on return visits).
            const device = identityService.getDeviceByFingerprint(fingerprint);
            if (!device) {
                return res.status(401).json({ success: false, requiresLogin: true, needsSetup: false });
            }
            const session = identityService.createSession(user.id, device.id);
            setSessionCookie(res, session);

            return res.json({
                success: true,
                user: sanitizeUser(user),
                device,
                session,
                isCreator: user && user.role === 'CREATOR',
                googleLinked: user && user.googleLinked
            });
        }

        // If auto-login fails, tell the client whether setup is needed
        const needsSetup = !identityService.hasAnyUsers();
        return res.json({ success: false, requiresLogin: true, needsSetup });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// POST /v1/identity/register-device - Register current device as trusted
router.post('/register-device', ownedHttpHandler('identity:POST:/register-device',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { fingerprint, deviceName, trusted } = req.body;

        if (!fingerprint || !deviceName) {
            return res.status(400).json({ error: 'Missing fingerprint or deviceName' });
        }

        const device = identityService.registerDevice(
            user.id,
            fingerprint,
            deviceName,
            trusted !== false // Default to trusted
        );

        // Create session
        const session = identityService.createSession(user.id, device.id);
        setSessionCookie(res, session);

        return res.json({ success: true, device, session });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// GET /v1/identity/google-status - Check if Google is linked for current user
router.get('/google-status', ownedHttpHandler('identity:GET:/google-status',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const user = (req as any).user;
        if (!user) {
            return res.json({ linked: false, email: null });
        }

        const status = identityService.getUserGoogleStatus(user.id);
        return res.json(status);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// POST /v1/identity/logout - Logout current session
router.post('/logout', ownedHttpHandler('identity:POST:/logout',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        const sessionId = (req.headers['x-session-id'] as string) || parseSessionCookie(req.headers.cookie) || '';
        if (sessionId) {
            identityService.logoutSession(sessionId);
        } else {
            // Fallback to legacy logout
            identityService.logout();
        }
        res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// ─── Creator emails management (Settings UI) ───────────────────────────────
// These endpoints are protected by the Bearer-token auth middleware (they are
// not in PUBLIC_PATHS) AND require the current session user to be CREATOR.

// GET /v1/identity/creator-emails - List effective creator emails and their source
router.get('/creator-emails', ownedHttpHandler('identity:GET:/creator-emails',async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const status = identityService.getStatus();
        if (!status.isCreator) {
            return res.status(403).json({ error: 'Only the CREATOR can manage creator emails' });
        }

        const envEmails = identityService.getEnvCreatorEmails();
        const configured = identityService.getConfiguredCreatorEmails();
        return res.json({
            success: true,
            emails: identityService.getCreatorEmails(),
            envEmails,
            configured
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

// POST /v1/identity/creator-emails - Add a creator email (persisted in system config)
router.post('/creator-emails', ownedHttpHandler('identity:POST:/creator-emails',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const status = identityService.getStatus();
        if (!status.isCreator) {
            return res.status(403).json({ error: 'Only the CREATOR can manage creator emails' });
        }

        const { email } = req.body;
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Missing email' });
        }

        const configured = identityService.addCreatorEmail(email);
        return res.json({
            success: true,
            emails: identityService.getCreatorEmails(),
            configured
        });
    } catch (error: any) {
        return res.status(400).json({ error: error.message });
    }
}));

// DELETE /v1/identity/creator-emails/:email - Remove a user-configured creator email
router.delete('/creator-emails/:email', ownedHttpHandler('identity:DELETE:/creator-emails/:email',async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        retainAcquiredIdentity(identityService);
        await identityService.init();

        const status = identityService.getStatus();
        if (!status.isCreator) {
            return res.status(403).json({ error: 'Only the CREATOR can manage creator emails' });
        }

        const email = decodeURIComponent(req.params.email || '');
        if (identityService.getEnvCreatorEmails().map(e => e.toLowerCase()).includes(email.toLowerCase())) {
            return res.status(409).json({
                error: 'This email comes from the CREATOR_EMAILS environment variable. Remove it from the env config instead.'
            });
        }

        const removed = identityService.removeCreatorEmail(email);
        if (!removed) {
            return res.status(404).json({ error: 'Email not found in the configured creator emails' });
        }
        return res.json({
            success: true,
            emails: identityService.getCreatorEmails(),
            configured: identityService.getConfiguredCreatorEmails()
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}));

export default router;
