/**
 * Paid provider edges — every direct provider fetch for wallet-bearing
 * media (Replicate image edit/upscale/composite/background/relight, cloud
 * TTS via ElevenLabs/OpenAI/MiniMax) is hard-blocked BEFORE the request in
 * this delivery (pending budget/cap), from EVERY caller path including the
 * mounted HTTP routes that reach these services. A controlled global fetch
 * spy proves no provider request is attempted.
 *
 * DECLARED DOUBLES: global fetch is spied (never executes), nothing is
 * sent or spent. Services are imported real; the gate is the real one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/actionExecutor', () => ({
    actionExecutor: { requestConfirmation: vi.fn() }
}));

import { mediaService } from '../../services/mediaService';
import { lipSyncService } from '../../services/media/lipSyncService';
import { minimaxService } from '../../services/minimaxService';

const fetchSpy = vi.fn();
beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const paidHosts = (calls: any[]) =>
    calls.filter(c => /replicate|elevenlabs|minimax|openai/i.test(String(c[0])));

describe('image edges (Replicate): hard-blocked before any request', () => {
    it('enhanceImage (route POST /v1/media/enhance reaches this)', async () => {
        await expect(mediaService.enhanceImage('https://img', 'polish')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('upscaleImage (route /v1/media/upscale)', async () => {
        await expect(mediaService.upscaleImage('https://img', 4)).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('generateComposite', async () => {
        await expect(mediaService.generateComposite('https://img', 'product')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('generateBackgroundFlux', async () => {
        await expect(mediaService.generateBackgroundFlux('studio')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('relightImageICLight', async () => {
        await expect(mediaService.relightImageICLight('https://img', 'soft light')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('generateVideo (mediaService direct path)', async () => {
        await expect(mediaService.generateVideo('clip')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
});

describe('voice edges (cloud TTS): hard-blocked before any request', () => {
    it('mediaService.generateSpeech (ElevenLabs/OpenAI chain)', async () => {
        await expect(mediaService.generateSpeech('hola')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('lipSyncService.generateSpeech (route /v1/media/generate/voice reaches this)', async () => {
        await expect(lipSyncService.generateSpeech('hola')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
    it('minimaxService.generateSpeech (route /v1/media/tts/speak via ttsService): quota is not authority', async () => {
        await expect(minimaxService.generateSpeech('hola')).rejects.toMatchObject({ code: 'EFFECT_DENIED' });
        expect(paidHosts(fetchSpy.mock.calls)).toHaveLength(0);
    });
});
