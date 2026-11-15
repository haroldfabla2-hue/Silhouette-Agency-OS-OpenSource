/**
 * [R10] Queue isolation: verification scripts must never pollute or delete
 * the user's video render queue.
 *
 * Root cause: tests/verify_media_endpoints.ts used to POST a "Test video"
 * into the production queue (data/queues/video_render_queue.json) with no
 * marker and no cleanup. Now:
 *  - SILHOUETTE_QUEUE_DIR isolates the queue file per environment
 *  - VideoJob.origin distinguishes USER vs TEST jobs
 *  - removeTestJob (DELETE /v1/media/queue/:id) refuses non-TEST jobs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { LocalVideoService } from '../../services/media/localVideoService';

function freshService(queueDir: string) {
    // constructor reads SILHOUETTE_QUEUE_DIR, so a new instance per test
    // gets its own isolated queue file
    process.env.SILHOUETTE_QUEUE_DIR = queueDir;
    return new LocalVideoService();
}

describe('R10: test queue isolation', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r10-queue-'));
    });

    afterEach(() => {
        delete process.env.SILHOUETTE_QUEUE_DIR;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('honors SILHOUETTE_QUEUE_DIR and never touches the default queue path', async () => {
        const service = freshService(tmpDir);
        const job = await service.queueVideoGeneration('isolated test job', undefined, 'WAN', 5, undefined, 'TEST');
        expect(job).not.toBeNull();

        const queueFile = path.join(tmpDir, 'video_render_queue.json');
        expect(fs.existsSync(queueFile)).toBe(true);
        const queue = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
        expect(queue).toHaveLength(1);
        expect(queue[0].id).toBe(job!.id);
        expect(queue[0].origin).toBe('TEST');

        // default production path must remain untouched by this test
        const defaultQueue = path.resolve(process.cwd(), 'data/queues/video_render_queue.json');
        if (fs.existsSync(defaultQueue)) {
            const prod = JSON.parse(fs.readFileSync(defaultQueue, 'utf-8'));
            expect(prod.find((j: any) => j.id === job!.id)).toBeUndefined();
        }
    });

    it('defaults origin to USER when not specified', async () => {
        const service = freshService(tmpDir);
        const job = await service.queueVideoGeneration('user job', undefined, 'WAN');
        expect(job!.origin).toBe('USER');
    });

    it('removeTestJob removes TEST jobs but refuses USER jobs', async () => {
        const service = freshService(tmpDir);
        const testJob = (await service.queueVideoGeneration('t', undefined, 'WAN', 5, undefined, 'TEST'))!;
        const userJob = (await service.queueVideoGeneration('u', undefined, 'WAN', 5, undefined, 'USER'))!;

        const refused = service.removeTestJob(userJob.id);
        expect(refused.removed).toBe(false);
        expect(refused.reason).toBe('not_test_origin');

        const removed = service.removeTestJob(testJob.id);
        expect(removed.removed).toBe(true);

        const missing = service.removeTestJob('does-not-exist');
        expect(missing.removed).toBe(false);
        expect(missing.reason).toBe('not_found');

        // only the USER job survives
        const queue = service.getQueueStatus();
        expect(queue).toHaveLength(1);
        expect(queue[0].id).toBe(userJob.id);
    });
});
