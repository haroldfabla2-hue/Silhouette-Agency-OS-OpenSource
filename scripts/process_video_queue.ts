
import { resourceManager } from '../services/resourceManager';
import { spawn, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
// Dynamic import for service might be needed if running as script, but let's try static first if ts-node handles it.
// If this fails we might need to use dynamic import() inside runComfyWorker.
import { comfyService } from '../services/comfyService';

/**
 * PROCESS VIDEO QUEUE (ComfyUI Edition)
 * 
 * VRAM Guardian V2:
 * 1. Sleep Brain (Free VRAM).
 * 2. Wake Visual Cortex (Start ComfyUI).
 * 3. Dream (Generate Video via API).
 * 4. Sleep Visual Cortex (Kill ComfyUI).
 * 5. Wake Brain.
 */

const COMFY_ROOT = path.resolve(process.cwd(), 'ComfyUI', 'ComfyUI');
const COMFY_MAIN = path.join(COMFY_ROOT, 'main.py');
const VIDEO_QUEUE_PATH = path.join(process.cwd(), 'data', 'queues', 'video_render_queue.json');
const PYTHON_CMD = 'python'; // Assumes env is set correctly

let comfyProcess: any = null;

async function startComfyUI() {
    console.log(`🚀 [Orchestrator] Launching ComfyUI from: ${COMFY_ROOT}`);

    // Spawn server
    comfyProcess = spawn(PYTHON_CMD, ['main.py', '--listen', '127.0.0.1', '--port', '8188'], {
        cwd: COMFY_ROOT,
        detached: false,
        stdio: 'ignore' // set to 'inherit' for debugging, 'ignore' to keep console clean
    });

    console.log(`[Orchestrator] ComfyUI PID: ${comfyProcess.pid}`);

    // Wait for health
    await waitForComfyReady();
}

async function waitForComfyReady(maxAttempts = 60) {
    process.stdout.write("[Orchestrator] ⏳ Waiting for ComfyUI");
    for (let i = 0; i < maxAttempts; i++) {
        if (await comfyService.isAvailable()) {
            console.log("\n[Orchestrator] ✅ ComfyUI is ONLINE.");
            return;
        }
        process.stdout.write(".");
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error("ComfyUI failed to start in time.");
}

async function stopComfyUI() {
    if (comfyProcess) {
        console.log("🛑 [Orchestrator] Killing ComfyUI...");

        if (os.platform() === 'win32') {
            try {
                // Force kill tree
                exec(`taskkill /pid ${comfyProcess.pid} /f /t`);
            } catch (e) {
                console.error("Error killing via taskkill:", e);
            }
        } else {
            comfyProcess.kill('SIGINT');
        }

        comfyProcess = null;
        // Wait a bit for VRAM release
        await new Promise(r => setTimeout(r, 3000));
    }
}

async function runComfyWorker() {
    try {
        await startComfyUI();

        // Process Pending Jobs
        if (!fs.existsSync(VIDEO_QUEUE_PATH)) return;

        let queueData = fs.readFileSync(VIDEO_QUEUE_PATH, 'utf8');
        let queue = JSON.parse(queueData);
        // Re-filter to be sure
        let pending = queue.filter((j: any) => j.status === 'QUEUED');

        console.log(`[Orchestrator] Processing ${pending.length} jobs via ComfyUI...`);

        for (const job of pending) {
            console.log(`🎬 Processing Job ${job.id} (${job.engine || 'WAN'})...`);

            // Update status to PROCESSING
            // We must re-read queue in case of race conditions if we were parallel, but here we are single threaded.
            // But good practice to reload if multiple agents.
            queue = JSON.parse(fs.readFileSync(VIDEO_QUEUE_PATH, 'utf8'));
            const currentJob = queue.find((j: any) => j.id === job.id);
            if (!currentJob) continue;

            currentJob.status = 'PROCESSING';
            fs.writeFileSync(VIDEO_QUEUE_PATH, JSON.stringify(queue, null, 2));

            try {
                // Execute via Service
                const engine = job.engine || 'WAN';

                // Call ComfyService
                const resultPath = await comfyService.generateVideo(
                    job.prompt,
                    engine,
                    job.imagePath
                );

                // Success
                currentJob.status = 'COMPLETED';
                currentJob.videoPath = resultPath;
                console.log(`✅ Job ${job.id} Success: ${resultPath}`);

                // === REGISTER IN ASSET CATALOG ===
                if (resultPath) {
                    try {
                        const { assetCatalog } = await import('../services/assetCatalog');
                        await assetCatalog.register({
                            type: 'video',
                            name: `vid_${job.id.slice(0, 8)}`,
                            filePath: resultPath,
                            description: job.prompt?.slice(0, 200),
                            prompt: job.prompt,
                            provider: `LOCAL_${engine}`,
                            tags: [engine.toLowerCase(), 'generated'],
                            metadata: {
                                engine: engine,
                                duration: job.duration,
                                fps: job.fps,
                                aspectRatio: job.aspectRatio,
                                camera: job.camera,
                                hasKeyframes: !!(job.keyframeStart || job.keyframeEnd)
                            }
                        });
                        console.log(`📦 [Catalog] Video registered: vid_${job.id.slice(0, 8)}`);
                    } catch (regError: any) {
                        console.warn(`⚠️ [Catalog] Failed to register video:`, regError.message);
                    }
                }

            } catch (e: any) {
                console.error(`❌ Job ${job.id} Failed:`, e.message);
                currentJob.status = 'FAILED';
                currentJob.error = e.message;
            }

            // Save after each job
            fs.writeFileSync(VIDEO_QUEUE_PATH, JSON.stringify(queue, null, 2));
        }

    } catch (e) {
        throw e; // Bubble up to orchestrator catch
    } finally {
        await stopComfyUI();
    }
}

async function processQueue() {
    console.log("🎬 [Orchestrator] checking video queue...");

    if (!fs.existsSync(VIDEO_QUEUE_PATH)) {
        console.log("📭 Queue file not found.");
        return;
    }

    try {
        const queueData = fs.readFileSync(VIDEO_QUEUE_PATH, 'utf-8');
        const queue = JSON.parse(queueData);
        const pending = queue.filter((job: any) => job.status === 'QUEUED');

        if (pending.length === 0) {
            console.log("📭 No pending jobs.");
            return;
        }

        console.log(`⚡ [Orchestrator] Found ${pending.length} pending jobs. Initiating Sleep Protocol...`);

        // 1. REQUEST SILENCE (Sleep Mode)
        const granted = await resourceManager.requestExclusiveAccess('VIDEO');

        if (!granted) {
            console.error("🛑 [Orchestrator] Access Denied. System busy or lock failed.");
            return;
        }

        console.log("💤 [Orchestrator] Brain is sleeping. VRAM is ours. Spawning ComfyUI...");

        // 2. SPAWN WORKER (ComfyUI)
        await runComfyWorker();

        // 3. WAKE UP (Restore Consciousness)
        console.log("🔔 [Orchestrator] Rendering complete. Waking up the brain...");
        await resourceManager.releaseExclusiveAccess('VIDEO');

        console.log("✅ [Orchestrator] Cycle Complete. System Normal.");

    } catch (e) {
        console.error("❌ [Orchestrator] Fatal Error:", e);
        await resourceManager.releaseExclusiveAccess('VIDEO');
        if (comfyProcess) await stopComfyUI();
    }
}

// Run
processQueue();
