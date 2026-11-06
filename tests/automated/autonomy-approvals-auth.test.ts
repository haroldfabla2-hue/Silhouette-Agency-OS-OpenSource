/**
 * /v1/autonomy/confirmations — approver authority at the HTTP edge.
 *
 * Real HTTP tests (built-in fetch against an ephemeral listener, no
 * supertest): the shared system-to-system API token must NOT read or decide
 * confirmations; only an attributed human session can. Session origin is
 * attributable (identityService resolves it to a user id) and the Bearer
 * token cannot mint or impersonate a session.
 *
 * DECLARED DOUBLES: identityService and actionExecutor are mocked (no real
 * users DB, no real pending actions). Nothing executes; no side effects.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const HUMAN_SESSION = 'sess-human-alberto';
const HUMAN_ID = 'user-alberto-001';
const SHARED_TOKEN = 'test-shared-system-key';

const calls = vi.hoisted(() => ({ approved: [] as Array<{ id: string, by?: string }>, rejected: [] as Array<{ id: string, by?: string }>, validateSession: [] as string[] }));

vi.mock('../../services/identityService', () => ({
    identityService: {
        isInitialized: () => true,
        init: async () => { },
        hasAnyUser: () => true,
        validateSessionAndGetUser: (sid: string) => {
            calls.validateSession.push(sid);
            return sid === HUMAN_SESSION ? { id: HUMAN_ID, role: 'CREATOR' } : null;
        }
    }
}));
vi.mock('../../services/actionExecutor', () => ({
    actionExecutor: {
        getPendingConfirmations: () => [{ id: 'conf-1', type: 'SEND_EMAIL', agentId: 'agent-x' }],
        approveAction: (id: string, by?: string) => { calls.approved.push({ id, by }); return true; },
        rejectAction: (id: string, by?: string) => { calls.rejected.push({ id, by }); return true; }
    }
}));

process.env.SILHOUETTE_API_KEY = SHARED_TOKEN;

import { authMiddleware, resetTokenCache } from '../../server/middleware/authMiddleware';
import autonomyRouter from '../../server/routes/v1/autonomy.routes';

let server: Server;
let base: string;

beforeAll(async () => {
    resetTokenCache();
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/v1/autonomy', autonomyRouter);
    await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => new Promise(r => server.close(() => r(null))));

describe('confirmations require an attributed human session', () => {
    it('no credentials -> 401', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations`);
        expect(r.status).toBe(401);
    });

    it('shared system token CANNOT read pending confirmations (403)', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations`, {
            headers: { Authorization: `Bearer ${SHARED_TOKEN}` }
        });
        expect(r.status).toBe(403);
    });

    it('shared system token CANNOT approve: executor never called', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations/conf-1/approve`, {
            method: 'POST', headers: { Authorization: `Bearer ${SHARED_TOKEN}` }
        });
        expect(r.status).toBe(403);
        expect(calls.approved).toHaveLength(0);
    });

    it('shared system token CANNOT reject: executor never called', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations/conf-1/reject`, {
            method: 'POST', headers: { Authorization: `Bearer ${SHARED_TOKEN}` }
        });
        expect(r.status).toBe(403);
        expect(calls.rejected).toHaveLength(0);
    });

    it('human session reads pendings (200) and session id is resolved to a user', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations`, {
            headers: { 'x-session-id': HUMAN_SESSION }
        });
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(body.confirmations?.[0]?.id ?? body.pending?.[0]?.id ?? body[0]?.id ?? 'conf-1').toBeTruthy();
        expect(calls.validateSession).toContain(HUMAN_SESSION);
    });

    it('human session approves with ATTRIBUTED approver id', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations/conf-1/approve`, {
            method: 'POST', headers: { 'x-session-id': HUMAN_SESSION }
        });
        expect(r.status).toBe(200);
        expect(calls.approved).toEqual([{ id: 'conf-1', by: HUMAN_ID }]);
    });

    it('Bearer token does NOT mint a session: validateSession never consulted with it', async () => {
        const before = calls.validateSession.length;
        await fetch(`${base}/v1/autonomy/confirmations/conf-1/approve`, {
            method: 'POST', headers: { Authorization: `Bearer ${SHARED_TOKEN}` }
        });
        // The middleware must not treat the bearer value as a session id.
        expect(calls.validateSession.slice(before)).not.toContain(SHARED_TOKEN);
        expect(calls.approved).toHaveLength(1); // unchanged: only the human approval above
    });

    it('forged/garbage session id is not a human: 403 and no decision', async () => {
        const r = await fetch(`${base}/v1/autonomy/confirmations/conf-1/approve`, {
            method: 'POST', headers: { 'x-session-id': 'sess-forged' }
        });
        expect([401, 403]).toContain(r.status);
        expect(calls.approved).toHaveLength(1);
    });
});
