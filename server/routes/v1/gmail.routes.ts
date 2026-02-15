// =============================================================================
// Gmail Routes
// Email API endpoints
// =============================================================================

import { Router, Request, Response } from 'express';

const router = Router();

// GET /v1/gmail/inbox - List inbox emails
router.get('/inbox', async (req: Request, res: Response) => {
    try {
        const { gmailService } = await import('../../../services/gmailService');
        await gmailService.init();

        if (!gmailService.isReady()) {
            return res.status(401).json({ error: 'Gmail not connected. Please authenticate with Google first.' });
        }

        const limit = parseInt(req.query.limit as string) || 20;
        const query = req.query.q as string | undefined;

        const emails = query
            ? await gmailService.searchEmails(query, limit)
            : await gmailService.getInbox(limit);

        return res.json({ emails, count: emails.length });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/gmail/messages/:id - Get single email
router.get('/messages/:id', async (req: Request, res: Response) => {
    try {
        const { gmailService } = await import('../../../services/gmailService');
        await gmailService.init();

        if (!gmailService.isReady()) {
            return res.status(401).json({ error: 'Gmail not connected' });
        }

        const email = await gmailService.getMessage(req.params.id);

        if (!email) {
            return res.status(404).json({ error: 'Email not found' });
        }

        return res.json({ email });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/gmail/send - Send email
router.post('/send', async (req: Request, res: Response) => {
    try {
        const { gmailService } = await import('../../../services/gmailService');
        await gmailService.init();

        if (!gmailService.isReady()) {
            return res.status(401).json({ error: 'Gmail not connected' });
        }

        const { to, subject, body, isHtml, driveLink } = req.body;

        if (!to || !subject || !body) {
            return res.status(400).json({ error: 'Missing to, subject, or body' });
        }

        const result = await gmailService.sendEmail({ to, subject, body, isHtml, driveLink });

        if (result.success) {
            return res.json({ success: true, messageId: result.messageId });
        } else {
            return res.status(500).json({ error: result.error });
        }
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/gmail/mark-read/:id - Mark email as read
router.post('/mark-read/:id', async (req: Request, res: Response) => {
    try {
        const { gmailService } = await import('../../../services/gmailService');
        await gmailService.init();

        if (!gmailService.isReady()) {
            return res.status(401).json({ error: 'Gmail not connected' });
        }

        const success = await gmailService.markAsRead(req.params.id);

        return res.json({ success });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/gmail/unread-count - Get unread email count
router.get('/unread-count', async (_req: Request, res: Response) => {
    try {
        const { gmailService } = await import('../../../services/gmailService');
        await gmailService.init();

        if (!gmailService.isReady()) {
            return res.json({ count: 0, connected: false });
        }

        const count = await gmailService.getUnreadCount();

        return res.json({ count, connected: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/gmail/status - Check Gmail connection status
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const { gmailService } = await import('../../../services/gmailService');
        await gmailService.init();

        return res.json({
            connected: gmailService.isReady(),
            unreadCount: gmailService.getCachedUnreadCount()
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
