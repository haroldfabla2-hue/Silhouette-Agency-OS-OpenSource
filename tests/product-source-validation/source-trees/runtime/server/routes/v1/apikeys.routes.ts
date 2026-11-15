/**
 * API KEYS ROUTES
 * ═══════════════════════════════════════════════════════════════
 * Admin-only endpoints for managing MCP API keys.
 * 
 * All routes require admin authentication via X-Admin-Password header.
 */

import { Router, Request, Response } from 'express';
import { apiKeyService, ApiKeyPermission } from '../../../services/apiKeyService';

const router = Router();

// ==================== MIDDLEWARE ====================

/**
 * Verify admin password for all routes
 */
const requireAdmin = (req: Request, res: Response, next: () => void) => {
    const adminPassword = req.headers['x-admin-password'] as string;

    if (!adminPassword) {
        res.status(401).json({ error: 'Admin password required (X-Admin-Password header)' });
        return;
    }

    // First time setup
    if (!apiKeyService.isAdminConfigured()) {
        // Set the password for first time
        apiKeyService.setAdminPassword(adminPassword);
        console.log('[API Keys] 🔐 First-time admin password configured');
        next();
        return;
    }

    if (!apiKeyService.verifyAdminPassword(adminPassword)) {
        res.status(403).json({ error: 'Invalid admin password' });
        return;
    }

    next();
};

// Apply admin middleware to all routes
router.use(requireAdmin);

// ==================== ROUTES ====================

/**
 * GET /api/v1/admin/api-keys
 * List all API keys (without revealing the actual keys)
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const keys = apiKeyService.listKeys();
        const stats = apiKeyService.getStats();
        res.json({ keys, stats });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/v1/admin/api-keys
 * Create a new API key
 * Body: { name: string, permissions: string[], expiresInDays?: number }
 */
router.post('/', (req: Request, res: Response) => {
    try {
        const { name, permissions, expiresInDays } = req.body;

        if (!name || !permissions || !Array.isArray(permissions)) {
            res.status(400).json({
                error: 'Missing required fields',
                required: {
                    name: 'string',
                    permissions: ['tools:read', 'tools:execute', 'resources:read', 'admin:full']
                }
            });
            return;
        }

        // Validate permissions
        const validPermissions: ApiKeyPermission[] = ['tools:read', 'tools:execute', 'resources:read', 'admin:full'];
        const invalidPerms = permissions.filter((p: string) => !validPermissions.includes(p as ApiKeyPermission));
        if (invalidPerms.length > 0) {
            res.status(400).json({
                error: `Invalid permissions: ${invalidPerms.join(', ')}`,
                validPermissions
            });
            return;
        }

        const result = apiKeyService.createApiKey(
            { name, permissions, expiresInDays },
            'admin' // Admin user ID
        );

        res.status(201).json({
            success: true,
            message: 'API key created. Save this key - it cannot be retrieved again!',
            id: result.id,
            key: result.key,
            name
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/v1/admin/api-keys/:id
 * Revoke an API key
 */
router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = apiKeyService.revokeKey(id);

        if (success) {
            res.json({ success: true, message: 'API key revoked' });
        } else {
            res.status(404).json({ error: 'API key not found' });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/v1/admin/api-keys/:id/permanent
 * Permanently delete an API key
 */
router.delete('/:id/permanent', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = apiKeyService.deleteKey(id);

        if (success) {
            res.json({ success: true, message: 'API key permanently deleted' });
        } else {
            res.status(404).json({ error: 'API key not found' });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/v1/admin/api-keys/change-password
 * Change admin password
 * Body: { newPassword: string }
 */
router.post('/change-password', (req: Request, res: Response) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            res.status(400).json({ error: 'Password must be at least 8 characters' });
            return;
        }

        apiKeyService.setAdminPassword(newPassword);
        res.json({ success: true, message: 'Admin password changed' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
