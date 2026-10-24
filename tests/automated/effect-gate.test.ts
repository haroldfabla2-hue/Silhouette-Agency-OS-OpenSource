/**
 * EFFECT GATE v4 - specific, single-use, args-bound authority; the grant is
 * consumed at the PROVIDER-INVOKING boundary, so exactly one provider
 * invocation is authorized per grant even under parallel consumers with
 * identical args. Wrapper layers validate without consuming.
 *
 * Wallet-bearing effects (cloud image/video/voice) are HARD-BLOCKED in this
 * delivery: no flag, grant or human click is budget authority.
 *
 * Real denial/consent tests with DECLARED doubles: actionExecutor is mocked
 * (its requestConfirmation is the human decision point; the double only
 * simulates approve/reject - no email, no generation, no spend).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requestConfirmation } = vi.hoisted(() => ({
    requestConfirmation: vi.fn()
}));
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
    it('chat-origin paid effect without any grant: hard-denied WITHOUT asking (no budget/cap in this delivery)', async () => {
        await expect(ensureEffectConsent('generate_image', IMG, 'chatToolIntegration:chat'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(requestConfirmation).not.toHaveBeenCalled();
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
    it('a valid grant authorizes its exact effect+args (consumed at the provider boundary)', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'test');
        const d = await runWithEffectContext(ctx, () =>
            ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'gmailService.sendEmail', { providerBoundary: true }));
        expect(d.via).toBe('grant');
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('REPLAY: the same grant cannot authorize a second chain', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'test');
        await runWithEffectContext(ctx, () => ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'boundary', { providerBoundary: true }));
        // New chain, same token, no prior validation: ALREADY_USED.
        const replayCtx = { grant: ctx.grant, validated: new Map<string, Set<string>>(), issuedBy: 'attacker-or-bug' };
        await expect(runWithEffectContext(replayCtx, () => ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'replay')))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        await expect(runWithEffectContext(replayCtx, () => ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'replay')))
            .rejects.toThrow(/ALREADY_USED/);
    });

    it('CROSS-ARGS: a grant for email X denies email Y (MISMATCH)', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'test');
        await expect(runWithEffectContext(ctx, () =>
            ensureEffectConsent('send_email', { to: 'b@b.c', subject: 's', body: 'b' }, 'boundary')))
            .rejects.toThrow(/MISMATCH/);
    });

    it('CROSS-PRINCIPAL / foreign context: a grant issued by principal A consumed in B\'s chain still binds exact args only', async () => {
        // Grants are bearer-by-design BUT single-use and args-bound: B cannot
        // use A's grant for anything except the exact approved args, once.
        const ctxA = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'chat:principalA');
        const foreign = { ...ctxA, issuedBy: 'chat:principalB', validated: new Map<string, Set<string>>() };
        await expect(runWithEffectContext(foreign, () =>
            ensureEffectConsent('send_email', { to: 'distinto@b.c', subject: 's', body: 'b' }, 'principalB')))
            .rejects.toThrow(/MISMATCH/);
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('CAMPAIGN CHILDREN: one grant does not cover a second independent piece', async () => {
        // Two different emails inside one wrapper chain: after the first
        // consumes the grant, a second chain with the same token is denied.
        const ctx = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'campaign:parent');
        await runWithEffectContext(ctx, () => ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'boundary1', { providerBoundary: true }));
        const childCtx = { grant: ctx.grant, validated: new Map<string, Set<string>>(), issuedBy: 'campaign' };
        await expect(runWithEffectContext(childCtx, () =>
            ensureEffectConsent('send_email', { to: 'b@b.c', subject: 's', body: 'b' }, 'piece2')))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
    });

    it('WRAPPER 1:1: defaults normalized before binding - raw and defaulted args produce the SAME digest', () => {
        // Grant issued on RAW args {prompt, style}; the boundary sees handler
        // defaults applied (aspectRatio '16:9'). Normalized digests must match,
        // or wrapper layers of one logical invocation would be denied.
        const granted = issueEffectGrant('generate_image', IMG, 'test').grant.binding.digest;
        const boundary = effectBinding('generate_image', { ...IMG, aspectRatio: '16:9' }).digest;
        expect(boundary).toBe(granted);
        // Multi-layer passing mechanics with that shared digest are covered by
        // the MULTI-LAYER test below (send_email, non-wallet).
    });

    it('DEFAULTS: grant issued with bare {prompt} binds the same digest as fully defaulted args', () => {
        const granted = issueEffectGrant('generate_image', { prompt: 'x' }, 'chat').grant.binding.digest;
        const boundary = effectBinding('generate_image', { prompt: 'x', style: 'PHOTOREALISTIC', aspectRatio: '16:9' }).digest;
        expect(boundary).toBe(granted);
    });

    it('SECOND PIECE, sequential same chain: different args after consume -> ALREADY_USED denial', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'test');
        await runWithEffectContext(ctx, async () => {
            await ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'boundary1', { providerBoundary: true });
            await expect(ensureEffectConsent('send_email', { to: 'b@b.c', subject: 's', body: 'b' }, 'piece2'))
                .rejects.toThrow(/ALREADY_USED/);
        });
    });

    it('SECOND PIECE, parallel same chain: two simultaneous different-args calls, only one can pass', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'test');
        const results = await runWithEffectContext(ctx, () => Promise.allSettled([
            ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'boundary1', { providerBoundary: true }),
            ensureEffectConsent('send_email', { to: 'b@b.c', subject: 's', body: 'b' }, 'boundary2', { providerBoundary: true })
        ]));
        const passed = results.filter(r => r.status === 'fulfilled');
        const denied = results.filter(r => r.status === 'rejected');
        expect(passed.length).toBe(1);
        expect(denied.length).toBe(1);
    });

    it('RETRY same args at the boundary: a grant authorizes exactly ONE provider invocation', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'r@x.com', subject: 'S', body: 'B' }, 'chat');
        await runWithEffectContext(ctx, async () => {
            await ensureEffectConsent('send_email', { to: 'r@x.com', subject: 'S', body: 'B' }, 'gmailService.sendEmail', { providerBoundary: true });
            await expect(ensureEffectConsent('send_email', { to: 'r@x.com', subject: 'S', body: 'B' }, 'gmailService.sendEmail', { providerBoundary: true }))
                .rejects.toThrow(/reintento denegado/);
        });
    });

    it('MULTI-LAYER wrappers validate without consuming; the single boundary consumes once', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'l@x.com', subject: 'S', body: 'B' }, 'chat');
        await runWithEffectContext(ctx, async () => {
            // Wrapper layers of ONE logical invocation: validate, no consume.
            for (const layer of ['executeCapability', 'mediaService', 'toolHandler']) {
                const d = await ensureEffectConsent('send_email', { to: 'l@x.com', subject: 'S', body: 'B' }, layer);
                expect(d.via).toBe('grant');
            }
            // The provider-invoking boundary consumes: exactly one invocation.
            await ensureEffectConsent('send_email', { to: 'l@x.com', subject: 'S', body: 'B' }, 'gmailService.sendEmail', { providerBoundary: true });
            // A retry at the boundary is denied; wrappers of the same chain
            // still pass (they invoke nothing).
            await expect(ensureEffectConsent('send_email', { to: 'l@x.com', subject: 'S', body: 'B' }, 'gmailService.sendEmail', { providerBoundary: true }))
                .rejects.toThrow(/reintento denegado/);
            const d = await ensureEffectConsent('send_email', { to: 'l@x.com', subject: 'S', body: 'B' }, 'mediaService');
            expect(d.via).toBe('grant');
        });
    });

    it('PARALLEL same args, parallel consumers: exactly ONE provider invocation per grant', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'p@x.com', subject: 'S', body: 'B' }, 'chat');
        const results = await runWithEffectContext(ctx, () => Promise.allSettled([
            ensureEffectConsent('send_email', { to: 'p@x.com', subject: 'S', body: 'B' }, 'consumerA', { providerBoundary: true }),
            ensureEffectConsent('send_email', { to: 'p@x.com', subject: 'S', body: 'B' }, 'consumerB', { providerBoundary: true }),
            ensureEffectConsent('send_email', { to: 'p@x.com', subject: 'S', body: 'B' }, 'consumerC', { providerBoundary: true })
        ]));
        expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
        expect(results.filter(r => r.status === 'rejected').length).toBe(2);
    });

    it('PARALLEL same args through wrappers + boundaries: wrappers all pass, exactly one boundary invocation', async () => {
        const ctx = issueEffectGrant('send_email', { to: 'w@x.com', subject: 'S', body: 'B' }, 'chat');
        const results = await runWithEffectContext(ctx, () => Promise.allSettled([
            // Chain 1: wrapper then boundary
            (async () => {
                await ensureEffectConsent('send_email', { to: 'w@x.com', subject: 'S', body: 'B' }, 'chain1-wrapper');
                return ensureEffectConsent('send_email', { to: 'w@x.com', subject: 'S', body: 'B' }, 'chain1-boundary', { providerBoundary: true });
            })(),
            // Chain 2: identical args in parallel
            (async () => {
                await ensureEffectConsent('send_email', { to: 'w@x.com', subject: 'S', body: 'B' }, 'chain2-wrapper');
                return ensureEffectConsent('send_email', { to: 'w@x.com', subject: 'S', body: 'B' }, 'chain2-boundary', { providerBoundary: true });
            })()
        ]));
        expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
        expect(results.filter(r => r.status === 'rejected').length).toBe(1);
    });
});

describe('CERO COBROS: paid effects hard-blocked in this delivery (no budget/cap mechanism)', () => {
    it('wallet-bearing effect denied even with an args-bound grant: a grant is not budget authority', async () => {
        const ctx = issueEffectGrant('generate_image', IMG, 'chat');
        await expect(runWithEffectContext(ctx, () => ensureEffectConsent('generate_image', IMG, 'boundary')))
            .rejects.toThrow(/presupuesto\/cap|no puede verificar coste/);
    });

    it('wallet-bearing effect denied WITHOUT asking a human: no click can authorize spend here', async () => {
        await expect(ensureEffectConsent('generate_voice', { text: 'x' }, 'daemon'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('non-wallet effects (send_email) still reach human confirmation', async () => {
        requestConfirmation.mockResolvedValue(true);
        const d = await ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'daemon');
        expect(d.via).toBe('human-approval');
    });

    it('no config flag is consulted for paid effects: denied unconditionally (video, image, voice)', async () => {
        // A boolean is not wallet authority. There is no enable-path at all:
        // the gate never reads config for wallet-bearing effects.
        for (const [effect, args] of [
            ['generate_video', { prompt: 'x' }],
            ['generate_image', { prompt: 'x' }],
            ['generate_voice', { text: 'x' }]
        ] as const) {
            await expect(ensureEffectConsent(effect, args, 'daemon'))
                .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        }
        expect(requestConfirmation).not.toHaveBeenCalled();
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
