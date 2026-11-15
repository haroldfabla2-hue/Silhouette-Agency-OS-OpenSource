/**
 * [HYGIENE] Media queue quarantine: legacy jobs are quarantined with a
 * backup-first contract (never delete), and /v1/training/sleep side effects
 * moved to POST so opening the training panel can never trigger training.
 *
 * Root cause: the prod queue (data/queues/video_render_queue.json) accumulated
 * 15 legacy dev jobs (Dec 2025, one with a Windows dev path) that no worker can
 * ever process, and GET /v1/training/sleep started a sleep cycle as a side
 * effect of merely watching the stream.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { LocalVideoService } from '../../services/media/localVideoService';

function freshService(queueDir: string, quarantineDir: string) {
    process.env.SILHOUETTE_QUEUE_DIR = queueDir;
    process.env.SILHOUETTE_QUARANTINE_DIR = quarantineDir;
    return new LocalVideoService();
}

describe('HYGIENE: media queue quarantine (backup-first, never delete)', () => {
    let tmpDir: string;
    let queueDir: string;
    let quarantineDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-queue-'));
        queueDir = path.join(tmpDir, 'queues');
        quarantineDir = path.join(tmpDir, 'quarantine');
    });

    afterEach(() => {
        delete process.env.SILHOUETTE_QUEUE_DIR;
        delete process.env.SILHOUETTE_QUARANTINE_DIR;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('backs up the full queue before removing legacy jobs, and keeps newer jobs', async () => {
        const service = freshService(queueDir, quarantineDir);
        const legacy = await service.queueVideoGeneration('legacy dec-2025 job', undefined, 'WAN', 5, undefined, 'TEST');
        const fresh = await service.queueVideoGeneration('fresh prod job', undefined, 'WAN', 5, undefined, 'TEST');
        // age the legacy job back to Dec 2025, like prod's legacy entries
        const queueFile = path.join(queueDir, 'video_render_queue.json');
        const seeded = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
        seeded.find((j: any) => j.id === legacy!.id).createdAt = '2025-12-17T02:56:33.766Z';
        fs.writeFileSync(queueFile, JSON.stringify(seeded, null, 2));

        const result = service.quarantineJobs({ olderThan: '2026-01-01T00:00:00Z' });

        expect(result.quarantined).toBe(1);
        expect(result.backupDir).not.toBe('');
        // backup preserves the FULL original queue (never delete)
        const backup = JSON.parse(fs.readFileSync(path.join(result.backupDir, 'video_render_queue.backup.json'), 'utf-8'));
        expect(backup).toHaveLength(2);
        const manifest = JSON.parse(fs.readFileSync(path.join(result.backupDir, 'MANIFEST.json'), 'utf-8'));
        expect(manifest.quarantinedIds).toEqual([legacy!.id]);
        expect(manifest.totalJobsBefore).toBe(2);
        // live queue keeps only the fresh job
        const live = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
        expect(live).toHaveLength(1);
        expect(live[0].id).toBe(fresh!.id);
    });

    it('quarantines by explicit ids and is a no-op (no backup) when nothing matches', async () => {
        const service = freshService(queueDir, quarantineDir);
        const a = await service.queueVideoGeneration('job a', undefined, 'WAN', 5, undefined, 'TEST');
        await service.queueVideoGeneration('job b', undefined, 'WAN', 5, undefined, 'TEST');

        const result = service.quarantineJobs({ ids: [a!.id] });
        expect(result.quarantined).toBe(1);

        const empty = service.quarantineJobs({ olderThan: '1999-01-01T00:00:00Z' });
        expect(empty.quarantined).toBe(0);
        expect(empty.backupDir).toBe('');
        // a no-op must not create quarantine artifacts
        expect(fs.existsSync(quarantineDir)).toBe(true); // created by first call
        const dirs = fs.readdirSync(quarantineDir);
        expect(dirs).toHaveLength(1); // only the first, real quarantine
    });
});

describe('HYGIENE: /v1/training/sleep side effect belongs to POST', () => {
    it('routes GET to the read-only watcher and POST to the trigger', () => {
        const routesSrc = fs.readFileSync(
            path.resolve(__dirname, '../../server/routes/v1/training.routes.ts'), 'utf-8');
        // GET must bind the read-only watcher, POST the trigger; bounded window
        // around the /sleep registrations so unrelated routes cannot false-pass.
        const sleepBlock = routesSrc.slice(routesSrc.indexOf("'/sleep'") - 400, routesSrc.lastIndexOf("'/sleep'") + 200);
        expect(sleepBlock).toContain("router.get('/sleep', controller.streamSleepCycle");
        expect(sleepBlock).toContain("router.post('/sleep', controller.startSleepCycle");
        expect(sleepBlock).not.toContain("router.get('/sleep', controller.startSleepCycle");
    });

    it('the read-only watcher never calls trainingService.startSleepCycle', () => {
        const controllerSrc = fs.readFileSync(
            path.resolve(__dirname, '../../server/controllers/trainingController.ts'), 'utf-8');
        const watcherStart = controllerSrc.indexOf('public async streamSleepCycle');
        expect(watcherStart).toBeGreaterThan(-1);
        const watcherBody = controllerSrc.slice(watcherStart, watcherStart + 800);
        expect(watcherBody).not.toContain('trainingService.startSleepCycle');
    });
});
