import { Router } from 'express';
import { commandExecService } from '../../../services/commandExecService';

/**
 * SELF-EXEC ROUTES - F3 Command Execution (real OS isolation)
 *
 * Tier 1 (read-only whitelist): runs immediately inside bubblewrap.
 * Tier 2: requires explicit operator approval per action.
 * Rejected outright: destructive, service control, network, installs (F4).
 * If bubblewrap is missing the service reports UNAVAILABLE - it never
 * degrades to an unsafe runner.
 */

const router = Router();

// POST /v1/self/exec/run { command, args?, timeoutMs? }
router.post('/run', async (req, res) => {
    try {
        const { command, args, timeoutMs } = req.body || {};
        if (typeof command !== 'string' || !command.trim()) {
            return res.status(400).json({ error: 'command must be a non-empty string' });
        }
        const safeArgs = Array.isArray(args) ? args.filter((a: any) => typeof a === 'string') : [];
        const rec = await commandExecService.requestExecution(command.trim(), safeArgs, timeoutMs);
        const status = rec.status === 'executed' ? 200
            : rec.status === 'pending_approval' ? 202
            : rec.status === 'unavailable' ? 503
            : 403;
        res.status(status).json(rec);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'execution failed' });
    }
});

// GET /v1/self/exec/pending
router.get('/pending', (_req, res) => {
    res.json({ pending: commandExecService.pendingApprovals() });
});

// POST /v1/self/exec/approve { id, approvedBy }
router.post('/approve', async (req, res) => {
    try {
        const { id, approvedBy, timeoutMs } = req.body || {};
        if (!id || !approvedBy) return res.status(400).json({ error: 'id and approvedBy are required' });
        const rec = await commandExecService.approve(id, String(approvedBy), timeoutMs);
        if (!rec) return res.status(404).json({ error: 'no pending execution with that id' });
        res.status(rec.status === 'executed' ? 200 : 503).json(rec);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'approval failed' });
    }
});

// POST /v1/self/exec/reject { id, approvedBy }
router.post('/reject', (req, res) => {
    const { id, approvedBy } = req.body || {};
    if (!id || !approvedBy) return res.status(400).json({ error: 'id and approvedBy are required' });
    const rec = commandExecService.reject(id, String(approvedBy));
    if (!rec) return res.status(404).json({ error: 'no pending execution with that id' });
    res.json(rec);
});

// GET /v1/self/exec/journal?limit=N
router.get('/journal', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ entries: commandExecService.journalEntries(limit) });
});

// GET /v1/self/exec/isolation - is real OS isolation available?
router.get('/isolation', async (_req, res) => {
    res.json(await commandExecService.isolationStatus());
});

export default router;
