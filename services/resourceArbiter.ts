import { desktopRun, desktopWorkBound, desktopContinuation, desktopFault } from './lifecycle/desktopWork.js';
import { registerOwnedProducer } from './lifecycle/ownedProducers';

import { Agent, AgentStatus, SystemMode } from "../types";
import * as si from 'systeminformation';
import { exec } from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(exec);

// --- RESOURCE ARBITER V1.0 ---
// "The Gatekeeper"
// Decides if an agent can be woken up based on REAL hardware metrics.

interface ResourceMetrics {
    /** true when these numbers are browser-side estimates, not real server metrics */
    estimated?: boolean;
    cpuLoad: number;
    ramUsed: number;
    ramTotal: number;
    vramUsed: number;
    vramTotal: number;
}

interface QueueItem {
    agentId: string;
    priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
    timestamp: number;
    resolve: (allowed: boolean) => void;
    resume?: (task: () => Promise<void>) => Promise<void>;
}

class ResourceArbiter {
    private queue: QueueItem[] = [];
    private maxRamThreshold: number = 0.85; // 85% Max RAM usage
    private maxCpuThreshold: number = 98;   // 98% Max CPU load (Relaxed for startup)
    private isServer: boolean;

    private intervalId: NodeJS.Timeout | null = null;
    private stopped: boolean = false;
    // Drain-time admission gate: false only while drainAdmissionsAndStop is
    // emptying the queue - new requests resolve false instead of queueing
    // behind a timer that is about to stop. Production default untouched.
    private accepting: boolean = true;
    private activeAdmissions: number = 0;
    private activeQueueRuns: number = 0;

    constructor() {
        registerOwnedProducer('arbiter', () => this.drainAdmissionsAndStop());
        this.isServer = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
        console.log(`[ARBITER] Initialized. Environment: ${this.isServer ? 'SERVER (Real Metrics)' : 'CLIENT (Simulated)'}`);

        // Start Queue Processor Loop with dynamic interval
        this.startProcessing();
    }

    private startProcessing() {
        // Import dynamically to avoid circular dependency
        import('./powerManager').then(({ powerManager }) => {
            // Late-arm guard: a stop issued while this import was in flight
            // must win; intervalMs is read only when actually arming.
            if (this.stopped) return;
            const intervalMs = powerManager.getConfig().resourceArbiterMs;
            this.intervalId = setInterval(() => {
                void this.processQueue().catch(error => {
                    console.error('[ARBITER] Queue pump failed; pending admissions retained:', error);
                    desktopFault('arbiter', 'queue-pump-failed');
                });
            }, intervalMs);
            console.log(`[ARBITER] Queue processor started (${intervalMs}ms interval)`);
        }).catch(error => {
            if (!this.stopped) console.error('[ARBITER] Queue processor startup failed:', error);
        });
    }

    /** NARROW timer-only stop: prevents any future arm (stop latch checked by
     * the pending import callback above) and clears the current interval.
     * This is NOT queue drainage: pending admission promises are never
     * resolved by this API - the receipt reports them so the caller can fail
     * instead of silently abandoning them. In-flight processQueue work past
     * its early return requires a nonempty queue; callers that never enqueue
     * (receipt pendingAdmissions === 0 and no requestAdmission in their call
     * graph) have no callback-owned promises at stake.
     * The receipt reports MEASURED state at stop time: whether the interval
     * was armed, queued admission promises (never resolved by this API),
     * in-flight requestAdmission calls, and in-flight processQueue runs. It
     * is a snapshot of this process's counters, not a generic settled-state
     * proof; callers must assert the values their own usage makes possible.
     * Exists because the constructor arms a ref'd interval, so short-lived
     * processes importing this singleton (e.g. via continuum.store's
     * fire-and-forget dreamerService cascade) cannot exit naturally without
     * it. The product drain does not yet own this producer - explicit
     * lifecycle gap, kept visible. */
    public stopProcessingTimer(): { intervalWasArmed: boolean; pendingAdmissions: number; activeAdmissions: number; activeQueueRuns: number } {
        this.stopped = true;
        const intervalWasArmed = this.intervalId !== null;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        return {
            intervalWasArmed,
            pendingAdmissions: this.queue.length,
            activeAdmissions: this.activeAdmissions,
            activeQueueRuns: this.activeQueueRuns
        };
    }

