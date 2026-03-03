// =============================================================================
// Identity Routes
// Authentication, setup, device recognition, and Google linking endpoints
// =============================================================================

import { Router, Request, Response } from 'express';

const router = Router();

// GET /v1/identity/setup-status - Check if initial setup is needed
router.get('/setup-status', async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// NOTE: The POST /setup route with email/password/name is defined below (line ~96)
// The fingerprint-based setup was legacy and has been removed to avoid shadowing.

// GET /v1/identity/status - Get current auth status
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();
        return res.json(identityService.getStatus());
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/identity/is-setup - Check if the initial admin has been created
router.get('/is-setup', async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();
        return res.json({ isSetup: identityService.hasAnyUser() });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/identity/setup - First time admin registration
router.post('/setup', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();

        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Missing email, password, or name' });
        }

        // Extremely simple hashing for demonstration (use bcrypt in production)
        const crypto = await import('crypto');
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

        const user = await identityService.registerInitialAdmin(email, passwordHash, name);

        // Auto-login after setup
        const fingerprint = req.headers['user-agent'] || 'unknown-device';
        const deviceName = 'Initial Setup Device';
        const device = identityService.registerDevice(user.id, fingerprint, deviceName, true);
        const session = identityService.createSession(user.id, device.id);

        return res.json({ success: true, user, session });
    } catch (error: any) {
        return res.status(400).json({ error: error.message }); // 400 for bad request like "already setup"
    }
});

// POST /v1/identity/login - Local password login
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Missing email or password' });
        }

        const crypto = await import('crypto');
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

        const user = await identityService.loginLocal(email, passwordHash);

        if (user) {
            const fingerprint = req.headers['user-agent'] || 'unknown-device';
            const device = identityService.registerDevice(user.id, fingerprint, 'Browser Login', true);
            const session = identityService.createSession(user.id, device.id);

            return res.json({
                success: true,
                user,
                device,
                session,
                isCreator: identityService.isCreator()
            });
        }

        return res.status(401).json({ success: false, error: 'Invalid email or password' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/identity/auto-login - Try auto-login with device fingerprint
router.post('/auto-login', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();

        const { fingerprint, deviceName } = req.body;

        if (!fingerprint) {
            return res.status(400).json({ error: 'Missing fingerprint' });
        }

        const user = await identityService.tryAutoLogin(fingerprint);

        if (user) {
            return res.json({
                success: true,
                user,
                device: identityService.getCurrentDevice(),
                isCreator: identityService.isCreator(),
                googleLinked: identityService.isGoogleLinked()
            });
        }

        // If auto-login fails, tell the client whether setup is needed
        const needsSetup = !identityService.hasAnyUsers();
        return res.json({ success: false, requiresLogin: true, needsSetup });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/identity/register-device - Register current device as trusted
router.post('/register-device', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();

        const user = identityService.getCurrentUser();
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

        return res.json({ success: true, device, session });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/identity/google-status - Check if Google is linked for current user
router.get('/google-status', async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();

        const user = identityService.getCurrentUser();
        if (!user) {
            return res.json({ linked: false, email: null });
        }

        const status = identityService.getUserGoogleStatus(user.id);
        return res.json(status);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/identity/logout - Logout current session
router.post('/logout', async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        identityService.logout();
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
