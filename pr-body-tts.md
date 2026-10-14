## Why

Alberto (2026-10-14): "dale una voz por defecto" for the chat Listen button. Investigation found the Listen path (`POST /v1/media/tts/speak` → `ttsService.speak()`) had **no working backend**: provider `minimax` has no API key configured, the local Python voice engine is not deployed (`ECONNREFUSED :8100`), and `speak()` then returned `null` — even though an ElevenLabs key was configured, `ttsService` never consulted it. A first attempt with a default voice also failed: the configured id was a **Voice Library** voice, which is paid-plan only (`payment_required`); **premade** voices work on the free tier (verified live against the account: `CwhRBWXzGAHq8TQ4Fs17` "Roger" → HTTP 200 real MP3, and a prior E2E on the same account).

A second latent defect surfaced: media services return `/output/...` URLs, but no static route serves them — the SPA catch-all answers `index.html` with a soft 200, so generated audio/video was unreachable.

## What

- `ttsService.speak()`: after Minimax and the local engine fail, a final **ElevenLabs fallback** runs when `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are both set. Audio is written to `public/output/tts/` and returned as `/output/tts/<file>.mp3`. The provider-specific `voiceId` is not reused for ElevenLabs (it belongs to Minimax/local). When ElevenLabs is not configured, behavior is unchanged (`null`).
- `server/app.ts`: `app.use('/output', express.static('public/output'))` before the SPA catch-all, so generated media URLs (TTS and the existing lipsync ones) serve real files.
- Server config (not in this PR): `ELEVENLABS_VOICE_ID` set to the premade voice `CwhRBWXzGAHq8TQ4Fs17` ("Roger"), replacing the paid-plan-only library id. No hardcoding — env config only. Zero cost: free-tier premade TTS, no billing involved.

## Tests

`tests/automated/tts-elevenlabs-fallback.test.ts` (5/5 green): fallback runs after minimax/local and before giving up; voice read from env; no library-voice id anywhere; output path/URL convention; `/output` static route precedes the SPA catch-all; fallback is fully conditional on env config. `tsc --noEmit` clean.

## Live verification (production server)

Deployed runtime-ahead: `POST /v1/media/tts/speak` with Minimax unconfigured and no local engine now returns `{"success": true, "url": "/output/tts/<file>.mp3"}`, and `GET` on that URL serves a real MP3 (verified bytes, MPEG Layer III). Evidence in the task report. The Listen button (same endpoint) now has a working backend end-to-end at zero cost.
