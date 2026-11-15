import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// Real server workspace — the same root the Genesis factory builds into.
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(process.cwd(), 'workspace'));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.quarantine']);
const MAX_TREE_ENTRIES = 5000;
const MAX_TREE_DEPTH = 8;
const MAX_FILE_BYTES = 512 * 1024;

const toRel = (abs: string): string => path.relative(WORKSPACE_ROOT, abs).split(path.sep).join('/');

// Jail: resolve strictly inside WORKSPACE_ROOT and refuse dotfile segments
// (the UI must never serve .env and friends).
function jail(relPath: any): string | null {
    if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) return null;
    const segments = relPath.split(/[\\/]+/).filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.some(s => s.startsWith('.'))) return null;
    const abs = path.resolve(WORKSPACE_ROOT, relPath);
    if (abs !== WORKSPACE_ROOT && !abs.startsWith(WORKSPACE_ROOT + path.sep)) return null;
    return abs;
}

// GET /tree — recursive real tree (folders + files with size/mtime, no contents)
router.get('/tree', (_req, res) => {
    try {
        const nodes: any[] = [];
        let truncated = false;
        const walk = (dir: string, depth: number) => {
            if (depth > MAX_TREE_DEPTH || truncated) return;
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                if (nodes.length >= MAX_TREE_ENTRIES) { truncated = true; return; }
                if (e.name.startsWith('.')) continue;
                const abs = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (SKIP_DIRS.has(e.name)) continue;
                    let mtime = 0;
                    try { mtime = fs.statSync(abs).mtimeMs; } catch { }
                    nodes.push({ id: toRel(abs), parentId: toRel(dir), name: e.name, type: 'folder', mtime });
                    walk(abs, depth + 1);
                } else if (e.isFile()) {
                    let size = 0, mtime = 0;
                    try { const st = fs.statSync(abs); size = st.size; mtime = st.mtimeMs; } catch { }
                    nodes.push({ id: toRel(abs), parentId: toRel(dir), name: e.name, type: 'file', size, mtime });
                }
            }
        };
        if (fs.existsSync(WORKSPACE_ROOT)) walk(WORKSPACE_ROOT, 0);
        res.json({ root: WORKSPACE_ROOT, nodes, truncated });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /file?path=<rel> — real file content (512KB cap)
router.get('/file', (req, res) => {
    const abs = jail(req.query.path);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return res.status(404).json({ error: 'Not a file' });
        if (st.size > MAX_FILE_BYTES) return res.status(413).json({ error: `File too large (${st.size} bytes, cap ${MAX_FILE_BYTES})` });
        const content = fs.readFileSync(abs, 'utf-8');
        res.json({ path: toRel(abs), content, size: st.size, mtime: st.mtimeMs });
    } catch {
        res.status(404).json({ error: 'File not found' });
    }
});

// POST /file { path, content } — write (creates parent dirs)
router.post('/file', (req, res) => {
    const abs = jail(req.body?.path);
    const content = req.body?.content;
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) return res.status(413).json({ error: 'content exceeds 512KB cap' });
    try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
        const st = fs.statSync(abs);
        res.json({ success: true, path: toRel(abs), size: st.size, mtime: st.mtimeMs });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /folder { path } — mkdir -p
router.post('/folder', (req, res) => {
    const abs = jail(req.body?.path);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
        fs.mkdirSync(abs, { recursive: true });
        res.json({ success: true, path: toRel(abs) });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /project { name } — create a real top-level project folder
router.post('/project', (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) || name.includes('..')) {
        return res.status(400).json({ error: 'Invalid project name' });
    }
    const abs = jail(name);
    if (!abs) return res.status(400).json({ error: 'Invalid project name' });
    try {
        if (fs.existsSync(abs)) return res.status(409).json({ error: 'Project already exists' });
        fs.mkdirSync(abs);
        res.json({ success: true, path: toRel(abs) });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /quarantine { path } — move into .quarantine/ (eternal-memory invariant: nothing is deleted)
router.post('/quarantine', (req, res) => {
    const abs = jail(req.body?.path);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    if (abs === WORKSPACE_ROOT) return res.status(400).json({ error: 'Refusing to quarantine the workspace root' });
    try {
        if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Path not found' });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = path.join(WORKSPACE_ROOT, '.quarantine', stamp, toRel(abs));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(abs, dest);
        console.log(`[WORKSPACE] Quarantined ${toRel(abs)} -> ${toRel(dest)}`);
        res.json({ success: true, quarantinedTo: toRel(dest) });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
