
import { localVideoService } from './localVideoService';
import { veoService } from './veoService';

// Advanced parameters interface (Kling-inspired)
export interface VideoAdvancedParams {
    fps?: number;
    aspectRatio?: string;
    resolution?: string;
    camera?: {
        movement: string;
        speed: string;
    };
    keyframeStart?: string;
    keyframeEnd?: string;
    guidanceScale?: number;
    inferenceSteps?: number;
    motionStrength?: number;
    negativePrompt?: string;
    seed?: number;
    stylePreset?: string;
}

export class VideoFactory {

    constructor() { }

    /**
     * Generates video with full parameter control.
     * Routes to appropriate service based on engine selection.
     */
    public async createVideo(
        prompt: string,
        duration: number = 5,
        imagePath?: string,
        engine: 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID' | 'KLING' | 'VEO' = 'WAN',
        advancedParams?: VideoAdvancedParams
    ): Promise<{ url: string, provider: string, audioUrl?: string } | null> {
        console.log(`[VideoFactory] 🎬 Processing Request: "${prompt}" (Engine: ${engine})`);

        if (advancedParams) {
            console.log(`[VideoFactory] Advanced Params:`, {
                camera: advancedParams.camera,
                hasKeyframes: !!(advancedParams.keyframeStart || advancedParams.keyframeEnd),
                fps: advancedParams.fps,
                motionStrength: advancedParams.motionStrength
            });
        }

        // === CLOUD ROUTING: VEO 3.1 ===
        if (engine === 'VEO') {
            console.log('[VideoFactory] 🌐 Routing to Veo 3.1 (Cloud Premium)');

            if (!veoService.isAvailable()) {
                console.error('[VideoFactory] ❌ Veo service not available (missing API key)');
                // Fallback to local
                return this.routeToLocal(prompt, imagePath, 'WAN', duration, advancedParams);
            }

            const result = await veoService.generateVideo(prompt, duration, {
                aspectRatio: advancedParams?.aspectRatio,
                generateAudio: true, // Veo's native audio feature
                referenceImage: imagePath,
                advancedParams,
                useFastMode: false // Use full quality mode
            });

            if (result) {
                return {
                    url: result.videoUrl,
                    provider: result.provider,
                    audioUrl: result.audioUrl
                };
            }

            console.warn('[VideoFactory] Veo generation failed, falling back to local');
            return this.routeToLocal(prompt, imagePath, 'WAN', duration, advancedParams);
        }

        // === LOCAL ROUTING: ComfyUI ===
        return this.routeToLocal(prompt, imagePath, engine, duration, advancedParams);
    }

    /**
     * Route to local ComfyUI queue
     */
    private async routeToLocal(
        prompt: string,
        imagePath: string | undefined,
        engine: 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID' | 'KLING' | 'VEO',
        duration: number,
        advancedParams?: VideoAdvancedParams
    ): Promise<{ url: string, provider: string } | null> {
        const ticket = await localVideoService.queueVideoGeneration(
            prompt,
            imagePath,
            engine,
            duration,
            advancedParams
        );

        if (ticket) {
            return { url: ticket.id, provider: `LOCAL_QUEUE_${engine}` };
        }

        return null;
    }
}

export const videoFactory = new VideoFactory();

