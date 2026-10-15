/**
 * Visual Cortex routes — local composition/edition engine (PhotoCraft).
 * Auth: global middleware (Bearer), same as the rest of /v1.
 * Honest availability: 503 UNAVAILABLE when the engine binary is not installed.
 */
import express, { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { visualService, confinePath } from '../../../services/visualService';

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

// --- WORKSPACE BRIDGE (for the embedded editor: open from / save to the Silhouette workspace) ---

const WORKSPACE = process.env.VISUAL_WORKSPACE_ROOT || '/opt/silhouette/workspace';
const OPENABLE = new Set(['.pcraft', '.psd', '.psb', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp', '.tga', '.exr', '.gif']);

// GET /v1/visual/files — list openable documents in the workspace (newest first)
router.get('/files', (_req: Request, res: Response) => {
    try {
        const out: Array<{ path: string; name: string; size: number; mtime: string }> = [];
        const walk = (dir: string, depth: number) => {
            if (depth > 3 || out.length >= 200) return;
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                if (out.length >= 200) return;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
                    walk(full, depth + 1);
                } else if (OPENABLE.has(path.extname(e.name).toLowerCase())) {
                    try {
                        const st = fs.statSync(full);
                        out.push({ path: full, name: e.name, size: st.size, mtime: st.mtime.toISOString() });
                    } catch { /* skip */ }
                }
            }
        };
        walk(WORKSPACE, 0);
        out.sort((a, b) => b.mtime.localeCompare(a.mtime));
        return res.json({ files: out });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// GET /v1/visual/file?path=... — stream one workspace document (confined to the workspace)
router.get('/file', (req: Request, res: Response) => {
    try {
        const confined = confinePath(String(req.query.path || ''), WORKSPACE);
        if (!fs.existsSync(confined) || !fs.statSync(confined).isFile()) {
            return res.status(404).json({ error: 'File not found in workspace' });
        }
        return res.sendFile(confined);
    } catch (e: any) {
        return res.status(400).json({ error: e.message });
    }
});

// POST /v1/visual/import — receive a document from the editor (raw bytes) into workspace/visual/
router.post('/import', express.raw({ type: 'application/octet-stream', limit: '200mb' }), (req: Request, res: Response) => {
    try {
        const rawName = String(req.headers['x-visual-filename'] || '');
        const name = path.basename(rawName).replace(/[^\w.\- ()\[\]]/g, '_');
        if (!name || name.startsWith('.')) return res.status(400).json({ error: 'Invalid X-Visual-Filename' });
        if (!req.body || !(req.body as Buffer).length) return res.status(400).json({ error: 'Empty body' });
        const dir = path.join(WORKSPACE, 'visual');
        fs.mkdirSync(dir, { recursive: true });
        const dest = confinePath(path.join(dir, name), WORKSPACE);
        fs.writeFileSync(dest, req.body as Buffer);
        return res.json({ success: true, path: dest, size: (req.body as Buffer).length });
    } catch (e: any) {
        return res.status(400).json({ error: e.message });
    }
});

export default router;
