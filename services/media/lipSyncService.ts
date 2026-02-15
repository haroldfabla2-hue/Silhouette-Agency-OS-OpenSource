/**
 * LipSyncService - Combines voice audio with video for synchronized lip movement
 * Integrates ElevenLabs TTS with Wav2Lip/Hallo2/LatentSync for lip sync
 * 
 * Pipeline: Text → ElevenLabs Voice → Base Video → LipSync → Final Video+Audio
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface LipSyncResult {
    videoUrl: string;
    audioUrl: string;
    duration: number;
    provider: string;
}

interface LipSyncConfig {
    elevenLabsKey?: string;
    elevenLabsVoiceId?: string;
    replicateKey?: string;
}

export class LipSyncService {
    private config: LipSyncConfig;
    private outputDir: string;

    // Replicate model for lip sync
    private readonly LIPSYNC_MODEL = 'cjwbw/wav2lip:67c7d30e7d916a76f33fdfab8d02f1a1abb48fcfc06d47b7bf7d0f77cc27b26c';

    constructor(config?: LipSyncConfig) {
        this.config = {
            elevenLabsKey: config?.elevenLabsKey || process.env.ELEVENLABS_API_KEY,
            elevenLabsVoiceId: config?.elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
            replicateKey: config?.replicateKey || process.env.REPLICATE_API_TOKEN
        };

        this.outputDir = path.resolve(process.cwd(), 'public/output/lipsync');
        this.ensureOutputDir();

        console.log(`[LipSyncService] Initialized. ElevenLabs: ${this.config.elevenLabsKey ? '✓' : '✗'}, Replicate: ${this.config.replicateKey ? '✓' : '✗'}`);
    }

    private ensureOutputDir(): void {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Generate speech from text using ElevenLabs
     */
    public async generateSpeech(text: string, voiceId?: string): Promise<{ audioUrl: string; duration: number } | null> {
        if (!this.config.elevenLabsKey) {
            console.error('[LipSyncService] ❌ ElevenLabs API key not configured');
            return null;
        }

        const vId = voiceId || this.config.elevenLabsVoiceId!;

        console.log(`[LipSyncService] 🎤 Generating speech: "${text.substring(0, 50)}..."`);

        try {
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': this.config.elevenLabsKey
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.5,
                        use_speaker_boost: true
                    }
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('[LipSyncService] ElevenLabs Error:', error);
                return null;
            }

            // Save audio file
            const audioBuffer = await response.arrayBuffer();
            const audioId = uuidv4();
            const audioPath = path.join(this.outputDir, `${audioId}.mp3`);
            fs.writeFileSync(audioPath, Buffer.from(audioBuffer));

            // Estimate duration (rough: ~150 words per minute, ~5 chars per word)
            const estimatedDuration = (text.length / 5 / 150) * 60;

            console.log(`[LipSyncService] ✅ Speech generated: ${audioPath} (~${estimatedDuration.toFixed(1)}s)`);

            return {
                audioUrl: `/output/lipsync/${audioId}.mp3`,
                duration: estimatedDuration
            };

        } catch (error) {
            console.error('[LipSyncService] Speech generation failed:', error);
            return null;
        }
    }

    /**
     * Apply lip sync to a video using the generated audio
     */
    public async applyLipSync(
        videoUrl: string,
        audioUrl: string
    ): Promise<LipSyncResult | null> {
        if (!this.config.replicateKey) {
            console.error('[LipSyncService] ❌ Replicate API key not configured');
            return null;
        }

        console.log(`[LipSyncService] 👄 Applying lip sync...`);
        console.log(`  Video: ${videoUrl}`);
        console.log(`  Audio: ${audioUrl}`);

        try {
            // Call Replicate Wav2Lip model
            const response = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.replicateKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    version: this.LIPSYNC_MODEL,
                    input: {
                        face: videoUrl,
                        audio: audioUrl,
                        pads: [0, 10, 0, 0],
                        resize_factor: 1,
                        fps: 25,
                        smooth: true,
                        nosmooth: false
                    }
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('[LipSyncService] Replicate Error:', error);
                return null;
            }

            const prediction = await response.json();

            // Poll for completion
            const result = await this.pollPrediction(prediction.id);

            if (result?.status === 'succeeded') {
                console.log(`[LipSyncService] ✅ Lip sync complete`);
                return {
                    videoUrl: result.output,
                    audioUrl: audioUrl,
                    duration: 0, // Would need to calculate from video
                    provider: 'WAV2LIP'
                };
            }

            console.error('[LipSyncService] Lip sync failed:', result?.error);
            return null;

        } catch (error) {
            console.error('[LipSyncService] Lip sync failed:', error);
            return null;
        }
    }

    /**
     * Full pipeline: Text → Voice → Video → LipSync → Result
     */
    public async generateTalkingHead(
        text: string,
        faceVideoUrl: string,
        voiceId?: string
    ): Promise<LipSyncResult | null> {
        console.log(`[LipSyncService] 🎬 Full Pipeline: Generating talking head...`);

        // Step 1: Generate speech
        const speech = await this.generateSpeech(text, voiceId);
        if (!speech) {
            console.error('[LipSyncService] Failed at speech generation');
            return null;
        }

        // Step 2: Apply lip sync
        const result = await this.applyLipSync(faceVideoUrl, speech.audioUrl);
        if (!result) {
            console.error('[LipSyncService] Failed at lip sync');
            return null;
        }

        result.duration = speech.duration;
        return result;
    }

    /**
     * Poll Replicate API for prediction completion
     */
    private async pollPrediction(predictionId: string, maxAttempts = 60): Promise<any> {
        for (let i = 0; i < maxAttempts; i++) {
            await this.delay(2000);

            const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                headers: {
                    'Authorization': `Bearer ${this.config.replicateKey}`
                }
            });

            if (!response.ok) continue;

            const prediction = await response.json();

            if (prediction.status === 'succeeded' || prediction.status === 'failed') {
                return prediction;
            }

            if (i % 5 === 0) {
                console.log(`[LipSyncService] ⏳ Processing... (${i * 2}s)`);
            }
        }

        return null;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get available ElevenLabs voices
     */
    public async getVoices(): Promise<any[]> {
        if (!this.config.elevenLabsKey) return [];

        try {
            const response = await fetch('https://api.elevenlabs.io/v1/voices', {
                headers: { 'xi-api-key': this.config.elevenLabsKey }
            });

            if (!response.ok) return [];

            const data = await response.json();
            return data.voices || [];
        } catch {
            return [];
        }
    }

    /**
     * Check if service is available
     */
    public isAvailable(): { speech: boolean; lipsync: boolean } {
        return {
            speech: !!this.config.elevenLabsKey,
            lipsync: !!this.config.replicateKey
        };
    }
}

export const lipSyncService = new LipSyncService();
