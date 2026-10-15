/**
 * Visual Cortex routes — local composition/edition engine (PhotoCraft).
 * Auth: global middleware (Bearer), same as the rest of /v1.
 * Honest availability: 503 UNAVAILABLE when the engine binary is not installed.
 */
import { Router, Request, Response } from 'express';
import { visualService } from '../../../services/visualService';

const router = Router();

// GET /v1/visual/health — engine presence + registry size
router.get('/health', async (_req: Request, res: Response) => {
    try {
        if (!visualService.isAvailable()) {
            return res.status(503).json({ available: false, error: 'PhotoCraft binary not installed. Visual composition UNAVAILABLE.' });
        }
        const cmds = await visualService.listCommands();
        return res.json({ available: true, engine: 'photocraft-cli', commands: cmds.ok ? cmds.data.count : null });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// GET /v1/visual/commands?filter=type — discover engine commands (for the ente and the UI)
router.get('/commands', async (req: Request, res: Response) => {
    const result = await visualService.listCommands(req.query.filter as string | undefined);
    const status = result.unavailable ? 503 : result.ok ? 200 : 400;
    return res.status(status).json(result.ok ? result.data : { error: result.error, unavailable: result.unavailable });
});

// POST /v1/visual/execute — arbitrary validated engine commands ("hacer lo que requiera")
// body: { command?, params?, steps?[], doc?, newDoc?, out? }
router.post('/execute', async (req: Request, res: Response) => {
    const result = await visualService.execute(req.body || {});
    const status = result.unavailable ? 503 : result.ok ? 200 : 400;
    return res.status(status).json(result.ok ? { success: true, ...result.data } : { success: false, error: result.error, unavailable: result.unavailable });
});

// POST /v1/visual/compose — high-level composition spec → exported file
// body: { width, height, background?, texts?[], images?[], adjustments?[], out }
router.post('/compose', async (req: Request, res: Response) => {
    const result = await visualService.compose(req.body || {});
    const status = result.unavailable ? 503 : result.ok ? 200 : 400;
    return res.status(status).json(result.ok ? { success: true, ...result.data } : { success: false, error: result.error, unavailable: result.unavailable });
});

// POST /v1/visual/convert — format conversion { in, out, quality? }
router.post('/convert', async (req: Request, res: Response) => {
    const { in: input, out, quality } = req.body || {};
    if (!input || !out) return res.status(400).json({ success: false, error: 'in and out are required' });
    const result = await visualService.convert(input, out, quality);
    const status = result.unavailable ? 503 : result.ok ? 200 : 400;
    return res.status(status).json(result.ok ? { success: true, ...result.data } : { success: false, error: result.error, unavailable: result.unavailable });
});

// GET /v1/visual/info?file=... — document inspection
router.get('/info', async (req: Request, res: Response) => {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: 'file query param is required' });
    const result = await visualService.info(file);
    const status = result.unavailable ? 503 : result.ok ? 200 : 400;
    return res.status(status).json(result.ok ? result.data : { error: result.error, unavailable: result.unavailable });
});

export default router;
