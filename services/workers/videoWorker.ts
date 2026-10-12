import { systemBus } from "../systemBus";
import { SystemProtocol } from "../../types";
import { videoFactory } from "../media/videoFactory";
import { veoService } from "../media/veoService";

type VideoEngine = 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID' | 'KLING' | 'VEO';

/**
 * VideoWorker
 * -----------
 * Handles PROTOCOL_VIDEO_REQUEST jobs by generating video through the REAL
 * media stack (VideoFactory):
 *  - Cloud: Veo 3.1 via the official Replicate client (REPLICATE_API_TOKEN).
 *  - Local: the ComfyUI render queue (scripts/process_video_queue.ts) for
 *    local engines (WAN/SVD/...). A queued job is reported as QUEUED, never
 *    as a finished video.
 * Truthfulness contract: without a usable provider the worker reports an
 * honest UNAVAILABLE incident with activation instructions. It never emits a
 * fabricated or placeholder video URL as a result.
 */
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

    private reportUnavailable(jobId: string, reason: string) {
        console.warn(`[VIDEO WORKER] ⚠️ ${reason}`);
        systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
            error: reason,
            jobId
        });
    }

    private async processVideoJob(payload: {
        prompt: string;
        jobId: string;
        agentId: string;
        duration?: number;
        engine?: VideoEngine;
        imagePath?: string;
    }) {
        const { prompt, jobId, agentId } = payload;
        const duration = payload.duration || 5;
        const engine: VideoEngine = payload.engine || 'VEO';

        console.log(`[VIDEO WORKER] 🔨 Starting Job ${jobId}: "${prompt}" (engine: ${engine}, ${duration}s)`);
        this.isProcessing = true;

        try {
            if (!prompt || !prompt.trim()) {
                this.reportUnavailable(jobId, 'INVALID: video generation requires a non-empty prompt.');
                return;
            }

            // Cloud engine without credentials => honest UNAVAILABLE with
            // activation instructions (never a fabricated result, never a
            // silent downgrade to a queued local job the caller did not ask
            // for).
            if (engine === 'VEO' && !veoService.isAvailable()) {
                this.reportUnavailable(
                    jobId,
                    'UNAVAILABLE: cloud video generation requires REPLICATE_API_TOKEN (Veo 3.1 via Replicate). ' +
                    'Set REPLICATE_API_TOKEN in .env.local, or request a local engine (WAN/SVD) which is queued ' +
                    'for the local ComfyUI renderer (scripts/process_video_queue.ts).'
                );
                return;
            }

            const result = await videoFactory.createVideo(prompt, duration, payload.imagePath, engine);

            if (!result) {
                this.reportUnavailable(
                    jobId,
                    `FAILED: video generation for engine ${engine} returned no result. Check provider credentials (REPLICATE_API_TOKEN) or the local render queue.`
                );
                return;
            }

            if (result.provider.startsWith('LOCAL_QUEUE_')) {
                // Honest state: the job is QUEUED for the local renderer; no
                // video exists yet. Reported as such, not as a finished video.
                console.log(`[VIDEO WORKER] 📥 Job ${jobId} queued for local render (ticket ${result.url}).`);
                systemBus.emit(SystemProtocol.TASK_COMPLETION, {
                    taskId: jobId,
                    taskName: 'Video Generation (queued for local render)',
                    result: result.url,
                    queued: true,
                    provider: result.provider,
                    howToRender: 'Run scripts/process_video_queue.ts with the local ComfyUI stack to render this ticket.',
                    agentId
                });
                return;
            }

            // Real cloud render: result.url is the provider-hosted video URL.
            console.log(`[VIDEO WORKER] ✅ Job ${jobId} completed via ${result.provider}.`);
            systemBus.emit(SystemProtocol.TASK_COMPLETION, {
                taskId: jobId,
                taskName: `Video Generation (${result.provider} via Replicate)`,
                result: result.url,
                audioUrl: result.audioUrl,
                provider: result.provider,
                agentId
            });

        } catch (error: any) {
            console.error('[VIDEO WORKER] ❌ Job failed:', error);
            this.reportUnavailable(jobId, `FAILED: ${error?.message || error}`);
        } finally {
            this.isProcessing = false;
        }
    }
}

export const videoWorker = VideoWorker.getInstance();
