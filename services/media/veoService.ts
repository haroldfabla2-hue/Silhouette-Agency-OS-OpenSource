
import Replicate from "replicate";
import { costEstimator } from "../costEstimator";
import { VideoAdvancedParams } from "./videoFactory";

interface VeoGenerationResult {
    videoUrl: string;
    audioUrl?: string;
    duration: number;
    provider: 'VEO_3.1' | 'VEO_3.1_FAST';
}

export class VeoService {
    private replicate: Replicate | null = null;
    private modelId: string;
    private fastModelId: string;

    constructor() {
        const token = process.env.REPLICATE_API_TOKEN;
        this.modelId = process.env.VEO_MODEL_ID || "google/veo-3.1";
        this.fastModelId = "google/veo-3.1-fast";

        if (token) {
            this.replicate = new Replicate({ auth: token });
            console.log("[VeoService] Service Initialized via Replicate.");
        } else {
            console.warn("[VeoService] ⚠️ REPLICATE_API_TOKEN missing. Video gen disabled.");
        }
    }

    /**
     * Generates a video with full advanced parameters support
     * Veo 3.1 features: Native audio, 4K, superior photorealism, camera understanding
     */
    public async generateVideo(
        prompt: string,
        durationSeconds: number = 5,
        options?: {
            aspectRatio?: string;
            generateAudio?: boolean;
            referenceImage?: string;
            advancedParams?: VideoAdvancedParams;
            useFastMode?: boolean;
        }
    ): Promise<VeoGenerationResult | null> {
        if (!this.replicate) return null;

        const useFast = options?.useFastMode || false;
        const effectiveModel = useFast ? this.fastModelId : this.modelId;

        console.log(`[VeoService] 🎬 Generating Video: "${prompt.substring(0, 60)}..." (Model: ${effectiveModel})`);

        // Build enhanced prompt with camera control
        let enhancedPrompt = prompt;
        if (options?.advancedParams?.camera) {
            const cameraPrefix = this.buildCameraPrompt(
                options.advancedParams.camera.movement,
                options.advancedParams.camera.speed
            );
            enhancedPrompt = `${cameraPrefix} ${prompt}`;
            console.log(`[VeoService] 🎥 Camera: ${options.advancedParams.camera.movement}`);
        }

        // Add style preset to prompt
        if (options?.advancedParams?.stylePreset && options.advancedParams.stylePreset !== 'none') {
            enhancedPrompt = `${enhancedPrompt}, ${options.advancedParams.stylePreset} style`;
        }

        try {
            const input: any = {
                prompt: enhancedPrompt,
                fps: options?.advancedParams?.fps || 24,
                duration: durationSeconds,
                aspect_ratio: options?.aspectRatio || '16:9',
                generate_audio: options?.generateAudio !== false, // Default true for Veo
            };

            // Add optional parameters
            if (options?.advancedParams?.negativePrompt) {
                input.negative_prompt = options.advancedParams.negativePrompt;
            }
            if (options?.advancedParams?.seed) {
                input.seed = options.advancedParams.seed;
            }
            if (options?.referenceImage) {
                input.reference_image = options.referenceImage;
            }
            if (options?.advancedParams?.motionStrength) {
                input.motion_bucket_id = Math.round(options.advancedParams.motionStrength * 127);
            }

            // Retry Loop for Rate Limits
            let maxRetries = 3;
            let attempt = 0;

            while (attempt < maxRetries) {
                try {
                    const output = await this.replicate.run(effectiveModel as any, { input });

                    // Track Cost (Video is expensive: ~$0.05-0.10/sec)
                    const estimatedCost = this.estimateCost(durationSeconds, useFast);
                    costEstimator.trackTransaction(
                        Math.round(estimatedCost * 1000), // Convert to tokens equivalent
                        10000,
                        useFast ? "veo-3.1-fast" : "veo-3.1"
                    );

                    // Parse output (can be string or array)
                    const videoUrl = Array.isArray(output) ? output[0] : String(output);
                    const audioUrl = Array.isArray(output) && output.length > 1 ? output[1] : undefined;

                    console.log(`[VeoService] ✅ Video Generated: ${videoUrl.substring(0, 50)}...`);

                    return {
                        videoUrl,
                        audioUrl,
                        duration: durationSeconds,
                        provider: useFast ? 'VEO_3.1_FAST' : 'VEO_3.1'
                    };

                } catch (err: any) {
                    if (String(err).includes("429") || (err.status && err.status === 429)) {
                        attempt++;
                        const waitTime = attempt * 5000;
                        console.warn(`[VeoService] ⚠️ Rate Limit Hit. Retrying in ${waitTime / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                    throw err;
                }
            }
            return null;

        } catch (error: any) {
            console.error("[VeoService] Generation Failed:", error.message || error);
            return null;
        }
    }

    /**
     * Build camera control prompt segment
     * Veo understands natural language camera directions
     */
    private buildCameraPrompt(movement: string, speed: string): string {
        const speedMap: Record<string, string> = {
            'slow': 'slow cinematic',
            'medium': 'smooth',
            'fast': 'fast dynamic'
        };

        const movementMap: Record<string, string> = {
            'static': 'static camera shot',
            'pan_left': 'camera pans left',
            'pan_right': 'camera pans right',
            'tilt_up': 'camera tilts upward',
            'tilt_down': 'camera tilts downward',
            'zoom_in': 'camera zooms in',
            'zoom_out': 'camera zooms out',
            'orbit': 'camera orbits around the subject',
            'dolly_in': 'camera dollies forward towards subject',
            'dolly_out': 'camera dollies backward away from subject',
            'crane_up': 'crane shot moving upward',
            'crane_down': 'crane shot descending'
        };

        const cameraMovement = movementMap[movement] || 'static camera';
        const cameraSpeed = speedMap[speed] || 'smooth';

        return `[${cameraSpeed} ${cameraMovement}]`;
    }

    /**
     * Estimate cost for a generation
     */
    public estimateCost(durationSeconds: number, useFastMode: boolean = false): number {
        const ratePerSecond = useFastMode ? 0.03 : 0.08;
        return durationSeconds * ratePerSecond;
    }

    /**
     * Check if service is available
     */
    public isAvailable(): boolean {
        return this.replicate !== null;
    }
}

export const veoService = new VeoService();

