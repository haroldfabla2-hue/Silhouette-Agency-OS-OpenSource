import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Regression: the chat Listen button (POST /v1/media/tts/speak -> ttsService)
// had no working backend when Minimax had no API key and the local Python
// voice engine was not deployed: speak() returned null and Listen was dead.
// Worse, ElevenLabs was configured but never consulted. Additionally, the
// /output/... URLs returned by media services were swallowed by the SPA
// catch-all (soft-200 index.html) because no static route served them.
//
// Fix: ElevenLabs final fallback inside speak() (premade non-library voices
// work on the free tier; library voices are paid-plan only and must never be
// the default) + a real static route for /output.

const ROOT = path.resolve(__dirname, '..', '..');

describe('TTS ElevenLabs fallback for the Listen button', () => {
    it('speak() tries ElevenLabs after minimax and local, before giving up', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/ttsService.ts'), 'utf8');
        const elIdx = svc.indexOf('elevenLabsService.generateSpeech');
        const nullIdx = svc.indexOf('return null; // Fallback completely failed');
        expect(elIdx).toBeGreaterThan(-1);
        expect(nullIdx).toBeGreaterThan(-1);
        expect(elIdx).toBeLessThan(nullIdx);
    });

    it('the fallback reads the voice from ELEVENLABS_VOICE_ID and never defaults to a library voice', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/ttsService.ts'), 'utf8');
        expect(svc).toMatch(/process\.env\.ELEVENLABS_VOICE_ID/);
        expect(svc).toMatch(/ELEVENLABS_API_KEY/);
        // Rachel's id is a Voice Library voice (paid-plan only); it must not appear anywhere.
        expect(svc).not.toMatch(/21m00Tcm4TlvDq8ikWAM/);
    });

    it('generated audio is written under public/output/tts and returned as a /output/tts URL', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/ttsService.ts'), 'utf8');
        expect(svc).toMatch(/public\/output\/tts/);
        expect(svc).toMatch(/`\/output\/tts\/\$\{path\.basename\(spoken\)\}`/);
    });

    it('app.ts serves /output as real static files before the SPA catch-all', () => {
        const app = fs.readFileSync(path.join(ROOT, 'server/app.ts'), 'utf8');
        const staticIdx = app.indexOf("app.use('/output', express.static(");
        const spaIdx = app.indexOf('shouldServeUi');
        expect(staticIdx).toBeGreaterThan(-1);
        expect(spaIdx).toBeGreaterThan(-1);
        expect(staticIdx).toBeLessThan(spaIdx);
    });

    it('fallback degrades silently when ElevenLabs is not configured (no key, no voice)', () => {
        const svc = fs.readFileSync(path.join(ROOT, 'services/ttsService.ts'), 'utf8');
        // Guard: the fallback is conditional on BOTH env vars.
        expect(svc).toMatch(/if \(elKey && elVoice\)/);
    });
});
