/**
 * Regression tests for the dashboard audit (batch 1):
 * 1. /auto-evolution routes must be registered at import time.
 *    They were accidentally nested inside the /health handler, so they
 *    only existed after something called /health (404 after every boot).
 * 2. GET /auto-evolution must never return characters of the real token
 *    (constant mask only; the POST handler treats the mask as "keep existing").
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

function findHandler(router: any, routePath: string, method: string) {
    const layer = router.stack.find((l: any) => l.route && l.route.path === routePath && l.route.methods[method]);
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

describe('system.routes audit batch 1', () => {

    it('registers GET and POST /auto-evolution at import time (not nested in /health)', async () => {
        const mod = await import('../../server/routes/v1/system.routes');
        const router = mod.default as any;
        expect(findHandler(router, '/auto-evolution', 'get')).toBeTypeOf('function');
        expect(findHandler(router, '/auto-evolution', 'post')).toBeTypeOf('function');
        // /health must keep working and must NOT be the registration mechanism
        expect(findHandler(router, '/health', 'get')).toBeTypeOf('function');
    });

    it('GET /auto-evolution returns a constant mask and never token characters', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'));
        const SECRET = 'ghp_TESTSECRET1234567890wxyz';
        fs.writeFileSync(path.join(tmp, '.env.local'),
            `GITHUB_TOKEN=${SECRET}\nGITHUB_REPO_OWNER=some-owner\nGITHUB_REPO_NAME=some-repo\n`);
        const prevCwd = process.cwd();
        process.chdir(tmp);
        try {
            const mod = await import('../../server/routes/v1/system.routes');
            const handler = findHandler(mod.default as any, '/auto-evolution', 'get');
            const res = mockRes();
            await handler({} as any, res);
            expect(res.body.configured).toBe(true);
            expect(res.body.gitToken).toBe(MASK);
            const serialized = JSON.stringify(res.body);
            expect(serialized).not.toContain(SECRET);
            expect(serialized).not.toContain('wxyz'); // last4 must not leak
            expect(serialized).not.toContain('ghp_'); // prefix must not leak
            expect(res.body.gitOwner).toBe('some-owner');
            expect(res.body.gitRepo).toBe('some-repo');
        } finally {
            process.chdir(prevCwd);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('GET /auto-evolution reports configured:false when no .env.local exists', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-empty-'));
        const prevCwd = process.cwd();
        process.chdir(tmp);
        try {
            const mod = await import('../../server/routes/v1/system.routes');
            const handler = findHandler(mod.default as any, '/auto-evolution', 'get');
            const res = mockRes();
            await handler({} as any, res);
            expect(res.body.configured).toBe(false);
        } finally {
            process.chdir(prevCwd);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('POST /auto-evolution rejects missing fields with 400 (before any side effect)', async () => {
        const mod = await import('../../server/routes/v1/system.routes');
        const handler = findHandler(mod.default as any, '/auto-evolution', 'post');
        const res = mockRes();
        await handler({ body: { gitToken: 'x' } } as any, res);
        expect(res.statusCode).toBe(400);
    });
});
