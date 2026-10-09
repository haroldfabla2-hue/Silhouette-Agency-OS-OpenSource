import { describe, it, expect, beforeAll, vi } from 'vitest';
import { telephonyService } from '../../services/telephony/telephonyService';
import { ttsService } from '../../services/ttsService';
import { geminiService } from '../../services/geminiService';

describe('Per-call voice (regression: voiceId was stored but the global voice was always used)', () => {
    beforeAll(() => { process.env.SILHOUETTE_DEMO_MODE = '1'; });

    it('passes the call voiceId to TTS', async () => {
        const speak = vi.spyOn(ttsService, 'speak').mockResolvedValue('data:audio/wav;base64,x');
        vi.spyOn(geminiService, 'generateText').mockResolvedValue('Hello there.');
        const { call } = await telephonyService.dial({ toNumber: '+15550100', purpose: 'test', voiceId: 'voice_call_specific' } as any);
        await telephonyService.processCallTurn(call.id, 'hi');
        expect(speak).toHaveBeenCalledWith(expect.any(String), { voiceId: 'voice_call_specific' });
    });
});
