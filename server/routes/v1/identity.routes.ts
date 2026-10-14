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

/** Strip secret fields (password hash) from a user object before returning it. */
function sanitizeUser<T extends { passwordHash?: string } | null | undefined>(user: T): T {
    if (!user) return user;
    const { passwordHash, ...safe } = user as any;
    return safe as T;
}

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

        const { email, password, name, gitToken, gitOwner, gitRepo } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Missing email, password, or name' });
        }

        // [PHASE 6 & 7] Write Auto-Evolution Config to .env.local and Create GitHub Repo Clone
        if (gitToken && gitOwner && gitRepo) {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const envPath = path.join(process.cwd(), '.env.local');

                let envContent = '';
                if (fs.existsSync(envPath)) {
                    envContent = fs.readFileSync(envPath, 'utf8');
                }

                // Clean existing git keys if present to avoid duplicates
                envContent = envContent.replace(/^GITHUB_TOKEN=.*$/gm, '')
                    .replace(/^GITHUB_REPO_OWNER=.*$/gm, '')
                    .replace(/^GITHUB_REPO_NAME=.*$/gm, '');

                // Ensure ends with newline
                if (envContent && !envContent.endsWith('\n')) envContent += '\n';

                // Append the new keys
                envContent += `GITHUB_TOKEN=${gitToken}\n`;
                envContent += `GITHUB_REPO_OWNER=${gitOwner}\n`;
                envContent += `GITHUB_REPO_NAME=${gitRepo}\n`;

                fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
                console.log(`[IDENTITY_ROUTER] 💾 Auto-Evolution config explicitly saved to .env.local for ${gitOwner}/${gitRepo}`);

                // [PHASE 7] True Auto-Evolution Clone Generation
                // 1. Check if the repo exists or create it dynamically in the user's cloud
                console.log(`[IDENTITY_ROUTER] 🚀 Initiating GitHub Auto-Evolution Clone Sequence...`);

                // We do this asynchronously to avoid hanging the Setup UI request for too long
                setImmediate(async () => {
                    try {
                        const repoUrl = `https://api.github.com/repos/${gitOwner}/${gitRepo}`;
                        let repoCreated = false;

                        const checkRes = await fetch(repoUrl, {
                            headers: { 'Authorization': `Bearer ${gitToken}` }
                        });

                        if (checkRes.status === 404) {
                            console.log(`[IDENTITY_ROUTER] ☁️ Repository ${gitRepo} not found. Creating Private OS Clone...`);
                            const createRes = await fetch('https://api.github.com/user/repos', {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${gitToken}`,
                                    'Content-Type': 'application/json',
                                    'Accept': 'application/vnd.github.v3+json'
                                },
                                body: JSON.stringify({
                                    name: gitRepo,
                                    private: true,
                                    description: 'Silhouette Agency OS Auto-Evolution Clone'
                                })
                            });

                            if (!createRes.ok) {
                                throw new Error(`GitHub API Error: ${createRes.statusText}`);
                            }
                            repoCreated = true;
                            console.log(`[IDENTITY_ROUTER] ✅ Successfully created private GitHub repository: ${gitRepo}`);
                        } else {
                            console.log(`[IDENTITY_ROUTER] ☁️ Repository ${gitRepo} already exists. Linking OS to existing repo.`);
                            repoCreated = true;
                        }

                        // 2. Perform local git reconfiguration and force push everything up
                        if (repoCreated) {
                            const { exec } = await import('child_process');
                            const gitOrigin = `https://${gitToken}@github.com/${gitOwner}/${gitRepo}.git`;
                            console.log(`[IDENTITY_ROUTER] 📦 Packing local OS Brain & uploading to remote cloning matrix...`);

                            // Ensure it's a git repo, swap the origin, stage all, commit if needed, and push.
                            const gitScript = `
                                git init &&
                                git remote remove origin || echo "No origin to remove" &&
                                git remote add origin ${gitOrigin} &&
                                git branch -M main &&
                                git add . &&
                                git commit -m "chore(seed): initial agent OS clone injection" || echo "No changes to commit" &&
                                git push -u origin main --force
                            `.trim().replace(/\n/g, ' ');

                            exec(gitScript, { cwd: process.cwd() }, (error, stdout, stderr) => {
                                if (error) {
                                    console.error(`[IDENTITY_ROUTER] ❌ Auto-Evolution OS Seed Error:`, error.message);
                                    return;
                                }
                                console.log(`[IDENTITY_ROUTER] 🎉 SUCCESS: The Agent OS Brain has been fully uploaded/linked to the private cloud!`);
                            });
                        }
                    } catch (asyncErr) {
                        console.error('[IDENTITY_ROUTER] ❌ Fatal error during GitHub Auto-Evolution Clone Sequence:', asyncErr);
                    }
                });

            } catch (fsErr) {
                console.error('[IDENTITY_ROUTER] ❌ Failed to write Auto-Evolution config to .env.local:', fsErr);
                // Non-fatal, let the setup continue
            }
        }

        // Salted scrypt hashing (see server/utils/password.ts)
        const passwordHash = hashPassword(password);

        const user = await identityService.registerInitialAdmin(email, passwordHash, name);

        // Auto-login after setup
        const fingerprint = req.headers['user-agent'] || 'unknown-device';
        const deviceName = 'Initial Setup Device';
        const device = identityService.registerDevice(user.id, fingerprint, deviceName, true);
        const session = identityService.createSession(user.id, device.id);
        setSessionCookie(res, session);

        return res.json({ success: true, user: sanitizeUser(user), session });
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
});

// POST /v1/identity/auto-login - Try auto-login with device fingerprint
router.post('/auto-login', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// POST /v1/identity/register-device - Register current device as trusted
router.post('/register-device', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// GET /v1/identity/google-status - Check if Google is linked for current user
router.get('/google-status', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// POST /v1/identity/logout - Logout current session
router.post('/logout', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// ─── Creator emails management (Settings UI) ───────────────────────────────
// These endpoints are protected by the Bearer-token auth middleware (they are
// not in PUBLIC_PATHS) AND require the current session user to be CREATOR.

// GET /v1/identity/creator-emails - List effective creator emails and their source
router.get('/creator-emails', async (_req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// POST /v1/identity/creator-emails - Add a creator email (persisted in system config)
router.post('/creator-emails', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

// DELETE /v1/identity/creator-emails/:email - Remove a user-configured creator email
router.delete('/creator-emails/:email', async (req: Request, res: Response) => {
    try {
        const { identityService } = await import('../../../services/identityService');
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
});

export default router;
