import { describe, it, expect, afterAll, vi } from 'vitest';
import crypto from 'crypto';

// R4 root fix: memory across sessions without reliable personal continuity.
// Three pinned contracts:
// 1. Identity: a token-less local install used to demote a logged-in user to
//    'anonymous' because the bypass assigned req.user=null BEFORE validating
//    a presented session. Now the session is validated first.
// 2. Durable per-user profile: SQLite is the source of truth (survives RAM
//    loss / restart), Redis is only a hot cache, and profiles are keyed by
//    user id - one user's data never leaks into another's prompt.
// 3. Verified identity facts reach every prompt as a guaranteed budget-capped
//    block, separate from episodic search; hypotheses never enter it.

vi.mock('../../services/identityService', () => ({
    identityService: {
        hasAnyUser: vi.fn().mockReturnValue(true),
        validateSessionAndGetUser: vi.fn((sid: string) =>
            sid === 'good-session' ? { id: 'user-alberto', role: 'CREATOR' } : null)
    }
}));

import { authMiddleware, resetTokenCache } from '../../server/middleware/authMiddleware';
import { UserProfileService } from '../../services/userProfileService';
import { chatController } from '../../server/controllers/chatController';
import { factRepository } from '../../services/memory/factRepository';

// chatController -> factRepository -> continuumMemory boots the dreamer/redis
// singletons at import; drain and close them deterministically (same pattern
// as memory-stats-route.test.ts).
afterAll(async () => {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    mod.dreamer?.stopDreamingLoop();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect();
});

const uid = () => `test-r4-${crypto.randomUUID()}`;

function createMocks(headers: Record<string, string> = {}) {
    const req: any = { path: '/v1/chat', headers };
    const res: any = {
        statusCode: 200, body: null,
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { this.body = body; return this; }
    };
    const next = vi.fn();
    return { req, res, next };
}

describe('R4 identity: tokenless bypass validates a presented session', () => {
    it('valid x-session-id attaches the session user even without an API token', async () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', '');
        vi.stubEnv('SILHOUETTE_ALLOW_INSECURE', 'true');
        resetTokenCache();
        const { req, res, next } = createMocks({ 'x-session-id': 'good-session' });
        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual({ id: 'user-alberto', role: 'CREATOR' });
        vi.unstubAllEnvs();
    });

    it('no session header keeps req.user null (truly unidentified only)', async () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', '');
        vi.stubEnv('SILHOUETTE_ALLOW_INSECURE', 'true');
        resetTokenCache();
        const { req, res, next } = createMocks();
        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
        vi.unstubAllEnvs();
    });

    it('invalid session id does not attach a user', async () => {
        vi.stubEnv('SILHOUETTE_API_TOKEN', '');
        vi.stubEnv('SILHOUETTE_ALLOW_INSECURE', 'true');
        resetTokenCache();
        const { req, res, next } = createMocks({ 'x-session-id': 'forged-session' });
        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
        vi.unstubAllEnvs();
    });
});

describe('R4 durable per-user profile', () => {
    it('survives a simulated restart (fresh service instance, RAM empty) via SQLite', async () => {
        const userA = uid();
        const first = new UserProfileService();
        await first.setName('Alberto', userA);
        await first.setPreference('coffee', 'cortado', userA);

        // "Restart": a brand-new instance has an empty RAM map
        const second = new UserProfileService();
        expect(second.getName(userA)).toBeUndefined(); // RAM really empty
        const loaded = await second.loadProfile(userA);
        expect(loaded?.name).toBe('Alberto');
        expect(loaded?.preferences.coffee).toBe('cortado');
        expect(second.getProfileContext(userA)).toContain('Alberto');
    });

    it('per-user isolation: user B never sees user A data', async () => {
        const userA = uid(); const userB = uid();
        const svc = new UserProfileService();
        await svc.setName('Alice', userA);
        await svc.addFact('tiene un perro', userA);

        const loadedB = await svc.loadProfile(userB);
        expect(loadedB).toBeNull();
        expect(svc.getProfileContext(userB)).toBe('');
        expect(svc.getProfileContext(userA)).toContain('Alice');
    });

    it('extractFromMessage writes to the requesting user only', async () => {
        const userA = uid(); const userB = uid();
        const svc = new UserProfileService();
        await svc.extractFromMessage('me llamo Carlos', userA);
        expect((await svc.loadProfile(userA))?.name).toBe('Carlos');
        expect(await svc.loadProfile(userB)).toBeNull();
    });
});

describe('R4 verified facts reach the prompt block; hypotheses stay out', () => {
    it('verifiedFactsBlock includes only citation-verified facts of that user', async () => {
        const u = uid();
        await factRepository.addFact({
            type: 'PERSONAL', content: 'The user is named Alberto',
            source: 'USER_STATED', quote: 'me llamo Alberto', status: 'verified', confidence: 0.99
        }, u);
        await factRepository.addFact({
            type: 'FACT', content: 'The user might like surfing',
            source: 'USER_INFERRED', status: 'hypothesis', confidence: 0.4
        }, u);
        // another user's verified fact must not leak in
        const other = uid();
        await factRepository.addFact({
            type: 'PERSONAL', content: 'The user is named Beatriz',
            source: 'USER_STATED', quote: 'my name is Beatriz', status: 'verified', confidence: 0.99
        }, other);

        const block = (chatController as any).verifiedFactsBlock(u);
        expect(block).toContain('The user is named Alberto');
        expect(block).not.toContain('surfing');   // hypothesis excluded
        expect(block).not.toContain('Beatriz');   // other owner excluded
    });

    it('verifiedFactsBlock returns empty when there is no verified evidence', () => {
        const block = (chatController as any).verifiedFactsBlock(uid());
        expect(block).toBe('');
    });
});