    /**
     * Checks if the system can handle waking up a new agent.
     * Returns a Promise that resolves when resources are available.
     */
    public async requestAdmission(agent: Agent, priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL'): Promise<boolean> {
        return desktopRun('arbiter-admission', () => this.requestAdmissionAccepted(agent, priority));
    }

    private async requestAdmissionAccepted(agent: Agent, priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'): Promise<boolean> {
        return new Promise(async (resolve, reject) => {
            // No-new-admission guard: after stopProcessingTimer the queue can
            // never drain, so queueing here would abandon the promise. The
            // drain-time gate (!accepting) applies the same rule while the
            // owner is emptying the queue.
            if (this.stopped || !this.accepting) {
                resolve(false);
                return;
            }
            this.activeAdmissions++;
            try {
                const metrics = await this.getRealMetrics();
                // Post-await recheck: a stop or drain issued while metrics
                // were in flight wins; never grant or queue an admission
                // after the timer has been permanently stopped or the owner
                // stopped accepting.
                if (this.stopped || !this.accepting) {
                    resolve(false);
                    return;
                }

                // 1. CRITICAL ALWAYS PASSES
                if (priority === 'CRITICAL' && metrics.ramUsed / metrics.ramTotal < 0.98) {
                    resolve(true);
                    return;
                }

                // 2. STARTUP GRACE PERIOD
                if (process.uptime() < 60) {
                    resolve(true);
                    return;
                }

                // 3. CHECK THRESHOLDS
                const ramUsagePercent = metrics.ramUsed / metrics.ramTotal;
                if (ramUsagePercent > this.maxRamThreshold || metrics.cpuLoad > this.maxCpuThreshold) {
                    // QUEUE THE REQUEST
                    console.log(`[ARBITER] ⏳ Queuing ${agent.name} (Priority: ${priority}). RAM: ${(ramUsagePercent * 100).toFixed(1)}%`);
                    this.queue.push({
                        agentId: agent.id,
                        priority,
                        timestamp: Date.now(),
                        resolve,
                        resume: desktopWorkBound() ? desktopContinuation('arbiter-queue-pump') : undefined
                    });
                    this.sortQueue();
                } else {
                    // ADMIT IMMEDIATELY
                    resolve(true);
                }
            } catch (error) {
                reject(error);
            } finally {
                this.activeAdmissions--;
            }
        });
    }

    public release() {
        // Trigger immediate check when resources are freed
        void this.processQueue().catch(error => {
            console.error('[ARBITER] Queue pump failed; pending admissions retained:', error);
            desktopFault('arbiter', 'queue-pump-failed');
        });
    }

    /**
     * Drain-time ownership stop for the product drain: stops accepting NEW
     * admissions (they resolve false, never abandoned), empties the pending
     * queue itself (one admission per round, headroom permitting), then
     * latches the stop and clears the interval, then gives in-flight
     * admissions/queue runs a bounded settle window (40 x 25ms). Work is
     * DRAINED or honestly receipted - never discarded to exit: a queue that
     * cannot drain within maxRounds (sustained congestion) or counters that
     * do not settle within the window surface as boundExhausted with the
     * measured leftovers, and the caller fails the drain. maxRounds is the
     * shutdown patience policy (default 10 admissions); one processQueue
     * round admits at most one queued request.
     */
    public async drainAdmissionsAndStop(maxRounds: number = 10): Promise<{ intervalWasArmed: boolean; drainedRounds: number; remainingQueue: number; activeAdmissions: number; activeQueueRuns: number; boundExhausted: boolean }> {
        this.accepting = false;
        let drainedRounds = 0;
        while (this.queue.length > 0 && drainedRounds < maxRounds) {
            drainedRounds++;
            try {
                await this.processQueue();
            } catch {
                break; // a metrics failure stops the drain; leftovers are receipted below
            }
        }
        const base = this.stopProcessingTimer();
        let settleWaits = 0;
        while ((this.activeAdmissions > 0 || this.activeQueueRuns > 0) && settleWaits < 40) {
            await new Promise(r => setTimeout(r, 25));
            settleWaits++;
        }
        const remainingQueue = this.queue.length;
        return {
            intervalWasArmed: base.intervalWasArmed,
            drainedRounds,
            remainingQueue,
            activeAdmissions: this.activeAdmissions,
            activeQueueRuns: this.activeQueueRuns,
            boundExhausted: remainingQueue > 0 || this.activeAdmissions > 0 || this.activeQueueRuns > 0
        };
    }

