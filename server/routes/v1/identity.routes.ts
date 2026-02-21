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

// POST /v1/identity/setup - First-time setup (creates CREATOR user)
router.post('/setup', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
        await identityService.init();

        const { name, fingerprint, deviceName } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }

        if (!fingerprint) {
            return res.status(400).json({ error: 'Device fingerprint is required' });
        }

        if (identityService.hasAnyUsers()) {
            return res.status(409).json({ error: 'Setup already completed' });
        }

        const result = identityService.setupFirstUser(
            name.trim(),
            fingerprint,
            deviceName || 'Browser'
        );

        return res.json({
            success: true,
            user: result.user,
            device: result.device,
            session: result.session,
            isCreator: true,
            googleLinked: false
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

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
