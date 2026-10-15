/**
 * Audit batch 3: GET /v1/system/logs — real, byte-capped server log tail.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmp: string;
let logFile: string;

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

async function getRouter() {
    const mod = await import('../../server/routes/v1/system.routes');
    return mod.default as any;
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syslog-test-'));
    logFile = path.join(tmp, 'server.log');
    process.env.SERVER_LOG_PATH = logFile;
});

afterEach(() => {
    delete process.env.SERVER_LOG_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('GET /v1/system/logs', () => {

    it('returns the last N lines of the real log file', async () => {
        const lines = Array.from({ length: 500 }, (_, i) => `line-${i + 1}`);
        fs.writeFileSync(logFile, lines.join('\n'));
        const handler = findHandler(await getRouter(), '/logs', 'get');
        const res = mockRes();
        await handler({ query: { lines: '50' } } as any, res);
        expect(res.body.lines.length).toBe(50);
        expect(res.body.lines[49]).toBe('line-500');
        expect(res.body.lines[0]).toBe('line-451');
        expect(res.body.logBytes).toBeGreaterThan(0);
    });

    it('caps the requested line count at 1000', async () => {
        fs.writeFileSync(logFile, Array.from({ length: 1500 }, (_, i) => `L${i}`).join('\n'));
        const handler = findHandler(await getRouter(), '/logs', 'get');
        const res = mockRes();
        await handler({ query: { lines: '99999' } } as any, res);
        expect(res.body.lines.length).toBeLessThanOrEqual(1000);
    });

    it('reports honestly when the log file does not exist', async () => {
        const handler = findHandler(await getRouter(), '/logs', 'get');
        const res = mockRes();
        await handler({ query: {} } as any, res);
        expect(res.body.lines).toEqual([]);
        expect(res.body.note).toContain('not found');
    });
});
