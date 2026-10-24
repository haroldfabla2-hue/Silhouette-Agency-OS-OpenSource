/**
 * Operator connection lifecycle: real HTTP through an express app carrying
 * ONLY the connection router (server/app.ts's full boot is out of scope for
 * this suite; operator auth there is the global authMiddleware, verified by
 * mount order). Covers start/list/switch/close + every rejection path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AccountStore } from '../../../services/auth/accountStore';
import { ConnectionManager } from '../../../services/auth/connectionManager';
import { createConnectionRouter } from '../../../server/routes/connections';

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
    while (servers.length) await new Promise<void>(r => servers.pop()!.close(() => r()));
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function setup() {
    const d = mkdtempSync(join(tmpdir(), 'cm-')); dirs.push(d);
    const store = new AccountStore(join(d, 'a.db'));
    const app = express();
    app.use(express.json());
    app.use('/v1/connections', createConnectionRouter(new ConnectionManager(store)));
    const server = await new Promise<Server>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/connections`;
    return { store, base };
}

const startBody = { providerId: 'OPENAI_CODEX', accountId: 'work', label: 'Work', method: 'command', secretRef: 'cli-home:codex' };

describe('operator connection interface', () => {
    it('start -> list -> switch -> close over real HTTP', async () => {
        const { store, base } = await setup();
        const created = await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startBody) })).json();
        expect(created.ok).toBe(true);
        expect(created.account.secretRef).toBe('cli-home:codex');

        const second = { ...startBody, accountId: 'personal', secretRef: 'env:X' };
        await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(second) });
        const list = await (await fetch(`${base}?provider=OPENAI_CODEX`)).json();
        expect(list.accounts).toHaveLength(2);

        const sw = await (await fetch(`${base}/OPENAI_CODEX/personal/activate`, { method: 'POST' })).json();
        expect(sw.ok).toBe(true);
        expect(store.active('OPENAI_CODEX')?.accountId).toBe('personal');

        const del = await (await fetch(`${base}/OPENAI_CODEX/work`, { method: 'DELETE' })).json();
        expect(del.ok).toBe(true);
        const after = await (await fetch(base)).json();
        expect(after.accounts).toHaveLength(1);
        store.close();
    });
    it('rejects bad input with honest codes', async () => {
        const { store, base } = await setup();
        const post = (b: unknown) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
        expect((await (await post({ ...startBody, secretRef: 'raw-token-here' })).json()).error).toBe('invalid-secret-ref');
        expect((await (await post({ ...startBody, accountId: 'BAD ID!' })).json()).error).toBe('invalid-account-id');
        expect((await (await post({ ...startBody, method: 'telepathy' })).json()).error).toBe('invalid-method');
        await post(startBody);
        const dup = await post(startBody);
        expect(dup.status).toBe(409);
        const missing = await fetch(`${base}/OPENAI_CODEX/ghost/activate`, { method: 'POST' });
        expect(missing.status).toBe(404);
        const delGhost = await fetch(`${base}/OPENAI_CODEX/ghost`, { method: 'DELETE' });
        expect(delGhost.status).toBe(404);
        store.close();
    });
});