    private async processQueue() {
        if (this.queue.length === 0) return;
        const resume = this.queue[0].resume;
        // The queue service is not a new autonomous root. It continues the
        // pending admitted promise, including after roots close. Its own tail
        // stays counted even if resolving that promise lets its parent finish.
        if (desktopWorkBound()) {
            if (!resume) { desktopFault('arbiter', 'queue-lineage-missing'); throw new Error('DESKTOP_ARBITER_QUEUE_LINEAGE_MISSING'); }
            return resume(() => this.processQueueAccepted());
        }
        return this.processQueueAccepted();
    }

    private async processQueueAccepted() {
        this.activeQueueRuns++;
        try {
            const metrics = await this.getRealMetrics();
            // Post-await recheck: the timer may have been stopped while the
            // metrics await was in flight; never shift or resolve a queued
            // admission after stop.
            if (this.stopped) return;
            const ramUsagePercent = metrics.ramUsed / metrics.ramTotal;

            // If we have headroom
            if (ramUsagePercent < this.maxRamThreshold && metrics.cpuLoad < this.maxCpuThreshold) {
                const nextItem = this.queue.shift();
                if (nextItem) {
                    console.log(`[ARBITER] ✅ Admitting from Queue: ${nextItem.agentId}`);
                    nextItem.resolve(true);
                }
            }
        } finally {
            this.activeQueueRuns--;
        }
    }

    private sortQueue() {
        const priorityMap = { 'CRITICAL': 3, 'HIGH': 2, 'NORMAL': 1, 'LOW': 0 };
        this.queue.sort((a, b) => {
            const pA = priorityMap[a.priority];
            const pB = priorityMap[b.priority];
            if (pA !== pB) return pB - pA; // Higher priority first
            return a.timestamp - b.timestamp; // FIFO for same priority
        });
    }

    private lastMetrics: ResourceMetrics | null = null;
    private lastMetricsTime: number = 0;



    private detectedGpuVendor: string | null = null;

