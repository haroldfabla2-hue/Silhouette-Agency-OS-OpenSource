
import { ElevenLabsClient } from "elevenlabs";
import fs from 'fs';
import path from 'path';

export class ElevenLabsService {
    private client: ElevenLabsClient | null = null;
    private defaultVoiceId: string = "JBFqnCBsd6RMkjVDRZzb"; // Example: "George" or similar standard voice

    constructor() {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (apiKey) {
            this.client = new ElevenLabsClient({ apiKey });
            console.log("[ElevenLabs] Service Initialized.");
        } else {
            console.warn("[ElevenLabs] ⚠️ ELEVENLABS_API_KEY missing. Voice disabled.");
        }
    }

    public async generateSpeech(text: string, outputPath: string): Promise<string | null> {
        if (!this.client) return null;

        console.log(`[ElevenLabs] 🗣️ Speaking: "${text.substring(0, 30)}..."`);

        try {
            const response = await this.client.textToSpeech.convert(this.defaultVoiceId, {
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
}

export const elevenLabsService = new ElevenLabsService();
