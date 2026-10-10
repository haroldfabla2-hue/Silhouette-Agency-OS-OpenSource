import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';

// Regression: GET /v1/voices/calls (and /default) returned {"error":"Voice not found"} because the
// parameterized GET '/:id' was registered first and captured them. Express matches in registration order.

const ROOT = path.resolve(__dirname, '..', '..', 'server');
const METHOD_RE = /\b(?:router|\w+Router|app)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
}

/** Pure: finds `METHOD /:param` routes that shadow a LATER static path of the same method. */
export function findShadowedRoutes(source: string): string[] {
    const routes = [...source.matchAll(METHOD_RE)].map(m => ({ method: m[1], p: m[2] }));
    const found: string[] = [];
    routes.forEach((r, i) => {
        if (!r.p.includes(':')) return;
        const re = new RegExp('^' + r.p.replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
        for (const later of routes.slice(i + 1)) {
            if (later.method === r.method && !later.p.includes(':') && re.test(later.p)) found.push(`${r.method.toUpperCase()} ${r.p} shadows ${later.p}`);
        }
    });
    return found;
}

describe('route order: static paths must not be shadowed by /:param routes', () => {
    it('detector flags the exact original bug (negative control)', () => {
        const bad = `router.get('/:id', h);\nrouter.get('/calls', h);\nrouter.get('/default', h);`;
        expect(findShadowedRoutes(bad)).toEqual(['GET /:id shadows calls'.replace('calls', '/calls'), 'GET /:id shadows /default']);
        const good = `router.get('/calls', h);\nrouter.get('/:id', h);`;
        expect(findShadowedRoutes(good)).toEqual([]);
    });

    it('no router file in server/ shadows a static route (whole repo scan)', () => {
        const problems: string[] = [];
        for (const f of walk(ROOT)) {
            for (const p of findShadowedRoutes(fs.readFileSync(f, 'utf8'))) problems.push(`${path.relative(ROOT, f)}: ${p}`);
        }
        expect(problems).toEqual([]);
    });

    it('voices router really serves /calls and /default (not "Voice not found")', async () => {
        const { default: voiceRouter } = await import('../../server/routes/v1/voice.routes');
        const app = express();
        app.use('/v1/voices', voiceRouter);
        const server = http.createServer(app);
        await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as any).port;
        try {
            const calls = await fetch(`http://127.0.0.1:${port}/v1/voices/calls`);
            const callsBody: any = await calls.json();
            expect(calls.status).toBe(200);
            expect(callsBody.success).toBe(true);
            expect(Array.isArray(callsBody.calls)).toBe(true);

            const def = await fetch(`http://127.0.0.1:${port}/v1/voices/default`);
            const defBody: any = await def.json();
            expect(JSON.stringify(defBody)).not.toMatch(/Voice not found/);

            // /:id still works for real ids (unknown id => 404 "Voice not found")
            const one = await fetch(`http://127.0.0.1:${port}/v1/voices/does-not-exist-xyz`);
            expect(one.status).toBe(404);
        } finally {
            await new Promise<void>(r => server.close(() => r()));
        }
    }, 30000);
});
