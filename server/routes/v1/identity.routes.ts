// =============================================================================
// Identity Routes
// Authentication and device recognition endpoints
// =============================================================================

import { Router, Request, Response } from 'express';

const router = Router();

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
                isCreator: identityService.isCreator()
            });
        }

        return res.json({ success: false, requiresLogin: true });
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
