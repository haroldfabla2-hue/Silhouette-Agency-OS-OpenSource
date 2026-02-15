// =============================================================================
// Google Drive Routes
// OAuth2 authentication and Drive API endpoints
// =============================================================================

import { Router, Request, Response } from 'express';

const router = Router();

// ==================== OAUTH FLOW ====================

// GET /v1/drive/auth - Start OAuth flow (redirect to Google)
router.get('/auth', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        // Pass fingerprint from state param to preserve through OAuth flow
        const state = req.query.state as string | undefined;
        const authUrl = driveService.getAuthUrl(state);
        return res.redirect(authUrl);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/drive/callback - OAuth callback (Google redirects here)
router.get('/callback', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        const { identityService } = await import('../../../services/identityService');
        const code = req.query.code as string;
        const fingerprint = req.query.state as string; // Pass fingerprint via state param

        if (!code) {
            return res.status(400).send('Missing authorization code');
        }

        const result = await driveService.handleCallback(code);

        if (result.success && result.email) {
            // Initialize identity service and create/update user
            await identityService.init();

            const user = await identityService.upsertUser({
                email: result.email,
                name: result.email.split('@')[0], // Use email prefix as name
                avatarUrl: undefined
            });

            // If fingerprint provided, register device
            if (fingerprint) {
                const device = identityService.registerDevice(
                    user.id,
                    fingerprint,
                    'Browser', // Default name, can be updated later
                    true
                );
                identityService.createSession(user.id, device.id);
            }

            const isCreator = identityService.isCreator();

            // Redirect to frontend with success message
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Google Drive Connected</title></head>
                <body style="background:#1a1a2e;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
                    <div style="text-align:center;padding:2rem;background:#16213e;border-radius:1rem;box-shadow:0 0 20px rgba(0,255,255,0.2);">
                        <h1 style="color:#00ffff;">✅ Connected!</h1>
                        <p>Google Drive linked as <strong>${result.email}</strong></p>
                        ${isCreator ? '<p style="color:#ffd700;">👑 Creator Mode Active</p>' : ''}
                        <p style="color:#888;font-size:0.9rem;">You can close this window.</p>
                        <script>
                            window.opener?.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', email: '${result.email}', isCreator: ${isCreator} }, '*');
                            setTimeout(() => window.close(), 2000);
                        </script>
                    </div>
                </body>
                </html>
            `);
        } else {
            return res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Connection Failed</title></head>
                <body style="background:#1a1a2e;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
                    <div style="text-align:center;padding:2rem;background:#16213e;border-radius:1rem;">
                        <h1 style="color:#ff4444;">❌ Failed</h1>
                        <p>${result.error}</p>
                    </div>
                </body>
                </html>
            `);
        }
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});


// GET /v1/drive/status - Check auth status
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        const isAuthenticated = driveService.isAuthenticated();
        const email = driveService.getCurrentUser();

        return res.json({
            authenticated: isAuthenticated,
            email: email || null
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/drive/revoke - Revoke access
router.post('/revoke', async (_req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.revoke();
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== FILE OPERATIONS ====================

// GET /v1/drive/files - List files
router.get('/files', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        const query = req.query.query as string | undefined;
        const mimeType = req.query.mimeType as string | undefined;
        const folderId = req.query.folderId as string | undefined;
        const pageSize = req.query.limit ? parseInt(req.query.limit as string) : 50;

        const files = await driveService.listFiles({ query, mimeType, folderId, pageSize });
        return res.json({ files });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/drive/upload - Upload file (expects JSON with filePath)
router.post('/upload', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        const fs = await import('fs/promises');
        await driveService.init();

        const { name, mimeType, filePath, folderId } = req.body;

        if (!name || !filePath) {
            return res.status(400).json({ error: 'Missing name or filePath' });
        }

        // Read file content from disk
        const content = await fs.readFile(filePath);

        const file = await driveService.uploadContent(
            content,
            name,
            mimeType || 'application/octet-stream',
            folderId
        );

        if (!file) {
            return res.status(500).json({ error: 'Upload failed' });
        }

        return res.json({ success: true, file });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/drive/upload-content - Upload content directly from browser (JSON body)
router.post('/upload-content', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        if (!driveService.isAuthenticated()) {
            return res.status(401).json({ error: 'Not authenticated with Google Drive' });
        }

        const { content, fileName, mimeType, folderId } = req.body;

        if (!content || !fileName) {
            return res.status(400).json({ error: 'Missing content or fileName' });
        }

        const file = await driveService.uploadContent(
            content,
            fileName,
            mimeType || 'application/json',
            folderId // Will use GOOGLE_DRIVE_FOLDER_ID if not provided
        );

        if (!file) {
            return res.status(500).json({ error: 'Upload failed' });
        }

        return res.json({ success: true, file });
    } catch (error: any) {
        console.error('[Drive] Upload content error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/drive/files/:id/download - Download file
router.get('/files/:id/download', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        const fileId = req.params.id;
        const destPath = req.query.destPath as string;

        if (!destPath) {
            return res.status(400).json({ error: 'Missing destPath query param' });
        }

        const success = await driveService.downloadFile(fileId, destPath);

        if (!success) {
            return res.status(500).json({ error: 'Download failed' });
        }

        return res.json({ success: true, path: destPath });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// DELETE /v1/drive/files/:id - Delete file
router.delete('/files/:id', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        const success = await driveService.deleteFile(req.params.id);

        if (!success) {
            return res.status(500).json({ error: 'Delete failed' });
        }

        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/drive/folder - Create folder
router.post('/folder', async (req: Request, res: Response) => {
    try {
        const { driveService } = await import('../../../services/driveService');
        await driveService.init();

        const { name, parentId } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Missing folder name' });
        }

        const folderId = await driveService.createFolder(name, parentId);

        if (!folderId) {
            return res.status(500).json({ error: 'Folder creation failed' });
        }

        return res.json({ success: true, folderId });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
