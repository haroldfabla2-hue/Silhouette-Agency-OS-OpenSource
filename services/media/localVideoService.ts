import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VideoJob } from '../../types';
import { VideoAdvancedParams } from './videoFactory';

export class LocalVideoService {
    private queuePath: string;

    constructor() {
        // [R10] tests/scripts isolate their queue via SILHOUETTE_QUEUE_DIR so
        // a verification run can never pollute the user's render queue.
        const queueDir = process.env.SILHOUETTE_QUEUE_DIR || 'data/queues';
        this.queuePath = path.resolve(process.cwd(), queueDir, 'video_render_queue.json');
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
        advancedParams?: VideoAdvancedParams,
        origin: 'USER' | 'TEST' = 'USER'
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
            stylePreset: advancedParams?.stylePreset,
            origin
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

    /**
     * [R10] Remove a job created by a verification script. TEST-origin only:
     * the user's production queue can never be deleted through this path.
     */
    public removeTestJob(jobId: string): { removed: boolean; reason?: string } {
        try {
            const queueData = fs.readFileSync(this.queuePath, 'utf-8');
            const queue: VideoJob[] = JSON.parse(queueData);
            const job = queue.find(j => j.id === jobId);
            if (!job) return { removed: false, reason: 'not_found' };
            if (job.origin !== 'TEST') return { removed: false, reason: 'not_test_origin' };
            fs.writeFileSync(this.queuePath, JSON.stringify(queue.filter(j => j.id !== jobId), null, 2));
            return { removed: true };
        } catch (error) {
            console.error("[LocalVideoService] Test-job removal failed:", error);
            return { removed: false, reason: 'io_error' };
        }
    }

    /**
     * [HYGIENE] Quarantine legacy jobs with backup-first semantics (never delete):
     * the FULL queue file is copied to
     * <SILHOUETTE_QUARANTINE_DIR|data/quarantine>/media-queue-<ts>/ together with
     * a MANIFEST.json (criteria + ids) BEFORE the live queue is rewritten without
     * the matching jobs. Criteria: createdAt before `olderThan` (ISO) and/or
     * explicit ids. Returns the backup dir as evidence.
     */
    public quarantineJobs(criteria: { olderThan?: string; ids?: string[] }): { quarantined: number; backupDir: string } {
        let queue: VideoJob[] = [];
        try {
            queue = JSON.parse(fs.readFileSync(this.queuePath, 'utf-8'));
        } catch (e) {
            console.error("[LocalVideoService] Failed to read queue for quarantine:", e);
            return { quarantined: 0, backupDir: '' };
        }
        const cutoff = criteria.olderThan ? new Date(criteria.olderThan).getTime() : null;
        const idSet = criteria.ids ? new Set(criteria.ids) : null;
        const matches = (j: VideoJob): boolean => {
            if (idSet && idSet.has(j.id)) return true;
            if (cutoff !== null && new Date(j.createdAt).getTime() < cutoff) return true;
            return false;
        };
        const victims = queue.filter(matches);
        if (victims.length === 0) return { quarantined: 0, backupDir: '' };

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const quarantineBase = process.env.SILHOUETTE_QUARANTINE_DIR || 'data/quarantine';
        const backupDir = path.resolve(process.cwd(), quarantineBase, `media-queue-${ts}`);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'video_render_queue.backup.json'), JSON.stringify(queue, null, 2));
        fs.writeFileSync(path.join(backupDir, 'MANIFEST.json'), JSON.stringify({
            quarantinedAt: new Date().toISOString(),
            criteria,
            quarantinedIds: victims.map(v => v.id),
            totalJobsBefore: queue.length,
        }, null, 2));

        const remaining = queue.filter(j => !matches(j));
        fs.writeFileSync(this.queuePath, JSON.stringify(remaining, null, 2));
        console.log(`[LocalVideoService] Quarantined ${victims.length} jobs -> ${backupDir}`);
        return { quarantined: victims.length, backupDir };
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
