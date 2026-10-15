/**
 * Audit batch 2: /v1/workspace routes — real server-backed workspace.
 * Hermetic: WORKSPACE_ROOT points at a tmp dir before the router is imported.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmp: string;
let router: any;

function findHandler(r: any, routePath: string, method: string) {
    const layer = r.stack.find((l: any) => l.route && l.route.path === routePath && l.route.methods[method]);
    return layer?.route.stack[0].handle;
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        body: null as any,
        json(o: any) { this.body = o; return this; },
        status(c: number) { this.statusCode = c; return this; }
    };
    return res;
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-routes-'));
    process.env.WORKSPACE_ROOT = tmp;
    const mod = await import('../../server/routes/v1/workspace.routes');
    router = mod.default;
});

afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.WORKSPACE_ROOT;
});

describe('workspace.routes', () => {

    it('GET /tree lists real files and excludes node_modules and dotfiles', async () => {
        fs.mkdirSync(path.join(tmp, 'projA/src'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'projA/src/App.tsx'), 'export const x = 1;');
        fs.mkdirSync(path.join(tmp, 'projA/node_modules/junk'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'projA/node_modules/junk/index.js'), 'x');
        fs.writeFileSync(path.join(tmp, 'projA/.env'), 'SECRET=1');

        const handler = findHandler(router, '/tree', 'get');
        const res = mockRes();
        await handler({ query: {} } as any, res);
        const ids = res.body.nodes.map((n: any) => n.id);
        expect(ids).toContain('projA');
        expect(ids).toContain('projA/src');
        expect(ids).toContain('projA/src/App.tsx');
        expect(ids.join('|')).not.toContain('node_modules');
        expect(ids.join('|')).not.toContain('.env');
        const top = res.body.nodes.find((n: any) => n.id === 'projA');
        expect(top.parentId).toBe('');
        expect(top.type).toBe('folder');
    });

    it('POST /file then GET /file round-trips real content', async () => {
        const post = findHandler(router, '/file', 'post');
        const res1 = mockRes();
        await post({ body: { path: 'projB/deep/a.txt', content: 'hola real' } } as any, res1);
        expect(res1.body.success).toBe(true);
        expect(fs.readFileSync(path.join(tmp, 'projB/deep/a.txt'), 'utf-8')).toBe('hola real');

        const get = findHandler(router, '/file', 'get');
        const res2 = mockRes();
        await get({ query: { path: 'projB/deep/a.txt' } } as any, res2);
        expect(res2.body.content).toBe('hola real');
    });

    it('jails path traversal and dotfile reads', async () => {
        const get = findHandler(router, '/file', 'get');
        for (const p of ['../escape.txt', '../../etc/passwd', 'projA/.env', 'projA/.git/config']) {
            const res = mockRes();
            await get({ query: { path: p } } as any, res);
            expect(res.statusCode).toBe(400);
        }
        const post = findHandler(router, '/file', 'post');
        const res = mockRes();
        await post({ body: { path: '../escape.txt', content: 'x' } } as any, res);
        expect(res.statusCode).toBe(400);
        expect(fs.existsSync(path.join(tmp, '..', 'escape.txt'))).toBe(false);
    });

    it('POST /quarantine moves instead of deleting (content preserved)', async () => {
        fs.writeFileSync(path.join(tmp, 'projB/old.txt'), 'preservame');
        const handler = findHandler(router, '/quarantine', 'post');
        const res = mockRes();
        await handler({ body: { path: 'projB/old.txt' } } as any, res);
        expect(res.body.success).toBe(true);
        expect(fs.existsSync(path.join(tmp, 'projB/old.txt'))).toBe(false);
        const qPath = path.join(tmp, res.body.quarantinedTo);
        expect(fs.readFileSync(qPath, 'utf-8')).toBe('preservame');
        expect(res.body.quarantinedTo).toContain('.quarantine/');
    });

    it('POST /project creates a real folder; rejects dupes and bad names', async () => {
        const handler = findHandler(router, '/project', 'post');
        const res1 = mockRes();
        await handler({ body: { name: 'nuevo-proyecto' } } as any, res1);
        expect(res1.body.success).toBe(true);
        expect(fs.statSync(path.join(tmp, 'nuevo-proyecto')).isDirectory()).toBe(true);

        const res2 = mockRes();
        await handler({ body: { name: 'nuevo-proyecto' } } as any, res2);
        expect(res2.statusCode).toBe(409);

        for (const bad of ['../x', 'a/b', '', 'x'.repeat(100)]) {
            const res3 = mockRes();
            await handler({ body: { name: bad } } as any, res3);
            expect(res3.statusCode).toBe(400);
        }
    });

    it('GET /file refuses files over the 512KB cap with 413', async () => {
        fs.writeFileSync(path.join(tmp, 'projB/big.bin'), Buffer.alloc(600 * 1024, 65));
        const get = findHandler(router, '/file', 'get');
        const res = mockRes();
        await get({ query: { path: 'projB/big.bin' } } as any, res);
        expect(res.statusCode).toBe(413);
    });
});
