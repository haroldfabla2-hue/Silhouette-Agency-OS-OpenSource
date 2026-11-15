/**
 * Voice E2E — real ElevenLabs API through the production ElevenLabsService.
 *
 * Gating: runs ONLY when ELEVENLABS_API_KEY is present (server / local dev
 * with the real key). In CI (no key) it skips honestly — a skipped E2E is
 * reported as skipped, never as passed. Free tier only: one short TTS call,
 * no cloning, no paid features.
 */
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const hasKey = !!process.env.ELEVENLABS_API_KEY;
if (!hasKey) {
    console.warn('[voice-e2e] ELEVENLABS_API_KEY absent — E2E SKIPPED (honest skip; runs for real where the key lives).');
}
const suite = hasKey ? describe : describe.skip;

suite('voice E2E (ElevenLabs, real API)', () => {
    it('lists real voices and synthesizes real MP3 speech via ElevenLabsService', async () => {
        const { elevenLabsService } = await import('../../services/media/elevenLabsService');
        expect(elevenLabsService.isAvailable()).toBe(true);

        // Pick a real voice from the account — nothing hardcoded.
        const res = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY as string }
        });
        expect(res.ok).toBe(true);
        const data = await res.json() as { voices?: { voice_id: string }[] };
        const voiceId = data.voices?.[0]?.voice_id;
        expect(voiceId, 'account exposes at least one voice').toBeTruthy();

        const out = path.join(os.tmpdir(), `silhouette-voice-e2e-${Date.now()}.mp3`);
        try {
            const result = await elevenLabsService.generateSpeech(
                'Prueba de voz de Silhouette: síntesis real.', out, voiceId);
            expect(result).toBe(out);

            const buf = await fs.promises.readFile(out);
            expect(buf.length).toBeGreaterThan(1000);
            const isMp3 = buf.subarray(0, 3).toString('latin1') === 'ID3'
                || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
            expect(isMp3, 'output has MP3 magic bytes (real audio, not an error page)').toBe(true);
        } finally {
            await fs.promises.unlink(out).catch(() => {});
        }
    }, 60_000);
});
