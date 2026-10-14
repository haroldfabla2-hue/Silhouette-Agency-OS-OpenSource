import { Router } from 'express';
import { selfCodeService } from '../../../services/selfCodeService';

/**
 * SELF-CODE ROUTES - F2 Self-Code Toolkit
 *
 * Agents read/write their own source inside an isolated git worktree only.
 * No commits, no pushes, no restarts, no writes to the running tree.
 * Every write requires a rationale and is journaled (append-only).
 */

const router = Router();

function fail(res: any, status: number, error: string) {
    return res.status(status).json({ error });
}

// POST /v1/self/code/read { path }
router.post('/read', async (req, res) => {
    try {
        const result = await selfCodeService.readFile(req.body?.path);
        res.json(result);
    } catch (error: any) {
        const msg = error.message || 'read failed';
        fail(res, /not found/.test(msg) ? 404 : 400, msg);
    }
});

// POST /v1/self/code/write { path, content, rationale }
router.post('/write', async (req, res) => {
    try {
        const { path: p, content, rationale } = req.body || {};
        if (typeof content !== 'string') return fail(res, 400, 'content must be a string');
        const result = await selfCodeService.writeFile(p, content, rationale);
        res.json(result);
    } catch (error: any) {
        fail(res, 400, error.message || 'write failed');
    }
});

// GET /v1/self/code/diff
router.get('/diff', async (req, res) => {
    try {
        res.json(await selfCodeService.diff());
    } catch (error: any) {
        fail(res, 500, error.message || 'diff failed');
    }
});

// POST /v1/self/code/test { target }
router.post('/test', async (req, res) => {
    try {
        const result = await selfCodeService.runTest(req.body?.target);
        res.json(result);
    } catch (error: any) {
        fail(res, 400, error.message || 'test failed');
    }
});

// GET /v1/self/code/journal?limit=N
router.get('/journal', (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        res.json({ entries: selfCodeService.journalEntries(limit) });
    } catch (error: any) {
        fail(res, 500, error.message || 'journal failed');
    }
});

export default router;
