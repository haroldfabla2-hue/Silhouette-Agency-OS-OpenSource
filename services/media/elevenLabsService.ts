
import { ElevenLabsClient } from "elevenlabs";
import fs from 'fs';
import path from 'path';

export class ElevenLabsService {
    private client: ElevenLabsClient | null = null;
    // Default voice is configurable; no hardcoded voice identity baked in.
    private defaultVoiceId: string = process.env.ELEVENLABS_VOICE_ID || "";

    constructor() {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (apiKey) {
            this.client = new ElevenLabsClient({ apiKey });
            console.log("[ElevenLabs] Service Initialized.");
        } else {
            console.warn("[ElevenLabs] ⚠️ ELEVENLABS_API_KEY missing. Voice disabled.");
        }
    }

    public async generateSpeech(text: string, outputPath: string, voiceId?: string): Promise<string | null> {
        // [SECURITY] EFFECT GATE (provider boundary): ElevenLabs synthesis is
        // wallet-bearing and callers (campaigns, production, TTS routes) may
        // bypass executeCapability. Throws EffectDeniedError (typed) on
        // denial; without a grant a human confirms via
        // /v1/autonomy/confirmations.
        {
            const { ensureEffectConsent } = await import('../security/effectGate');
            await ensureEffectConsent(
                'generate_voice',
                { text, voiceId },
                'elevenLabsService.generateSpeech',
                { providerBoundary: true }
            );
        }

        if (!this.client) return null;
        const effectiveVoiceId = voiceId || this.defaultVoiceId;
        if (!effectiveVoiceId) {
            console.warn("[ElevenLabs] No voice configured (ELEVENLABS_VOICE_ID). Speech skipped.");
            return null;
        }

        console.log(`[ElevenLabs] 🗣️ Speaking: "${text.substring(0, 30)}..."`);

        try {
            const response = await this.client.textToSpeech.convert(effectiveVoiceId, {
                text: text,
                model_id: "eleven_multilingual_v2",
                output_format: "mp3_44100_128",
            });

            // Handle response: The SDK returns a ReadableStream (or Node stream)
            const stream = response as any;
            const chunks: any[] = [];

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            const buffer = Buffer.concat(chunks);
            await fs.promises.writeFile(outputPath, buffer);

            return outputPath;

        } catch (error) {
            console.error("[ElevenLabs] Speech Generation Failed:", error);
            // Fallback: Try to handle it as a stream event if arrayBuffer fails
            return null;
        }
    }

    public isAvailable(): boolean {
        return this.client !== null;
    }

    /**
     * Real Instant Voice Cloning via the ElevenLabs API.
     * Uploads the sample and returns the provider voice_id. Never faked:
     * callers must check isAvailable() first and report UNAVAILABLE otherwise.
     */
    public async cloneVoice(name: string, samplePath: string): Promise<{ voiceId: string } | null> {
        if (!this.client) return null;

        console.log(`[ElevenLabs] 🧬 Cloning voice "${name}" from ${path.basename(samplePath)}...`);
        try {
            const fileStream = fs.createReadStream(samplePath);
            const result: any = await (this.client as any).voices.add({
                name,
                files: [fileStream]
            });
            const voiceId = result?.voice_id || result?.voiceId;
            if (!voiceId) {
                console.error("[ElevenLabs] Clone response had no voice_id:", result);
                return null;
            }
            console.log(`[ElevenLabs] ✅ Voice cloned: ${voiceId}`);
            return { voiceId };
        } catch (error) {
            console.error("[ElevenLabs] Voice cloning failed:", error);
            return null;
        }
    }
}

export const elevenLabsService = new ElevenLabsService();
