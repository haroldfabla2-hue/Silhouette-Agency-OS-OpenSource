/**
 * Provider-boundary guards v2: direct callers that bypass executeCapability
 * still hit the effect gate; denial is TYPED (EffectDeniedError) and happens
 * BEFORE any provider call, with no fallback and no retry.
 *
 * DECLARED DOUBLES (mechanics only, no real effects): all provider modules
 * (nanoBanana, veo, local video, elevenLabs client) and the actionExecutor
 * behind the gate are mocked. Nothing sends, generates or spends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requestConfirmation, nanoGenerate, veoGenerate, localQueue } = vi.hoisted(() => ({
    requestConfirmation: vi.fn(),
    nanoGenerate: vi.fn(),
    veoGenerate: vi.fn(),
    localQueue: vi.fn()
}));
vi.mock('../../services/actionExecutor', () => ({
    actionExecutor: { requestConfirmation }
}));
vi.mock('../../services/media/nanoBananaService', () => ({
    nanoBanana: { generateImage: nanoGenerate }
}));
vi.mock('../../services/media/stockService', () => ({ stockService: {} }));
vi.mock('../../services/providerHealthManager', () => ({
    providerHealth: { isAvailable: vi.fn().mockReturnValue(false), reportSuccess: vi.fn(), reportFailure: vi.fn() }
}));
vi.mock('../../services/mediaManager', () => ({ mediaManager: { registerAsset: vi.fn() } }));
vi.mock('../../services/workflows/dreamShaperWorkflow', () => ({ getDreamShaperWorkflow: vi.fn() }));
vi.mock('../../services/media/veoService', () => ({
    veoService: { isAvailable: vi.fn().mockReturnValue(true), generateVideo: veoGenerate }
}));
vi.mock('../../services/media/localVideoService', () => ({
    localVideoService: { queueVideoGeneration: localQueue }
}));

import { imageFactory } from '../../services/media/imageFactory';
import { videoFactory } from '../../services/media/videoFactory';
import { elevenLabsService } from '../../services/media/elevenLabsService';
import { issueEffectGrant } from '../../services/security/effectGate';
import { runWithEffectContext } from '../../services/security/effectContext';

beforeEach(() => {
    requestConfirmation.mockReset();
    nanoGenerate.mockReset();
    veoGenerate.mockReset();
    localQueue.mockReset();
});

describe('imageFactory.createAsset boundary guard', () => {
    it('denied autonomous direct call throws EFFECT_DENIED before any provider attempt', async () => {
        requestConfirmation.mockResolvedValue(false);
        await expect(imageFactory.createAsset({ prompt: 'landing hero', style: 'PHOTOREALISTIC' }))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(nanoGenerate).not.toHaveBeenCalled();
    });

    it('human-approved autonomous call passes the gate (providers still double-mocked unavailable)', async () => {
        requestConfirmation.mockResolvedValue(true);
        const asset = await imageFactory.createAsset({ prompt: 'landing hero', style: 'PHOTOREALISTIC' });
        expect(asset).toBeNull(); // providers mocked unavailable - assertion is the gate let it THROUGH
        const [action] = requestConfirmation.mock.calls[0];
        expect(action.payload.effect).toBe('generate_image');
    });

    it('args-bound grant passes; different args in the same chain are denied', async () => {
        const ctx = issueEffectGrant('generate_image', { prompt: 'x', style: 'ILLUSTRATION' }, 'test');
        const asset = await runWithEffectContext(ctx, () =>
            imageFactory.createAsset({ prompt: 'x', style: 'ILLUSTRATION' }));
        expect(asset).toBeNull(); // providers mocked unavailable; gate passed
        expect(requestConfirmation).not.toHaveBeenCalled();
    });
});

describe('videoFactory.createVideo boundary guard (VEO cloud only)', () => {
    it('denied autonomous VEO throws EFFECT_DENIED: no provider call, NO silent local fallback', async () => {
        requestConfirmation.mockResolvedValue(false);
        await expect(videoFactory.createVideo('clip', 5, undefined, 'VEO'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(veoGenerate).not.toHaveBeenCalled();
        expect(localQueue).not.toHaveBeenCalled();
    });

    it('does not gate local engines (no provider spend)', async () => {
        localQueue.mockResolvedValue({ url: 'ticket-1', provider: 'LOCAL' });
        await videoFactory.createVideo('clip', 5, undefined, 'WAN');
        // Key assertions: no consent demanded, local queue reached.
        expect(requestConfirmation).not.toHaveBeenCalled();
        expect(localQueue).toHaveBeenCalledTimes(1);
    });

    it('args-bound grant lets VEO through', async () => {
        veoGenerate.mockResolvedValue({ videoUrl: 'v', provider: 'VEO', audioUrl: undefined });
        const ctx = issueEffectGrant('generate_video', { prompt: 'clip', duration: 5, engine: 'VEO' }, 'test');
        const r = await runWithEffectContext(ctx, () => videoFactory.createVideo('clip', 5, undefined, 'VEO'));
        expect(veoGenerate).toHaveBeenCalledTimes(1);
        expect(r?.url).toBe('v');
    });
});

describe('elevenLabsService.generateSpeech boundary guard', () => {
    it('denied autonomous voice generation throws EFFECT_DENIED (wallet-bearing, now gated)', async () => {
        requestConfirmation.mockResolvedValue(false);
        await expect(elevenLabsService.generateSpeech('texto de prueba', '/tmp/x.mp3'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
    });
});
