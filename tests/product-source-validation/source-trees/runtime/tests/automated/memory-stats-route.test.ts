import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';

// Regression: GET /v1/memory/stats (and /state) returned {"stats":{}} because continuum.getStats() is async
// and the route did not await it (a Promise serializes to {}).

const ROOT = path.resolve(__dirname, '..', '..');

/** Pure: lines that call an async continuum method without await/then/return. */
export function findUnawaitedAsyncContinuumCalls(source: string, asyncMethods: string[]): string[] {
    const found: string[] = [];
    source.split('\n').forEach((line, i) => {
        for (const m of asyncMethods) {
            const re = new RegExp(`continuum\\.${m}\\(`);
            if (re.test(line) && !/await\s|\.then\(|return\s/.test(line)) found.push(`${i + 1}: ${line.trim()}`);
        }
    });
    return found;
}

describe('memory stats route awaits async stats', () => {
    // Importing the memory route boots the continuumMemory singleton, whose
    // constructor fires dynamic imports (dreamerService -> powerManager) and a
    // Redis connection. If the vitest worker closes while that module fetch is
    // still in flight, the run dies with "Closing rpc while fetch was pending"
    // (observed in CI, Node 22 leg). Drain and close everything explicitly so
    // teardown is deterministic — never a retry-loop lottery.
    afterAll(async () => {
        // dreamerService statically imports continuumMemory (circular), so its
        // namespace can resolve before the `dreamer` export is initialized.
        // ES module namespaces are live bindings: drain the evaluation, then stop.
        const mod: any = await import('../../services/dreamerService');
        for (let i = 0; i < 100 && !mod.dreamer; i++) {
            await new Promise(r => setTimeout(r, 50));
        }
        mod.dreamer?.stopDreamingLoop();
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.disconnect();
    });

    it('detector flags the original bug (negative control)', () => {
        expect(findUnawaitedAsyncContinuumCalls('const stats = continuum.getStats();', ['getStats'])).toHaveLength(1);
        expect(findUnawaitedAsyncContinuumCalls('const stats = await continuum.getStats();', ['getStats'])).toEqual([]);
    });

    it('getStats is async and every memory route call awaits it', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/continuumMemory.ts'), 'utf8');
        expect(svc).toMatch(/public async getStats\(/);
        const routes = fs.readFileSync(path.join(ROOT, 'server/routes/v1/memory.routes.ts'), 'utf8');
        expect(findUnawaitedAsyncContinuumCalls(routes, ['getStats', 'getAllNodes'])).toEqual([]);
    });

    it('GET /v1/memory/stats returns real numeric tier counts, not {}', async () => {
        const { default: memoryRouter } = await import('../../server/routes/v1/memory.routes');
        const app = express();
        app.use('/v1/memory', memoryRouter);
        const server = http.createServer(app);
        await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as any).port;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/v1/memory/stats`);
            const body: any = await res.json();
            expect(res.status).toBe(200);
            expect(Object.keys(body.stats).length).toBeGreaterThan(0);
            for (const k of ['working', 'medium', 'long', 'deep', 'total']) expect(typeof body.stats[k]).toBe('number');
        } finally {
            await new Promise<void>(r => server.close(() => r()));
        }
    }, 60000);
});
