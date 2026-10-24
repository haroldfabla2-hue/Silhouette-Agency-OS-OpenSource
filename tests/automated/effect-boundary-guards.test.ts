/**
 * Provider-boundary guards: direct callers that bypass executeCapability
 * still hit the effect gate.
 *
 * DECLARED DOUBLES (mechanics only, no real effects): all provider modules
 * (nanoBanana, veo, local video, googleapis, stock, media manager) and the
 * actionExecutor behind the gate are mocked. Nothing sends, generates or
 * spends; the tests assert call-blocking and pass-through wiring only.
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

// --- imageFactory doubles ---
vi.mock('../../services/media/nanoBananaService', () => ({
    nanoBanana: { generateImage: nanoGenerate }
}));
vi.mock('../../services/media/stockService', () => ({ stockService: {} }));
vi.mock('../../services/providerHealthManager', () => ({
    providerHealth: { isAvailable: vi.fn().mockReturnValue(false), reportSuccess: vi.fn(), reportFailure: vi.fn() }
}));
vi.mock('../../services/mediaManager', () => ({ mediaManager: { registerAsset: vi.fn() } }));
vi.mock('../../services/workflows/dreamShaperWorkflow', () => ({ getDreamShaperWorkflow: vi.fn() }));

// --- videoFactory doubles ---
vi.mock('../../services/media/veoService', () => ({
    veoService: { isAvailable: vi.fn().mockReturnValue(true), generateVideo: veoGenerate }
}));
vi.mock('../../services/media/localVideoService', () => ({
    localVideoService: { queueVideoGeneration: localQueue }
}));

import { imageFactory } from '../../services/media/imageFactory';
import { videoFactory } from '../../services/media/videoFactory';
import { runWithEffectContext } from '../../services/security/effectContext';

beforeEach(() => {
    requestConfirmation.mockReset();
    nanoGenerate.mockReset();
    veoGenerate.mockReset();
    localQueue.mockReset();
});

describe('imageFactory.createAsset boundary guard', () => {
    it('blocks an autonomous direct call when the human rejects, before any provider attempt', async () => {
        requestConfirmation.mockResolvedValue(false);
        const asset = await imageFactory.createAsset({ prompt: 'landing hero', style: 'PHOTOREALISTIC' });
        expect(asset).toBeNull();
        expect(requestConfirmation).toHaveBeenCalledTimes(1);
        expect(nanoGenerate).not.toHaveBeenCalled();
    });

    it('allows an autonomous direct call after human approval', async () => {
        requestConfirmation.mockResolvedValue(true);
        // Providers are double-mocked unavailable, so the generation itself
        // yields null - the assertion is that the gate let it THROUGH.
        const asset = await imageFactory.createAsset({ prompt: 'landing hero', style: 'PHOTOREALISTIC' });
        expect(asset).toBeNull();
        expect(requestConfirmation).toHaveBeenCalledTimes(1);
        const [action] = requestConfirmation.mock.calls[0];
        expect(action.payload.effect).toBe('generate_image');
    });

    it('does not re-gate inside an approved context', async () => {
        const asset = await runWithEffectContext({ kind: 'confirmed', tool: 'generate_image' }, () =>
            imageFactory.createAsset({ prompt: 'x', style: 'ILLUSTRATION' }));
        expect(asset).toBeNull(); // providers mocked unavailable
        expect(requestConfirmation).not.toHaveBeenCalled();
    });
});

describe('videoFactory.createVideo boundary guard (VEO cloud only)', () => {
    it('blocks autonomous VEO generation on rejection before calling the provider', async () => {
        requestConfirmation.mockResolvedValue(false);
        const r = await videoFactory.createVideo('clip', 5, undefined, 'VEO');
        expect(r).toBeNull();
        expect(veoGenerate).not.toHaveBeenCalled();
        expect(localQueue).not.toHaveBeenCalled(); // no silent local fallback of a denied cloud request
    });

    it('does not gate local engines (no provider spend)', async () => {
        localQueue.mockResolvedValue({ url: 'ticket-1', provider: 'LOCAL' });
        const r = await videoFactory.createVideo('clip', 5, undefined, 'WAN');
        expect(requestConfirmation).not.toHaveBeenCalled();
        expect(localQueue).toHaveBeenCalledTimes(1);
    });

    it('passes VEO through inside an approved context', async () => {
        veoGenerate.mockResolvedValue({ videoUrl: 'v', provider: 'VEO', audioUrl: undefined });
        const r = await runWithEffectContext({ kind: 'user-chat' }, () =>
            videoFactory.createVideo('clip', 5, undefined, 'VEO'));
        expect(requestConfirmation).not.toHaveBeenCalled();
        expect(veoGenerate).toHaveBeenCalledTimes(1);
        expect(r?.url).toBe('v');
    });
});
