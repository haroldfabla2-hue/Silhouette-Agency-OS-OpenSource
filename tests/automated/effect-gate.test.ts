/**
 * EFFECT GATE v2 - specific, single-use, args-bound authority.
 *
 * Real denial/consent tests with DECLARED doubles: actionExecutor is mocked
 * (its requestConfirmation is the human decision point; the double only
 * simulates approve/reject - no email, no generation, no spend).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestConfirmation = vi.fn();
vi.mock('../../services/actionExecutor', () => ({
    actionExecutor: { requestConfirmation }
}));

import {
    ensureEffectConsent,
    issueEffectGrant,
    isGatedEffect,
    describeEffect,
    effectBinding,
    bindingArgsFor,
    EffectDeniedError,
    EFFECT_POLICIES
} from '../../services/security/effectGate';
import { runWithEffectContext } from '../../services/security/effectContext';

beforeEach(() => {
    requestConfirmation.mockReset();
});

const IMG = { prompt: 'landing hero', style: 'PHOTOREALISTIC' };

describe('registry', () => {
    it('gates exactly the declared effects', () => {
        for (const t of ['send_email', 'github_create_pr', 'generate_image', 'generate_video', 'generate_voice']) {
            expect(isGatedEffect(t)).toBe(true);
        }
        expect(isGatedEffect('web_search')).toBe(false);
        expect(isGatedEffect('read_file')).toBe(false);
    });

    it('marks generation effects wallet-bearing', () => {
        expect(EFFECT_POLICIES.generate_image.walletBearing).toBe(true);
        expect(EFFECT_POLICIES.generate_video.walletBearing).toBe(true);
        expect(EFFECT_POLICIES.generate_voice.walletBearing).toBe(true);
        expect(EFFECT_POLICIES.send_email.walletBearing).toBe(false);
    });

    it('binding covers the declared arg set per effect', () => {
        expect(bindingArgsFor('send_email', { to: 'a', subject: 's', body: 'b', isHtml: true }))
            .toEqual({ to: 'a', subject: 's', body: 'b' }); // isHtml not bound
        expect(bindingArgsFor('generate_image', { prompt: 'p', style: 'X', aspectRatio: '1:1', extra: 1 }))
            .toEqual({ prompt: 'p', style: 'X', aspectRatio: '1:1' });
    });
});

describe('no context: chat-image / autonomous effect without grant is DENIED or human-gated', () => {
    it('chat-origin generate_image without any grant asks a human; rejection denies (typed)', async () => {
        requestConfirmation.mockResolvedValue(false);
        await expect(ensureEffectConsent('generate_image', IMG, 'chatToolIntegration:chat'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(requestConfirmation).toHaveBeenCalledTimes(1);
    });

    it('autonomous generate_voice without grant: timeout/rejection denies (typed)', async () => {
        requestConfirmation.mockResolvedValue(false);
        await expect(ensureEffectConsent('generate_voice', { text: 'hola' }, 'creativeDirectorSkill'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
    });

    it('human approval at /v1/autonomy/confirmations allows exactly once', async () => {
        requestConfirmation.mockResolvedValue(true);
        const d = await ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'planExecutor');
        expect(d.via).toBe('human-approval');
        const [action, reason] = requestConfirmation.mock.calls[0];
        expect(action.payload.effect).toBe('send_email');
        expect(reason).toContain('a@b.c');
        expect(reason).toContain('planExecutor');
    });
});

describe('grant semantics: consume-once, args-bound, no reuse', () => {
    it('a valid grant authorizes its exact effect+args', async () => {
        const ctx = issueEffectGrant('generate_image', IMG, 'test');
        const d = await runWithEffectContext(ctx, () => ensureEffectConsent('generate_image', IMG, 'boundary'));
        expect(d.via).toBe('grant');
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('REPLAY: the same grant cannot authorize a second chain', async () => {
        const ctx = issueEffectGrant('generate_image', IMG, 'test');
        await runWithEffectContext(ctx, () => ensureEffectConsent('generate_image', IMG, 'first'));
        // New chain, same token, no prior validation: ALREADY_USED.
        const replayCtx = { grant: ctx.grant, validated: new Set<string>(), validatedKinds: new Set<string>(), issuedBy: 'attacker-or-bug' };
        await expect(runWithEffectContext(replayCtx, () => ensureEffectConsent('generate_image', IMG, 'replay')))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        await expect(runWithEffectContext(replayCtx, () => ensureEffectConsent('generate_image', IMG, 'replay')))
            .rejects.toThrow(/ALREADY_USED/);
    });

    it('CROSS-ARGS: a grant for image X denies image Y (MISMATCH)', async () => {
        const ctx = issueEffectGrant('generate_image', IMG, 'test');
        await expect(runWithEffectContext(ctx, () =>
            ensureEffectConsent('generate_image', { prompt: 'otra imagen', style: 'PHOTOREALISTIC' }, 'boundary')))
            .rejects.toThrow(/MISMATCH/);
    });

    it('CROSS-PRINCIPAL / foreign context: a grant issued by principal A consumed in B\'s chain still binds exact args only', async () => {
        // Grants are bearer-by-design BUT single-use and args-bound: B cannot
        // use A's grant for anything except the exact approved args, once.
        const ctxA = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'chat:principalA');
        const foreign = { ...ctxA, issuedBy: 'chat:principalB', validated: new Set<string>(), validatedKinds: new Set<string>() };
        await expect(runWithEffectContext(foreign, () =>
            ensureEffectConsent('send_email', { to: 'distinto@b.c', subject: 's', body: 'b' }, 'principalB')))
            .rejects.toThrow(/MISMATCH/);
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('CAMPAIGN CHILDREN: one grant does not cover a second independent piece', async () => {
        // Two different images inside one wrapper chain: after the first
        // consumes the grant, a second chain with the same token is denied.
        const ctx = issueEffectGrant('generate_image', IMG, 'POST /v1/media/generate/image');
        await runWithEffectContext(ctx, () => ensureEffectConsent('generate_image', IMG, 'piece1'));
        const childCtx = { grant: ctx.grant, validated: new Set<string>(), validatedKinds: new Set<string>(), issuedBy: 'campaign' };
        await expect(runWithEffectContext(childCtx, () =>
            ensureEffectConsent('generate_image', { prompt: 'pieza 2', style: 'PHOTOREALISTIC' }, 'piece2')))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
    });

    it('WRAPPER DERIVATION: one approved logical generation passes its own 1:1 nested layers', async () => {
        // mediaService validates {prompt, style}; imageFactory derives
        // aspectRatio for the SAME logical image: passes once, same chain.
        const ctx = issueEffectGrant('generate_image', IMG, 'test');
        await runWithEffectContext(ctx, async () => {
            await ensureEffectConsent('generate_image', IMG, 'mediaService');
            const inner = await ensureEffectConsent('generate_image', { ...IMG, aspectRatio: '16:9' }, 'imageFactory');
            expect(inner.via).toBe('grant');
        });
    });
});

describe('describeEffect', () => {
    it('shows recipient and subject for email review', () => {
        const s = describeEffect('send_email', { to: 'x@y.z', subject: 'Hola', body: 'contenido' });
        expect(s).toContain('x@y.z');
        expect(s).toContain('Hola');
    });
    it('flags provider cost for generation', () => {
        expect(describeEffect('generate_image', { prompt: 'p' })).toContain('coste de proveedor');
        expect(describeEffect('generate_voice', { text: 't' })).toContain('coste de proveedor');
    });
});

describe('chat path (confirmationGate) covers generation effects', () => {
    it('generate_image/video/voice are chat-gated: no principal -> blocked, principal -> pending explicit token', async () => {
        const { confirmationGate, EXTERNAL_EFFECT_TOOLS } = await import('../../services/tools/confirmationGate');
        expect(EXTERNAL_EFFECT_TOOLS.has('generate_image')).toBe(true);
        expect(EXTERNAL_EFFECT_TOOLS.has('generate_video')).toBe(true);
        expect(EXTERNAL_EFFECT_TOOLS.has('generate_voice')).toBe(true);

        // No authenticated principal: hard block, nothing executes.
        const blocked = confirmationGate.check('generate_image', { prompt: 'x' });
        expect(blocked.action).toBe('BLOCKED_NO_PRINCIPAL');

        // Authenticated chat: explicit per-call confirmation required
        // (CONFIRMAR <token> with identical args), not assumed from chat.
        const d = confirmationGate.check('generate_image', { prompt: 'x' }, 'user-1', 'conv-1');
        expect(d.action).toBe('PENDING');
        if (d.action === 'PENDING') expect(d.pending.summary).toContain('coste de proveedor');
    });
});
