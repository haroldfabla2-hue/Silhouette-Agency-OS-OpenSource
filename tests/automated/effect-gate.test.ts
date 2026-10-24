/**
 * EFFECT GATE - consent decision logic.
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
    isGatedEffect,
    describeEffect,
    EFFECT_POLICIES
} from '../../services/security/effectGate';
import { runWithEffectContext } from '../../services/security/effectContext';

beforeEach(() => {
    requestConfirmation.mockReset();
});

describe('registry', () => {
    it('gates exactly the declared effects', () => {
        expect(isGatedEffect('send_email')).toBe(true);
        expect(isGatedEffect('github_create_pr')).toBe(true);
        expect(isGatedEffect('generate_image')).toBe(true);
        expect(isGatedEffect('generate_video')).toBe(true);
        expect(isGatedEffect('web_search')).toBe(false);
        expect(isGatedEffect('read_file')).toBe(false);
    });

    it('marks generation effects wallet-bearing', () => {
        expect(EFFECT_POLICIES.generate_image.walletBearing).toBe(true);
        expect(EFFECT_POLICIES.generate_video.walletBearing).toBe(true);
        expect(EFFECT_POLICIES.send_email.walletBearing).toBe(false);
    });
});

describe('ensureEffectConsent without context (autonomous origin)', () => {
    it('requires human confirmation and allows when approved', async () => {
        requestConfirmation.mockResolvedValue(true);
        const d = await ensureEffectConsent('send_email', { to: 'a@b.c', subject: 's', body: 'b' }, 'test:autonomous');
        expect(d).toEqual({ allowed: true, via: 'human-approval' });
        expect(requestConfirmation).toHaveBeenCalledTimes(1);
        const [action, reason] = requestConfirmation.mock.calls[0];
        expect(action.payload.effect).toBe('send_email');
        expect(action.payload.args.to).toBe('a@b.c');
        expect(reason).toContain('a@b.c');
        expect(reason).toContain('test:autonomous');
    });

    it('denies when rejected', async () => {
        requestConfirmation.mockResolvedValue(false);
        const d = await ensureEffectConsent('generate_image', { prompt: 'x', style: 'PHOTOREALISTIC' }, 'planExecutor:fallback');
        expect(d.allowed).toBe(false);
        if (!d.allowed) expect(d.reason).toContain('generate_image');
    });

    it('denies when confirmation times out (resolves false)', async () => {
        requestConfirmation.mockResolvedValue(false);
        const d = await ensureEffectConsent('generate_video', { prompt: 'y', engine: 'VEO' }, 'creativeDirectorSkill');
        expect(d.allowed).toBe(false);
    });

    it('uses a fail-closed action type the risk registry will not auto-approve', async () => {
        requestConfirmation.mockResolvedValue(true);
        await ensureEffectConsent('generate_image', { prompt: 'x' }, 'origin');
        const [action] = requestConfirmation.mock.calls[0];
        // GENERATE_IMAGE is deliberately not LOW-risk registered: the
        // actionExecutor risk classifier (fail-closed) treats it as HIGH.
        expect(action.type).toBe('GENERATE_IMAGE');
        expect(action.requiresApproval).toBe(true);
    });
});

describe('ensureEffectConsent with upstream context', () => {
    it('passes through with a confirmed context and never asks again', async () => {
        const d = await runWithEffectContext({ kind: 'confirmed', tool: 'send_email', source: 'actionExecutor' }, () =>
            ensureEffectConsent('send_email', { to: 'a@b.c' }, 'executeCapability:chat'));
        expect(d).toEqual({ allowed: true, via: 'context' });
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('passes through with a user-chat context', async () => {
        const d = await runWithEffectContext({ kind: 'user-chat', source: 'chatToolIntegration' }, () =>
            ensureEffectConsent('generate_image', { prompt: 'x' }, 'imageFactory.createAsset'));
        expect(d.allowed).toBe(true);
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('passes through with a user-http context', async () => {
        const d = await runWithEffectContext({ kind: 'user-http', source: 'POST /v1/gmail/send' }, () =>
            ensureEffectConsent('send_email', { to: 'a@b.c' }, 'gmailService.sendEmail'));
        expect(d.allowed).toBe(true);
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('context does not leak across independent executions', async () => {
        await runWithEffectContext({ kind: 'user-http', source: 'test' }, async () => {
            await ensureEffectConsent('send_email', {}, 'inside');
        });
        requestConfirmation.mockResolvedValue(false);
        const d = await ensureEffectConsent('send_email', {}, 'outside');
        expect(d.allowed).toBe(false);
        expect(requestConfirmation).toHaveBeenCalledTimes(1);
    });
});

describe('describeEffect', () => {
    it('shows recipient and subject for email review', () => {
        const s = describeEffect('send_email', { to: 'x@y.z', subject: 'Hola', body: 'contenido' });
        expect(s).toContain('x@y.z');
        expect(s).toContain('Hola');
    });
    it('flags provider cost for image generation', () => {
        expect(describeEffect('generate_image', { prompt: 'p' })).toContain('coste de proveedor');
    });
});
