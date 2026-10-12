import { systemBus } from "../systemBus";
import { SystemProtocol } from "../../types";
import { REPLICATE_CONFIG } from "../../constants";

export class VideoWorker {
    private static instance: VideoWorker;
    private isProcessing: boolean = false;

    private constructor() {
        this.subscribeToVideoRequests();
    }

    public static getInstance(): VideoWorker {
        if (!VideoWorker.instance) {
            VideoWorker.instance = new VideoWorker();
        }
        return VideoWorker.instance;
    }

    private subscribeToVideoRequests() {
        systemBus.subscribe('PROTOCOL_VIDEO_REQUEST' as any, async (event) => {
            console.log('[VIDEO WORKER] 🎬 Received video generation request:', event);
            await this.processVideoJob(event.payload);
        });
        console.log('[VIDEO WORKER] ✅ Online and listening for jobs.');
    }

    private async processVideoJob(payload: { prompt: string, jobId: string, agentId: string }) {
        const { prompt, jobId, agentId } = payload;

        console.log(`[VIDEO WORKER] 🔨 Starting Job ${jobId}: "${prompt}"`);
        this.isProcessing = true;

        try {
            // No provider key => honest UNAVAILABLE, never a fabricated result.
            if (!REPLICATE_CONFIG.apiKey) {
                const reason = 'UNAVAILABLE: video generation requires REPLICATE_API_TOKEN. Set it in .env.local to enable the Replicate (SVD) video worker.';
                console.warn(`[VIDEO WORKER] ⚠️ ${reason}`);
                systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
                    error: reason,
                    jobId
                });
                return;
            }
            {
                // Actual Replicate API call
                console.log('[VIDEO WORKER] 📡 Calling Replicate API...');

                try {
                    const response = await fetch('https://api.replicate.com/v1/predictions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Token ${REPLICATE_CONFIG.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            version: REPLICATE_CONFIG.models?.video || 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
                            input: { prompt }
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`Replicate API error: ${response.status}`);
                    }

                    const prediction = await response.json();

                    // Poll for completion
                    let status = prediction.status;
                    let result = prediction;

                    while (status === 'starting' || status === 'processing') {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        const pollResponse = await fetch(prediction.urls.get, {
                            headers: { 'Authorization': `Token ${REPLICATE_CONFIG.apiKey}` }
                        });
                        result = await pollResponse.json();
                        status = result.status;
                    }

                    if (status === 'succeeded' && result.output) {
                        const videoUrl = Array.isArray(result.output) ? result.output[0] : result.output;
                        systemBus.emit(SystemProtocol.TASK_COMPLETION, {
                            taskId: jobId,
                            taskName: 'Video Generation (Replicate)',
                            result: videoUrl,
                            agentId
                        });
                    } else {
                        throw new Error(`Replicate prediction failed: ${result.error || 'Unknown error'}`);
                    }
                } catch (apiError: any) {
                    console.error('[VIDEO WORKER] ❌ Replicate API error:', apiError.message);
                    throw apiError;
                }
            }

        } catch (error: any) {
            console.error('[VIDEO WORKER] ❌ Job failed:', error);
            systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
                error: error.message,
                jobId
            });
        } finally {
            this.isProcessing = false;
        }
    }
}

export const videoWorker = VideoWorker.getInstance();
