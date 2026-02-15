import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VideoJob } from '../../types';
import { VideoAdvancedParams } from './videoFactory';

export class LocalVideoService {
    private queuePath: string;

    constructor() {
        this.queuePath = path.resolve(process.cwd(), 'data/queues/video_render_queue.json');
        this.ensureQueueFile();
        console.log("[LocalVideoService] Service Initialized (Async Queue with Advanced Params).");
    }

    private ensureQueueFile() {
        const dir = path.dirname(this.queuePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.queuePath)) {
            fs.writeFileSync(this.queuePath, '[]');
        }
    }

    public async queueVideoGeneration(
        prompt: string,
        imagePath?: string,
        engine: 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID' | 'KLING' | 'VEO' = 'WAN',
        duration: number = 5,
        advancedParams?: VideoAdvancedParams
    ): Promise<VideoJob | null> {
        console.log(`[LocalVideoService] 📥 Queuing Job: "${prompt}" (Engine: ${engine}, Duration: ${duration}s)`);

        if (advancedParams?.camera) {
            console.log(`[LocalVideoService] 🎥 Camera: ${advancedParams.camera.movement} (${advancedParams.camera.speed})`);
        }
        if (advancedParams?.keyframeStart || advancedParams?.keyframeEnd) {
            console.log(`[LocalVideoService] 🖼️ Keyframes: A=${!!advancedParams?.keyframeStart} B=${!!advancedParams?.keyframeEnd}`);
        }

        const job: VideoJob = {
            id: uuidv4(),
            prompt: prompt,
            imagePath: imagePath,
            engine: engine,
            status: 'QUEUED',
            createdAt: new Date().toISOString(),
            provider: `LOCAL_${engine}`,
            // Store all advanced params
            duration: duration,
            fps: advancedParams?.fps,
            aspectRatio: advancedParams?.aspectRatio,
            resolution: advancedParams?.resolution,
            camera: advancedParams?.camera,
            keyframeStart: advancedParams?.keyframeStart,
            keyframeEnd: advancedParams?.keyframeEnd,
            guidanceScale: advancedParams?.guidanceScale,
            inferenceSteps: advancedParams?.inferenceSteps,
            motionStrength: advancedParams?.motionStrength,
            negativePrompt: advancedParams?.negativePrompt,
            seed: advancedParams?.seed,
            stylePreset: advancedParams?.stylePreset
        };

        try {
            const queueData = fs.readFileSync(this.queuePath, 'utf-8');
            const queue: VideoJob[] = JSON.parse(queueData);
            queue.push(job);
            fs.writeFileSync(this.queuePath, JSON.stringify(queue, null, 2));

            console.log(`[LocalVideoService] ✅ Job Queued: ${job.id}`);
            return job;
        } catch (error) {
            console.error("[LocalVideoService] Queue Write Failed:", error);
            return null;
        }
    }

    public getQueueStatus(): VideoJob[] {
        try {
            if (fs.existsSync(this.queuePath)) {
                const data = fs.readFileSync(this.queuePath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error("[LocalVideoService] Failed to read queue:", e);
        }
        return [];
    }
}

export const localVideoService = new LocalVideoService();