    // Detect GPU vendor once, then use the right tool for VRAM queries
    private async detectGpuVendor(): Promise<string> {
        if (this.detectedGpuVendor) return this.detectedGpuVendor;

        // Try NVIDIA first
        try {
            await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 5000 });
            this.detectedGpuVendor = 'nvidia';
            console.log('[ARBITER] GPU detected: NVIDIA');
            return 'nvidia';
        } catch {}

        // Try AMD ROCm
        try {
            await execAsync('rocm-smi --showproductname', { timeout: 5000 });
            this.detectedGpuVendor = 'amd';
            console.log('[ARBITER] GPU detected: AMD (ROCm)');
            return 'amd';
        } catch {}

        // Try Intel (via lspci on Linux)
        try {
            const { stdout } = await execAsync('lspci | grep -i "vga\\|3d\\|display"', { timeout: 5000 });
            if (stdout.toLowerCase().includes('intel')) {
                this.detectedGpuVendor = 'intel';
                console.log('[ARBITER] GPU detected: Intel (no VRAM monitoring)');
                return 'intel';
            }
        } catch {}

        this.detectedGpuVendor = 'none';
        console.log('[ARBITER] No discrete GPU detected, running CPU-only');
        return 'none';
    }

    // Helper to fetch VRAM - supports NVIDIA (nvidia-smi) and AMD (rocm-smi)
    private async getGpuMetrics(): Promise<{ used: number; total: number }> {
        const vendor = await this.detectGpuVendor();

        if (vendor === 'nvidia') {
            try {
                const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits');
                const [usedStr, totalStr] = stdout.trim().split(',').map(s => s.trim());
                return {
                    used: parseInt(usedStr) || 0,
                    total: parseInt(totalStr) || 4096
                };
            } catch {
                return { used: 0, total: 0 };
            }
        }

        if (vendor === 'amd') {
            try {
                const { stdout } = await execAsync('rocm-smi --showmemuse --json', { timeout: 5000 });
                const data = JSON.parse(stdout);
                // rocm-smi JSON output varies by version, try common formats
                const card = data?.card0 || Object.values(data)[0] as any;
                if (card) {
                    return {
                        used: parseInt(card['VRAM Use (MB)'] || card['vram_used'] || '0'),
                        total: parseInt(card['VRAM Total (MB)'] || card['vram_total'] || '0')
                    };
                }
            } catch {}
            // Fallback: try parsing text output
            try {
                const { stdout } = await execAsync('rocm-smi --showmeminfo vram');
                let used = 0, total = 0;
                for (const line of stdout.split('\n')) {
                    if (line.includes('Total')) {
                        const match = line.match(/(\d+)/);
                        if (match) total = Math.round(parseInt(match[1]) / (1024 * 1024)); // bytes to MB
                    }
                    if (line.includes('Used')) {
                        const match = line.match(/(\d+)/);
                        if (match) used = Math.round(parseInt(match[1]) / (1024 * 1024));
                    }
                }
                if (total > 0) return { used, total };
            } catch {}
            return { used: 0, total: 0 };
        }

        // Intel or no GPU - no VRAM to monitor
        return { used: 0, total: 0 };
    }

    public async getRealMetrics(): Promise<ResourceMetrics> {
        // Cache Check (2 seconds)
        if (this.lastMetrics && (Date.now() - this.lastMetricsTime < 2000)) {
            return this.lastMetrics;
        }

        if (this.isServer) {
            try {
                const [load, mem, gpu] = await Promise.all([
                    si.currentLoad(),
                    si.mem(),
                    this.getGpuMetrics() // [NEW] Real GPU Audit
                ]);

                // Debug Log (Throttled)
                if (load.currentLoad >= 99 && Math.random() > 0.95) {
                    console.warn(`[ARBITER] CPU Load High: ${load.currentLoad.toFixed(1)}%. Process: ${process.cpuUsage().user}`);
                }

                const metrics = {
                    cpuLoad: load.currentLoad,
                    ramUsed: mem.used,
                    ramTotal: mem.total,
                    vramUsed: gpu.used, // [NEW] Real Value
                    vramTotal: gpu.total // [NEW] Real Value
                };

                this.lastMetrics = metrics;
                this.lastMetricsTime = Date.now();
                return metrics;
            } catch (e) {
                console.error("[ARBITER] Failed to get real metrics", e);
                return this.getSimulatedMetrics();
            }
        } else {
            return this.getSimulatedMetrics();
        }
    }

    private getEstimatedMetrics(): ResourceMetrics {
        // Fallback for client-side or server-error paths. These are ESTIMATES,
        // flagged with estimated:true so callers never mistake them for real
        // server telemetry. Real JS-heap numbers are used when Chrome exposes
        // performance.memory; CPU cannot be measured in a browser.
        const perf = (performance as any).memory;
        if (perf) {
            return {
                estimated: true,
                cpuLoad: -1, // -1 = not measurable in the browser (no fake %)
                ramUsed: perf.usedJSHeapSize,
                ramTotal: perf.jsHeapSizeLimit,
                vramUsed: 0,
                vramTotal: 0 // 0 = unknown, not a fabricated VRAM figure
            };
        }

        // No real signal at all: report zeros flagged as estimates instead of
        // invented "8GB/16GB" figures.
        return {
            estimated: true,
            cpuLoad: -1,
            ramUsed: 0,
            ramTotal: 0,
            vramUsed: 0,
            vramTotal: 0
        };
    }

    /** @deprecated use getEstimatedMetrics (kept for call-site compatibility) */
    private getSimulatedMetrics(): ResourceMetrics {
        return this.getEstimatedMetrics();
    }

    public getQueueLength(): number {
        return this.queue.length;
    }
}

export const resourceArbiter = new ResourceArbiter();
