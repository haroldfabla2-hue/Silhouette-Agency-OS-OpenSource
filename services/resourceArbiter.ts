
import { Agent, AgentStatus, SystemMode } from "../types";
import * as si from 'systeminformation';
import { exec } from 'child_process';
import * as util from 'util';
import { publishResourceArbiter } from './resourceArbiterOwner';

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
}

class ResourceArbiter {
    private queue: QueueItem[] = [];
    private maxRamThreshold: number = 0.85; // 85% Max RAM usage
    private maxCpuThreshold: number = 98;   // 98% Max CPU load (Relaxed for startup)
    private isServer: boolean;

    private intervalId: NodeJS.Timeout | null = null;

    private admissionOpen = true;
    private startupOwner!: Promise<void>;
    private stopOwner: Promise<void> | undefined;
    private queueOwner: Promise<void> | undefined;
    private pending = new Set<Promise<unknown>>();
    private readonly failureSample: unknown[] = [];
    private failureCount = 0;
    private failureOverflow = false;

    private recordFailure(error: unknown): void {
        if (this.failureCount < Number.MAX_SAFE_INTEGER) this.failureCount++;
        else this.failureOverflow = true;
        if (this.failureSample.length < 8) this.failureSample.push(error);
        else this.failureOverflow = true;
    }
    private releaseAfterStop = 0;

    private retain<T>(task: Promise<T>): Promise<T> {
        this.pending.add(task);
        // Observe every original rejection without replacing the caller's promise.
        void task.then(() => { this.pending.delete(task); }, error => {
            this.recordFailure(error);
            this.pending.delete(task);
        });
        return task;
    }

    public getLifecycleStatus() {
        return { admissionOpen: this.admissionOpen, timerPresent: this.intervalId !== null,
            startupOwnerPresent: this.startupOwner !== undefined, queueOwnerPresent: this.queueOwner !== undefined,
            pendingChecks: this.pending.size, queued: this.queue.length,
            historicalFailures: this.failureCount, failureSampleSize: this.failureSample.length,
            failureOverflow: this.failureOverflow, releaseAfterStop: this.releaseAfterStop };
    }

    /** Terminal service-local stop. Does not own already admitted downstream tasks. */
    public stopAdmissions(): Promise<void> {
        if (this.stopOwner) return this.stopOwner;
        this.admissionOpen = false;
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = null;
        // Queued requests have not been admitted. Settle once, never grant on stop.
        for (const item of this.queue.splice(0)) item.resolve(false);
        this.stopOwner = (async () => {
            // Pending retained startup/checks can complete descendants before settling.
            while (this.pending.size) await Promise.allSettled([...this.pending]);
            if (this.failureCount || this.failureOverflow) throw new AggregateError([...this.failureSample],
                `Resource arbiter checks failed (${this.failureCount} recorded checks; sample overflow: ${this.failureOverflow})`);
        })();
        // A caller still receives the original stop rejection; never unhandled if
        // its owner retains the promise before awaiting other independent services.
        void this.stopOwner.catch(() => undefined);
        return this.stopOwner;
    }

    constructor() {
        this.isServer = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
        console.log(`[ARBITER] Initialized. Environment: ${this.isServer ? 'SERVER (Real Metrics)' : 'CLIENT (Simulated)'}`);

        // Start Queue Processor Loop with dynamic interval
        this.startupOwner = this.retain(this.startProcessing());
    }

    private async startProcessing(): Promise<void> {
        // Retained import, no timer may appear after terminal stop.
        const { powerManager } = await import('./powerManager');
        if (!this.admissionOpen) return;
        const intervalMs = powerManager.getConfig().resourceArbiterMs;
        this.intervalId = setInterval(() => { void this.processQueue(); }, intervalMs);
        console.log(`[ARBITER] Queue processor started (${intervalMs}ms interval)`);
    }

    /**
     * Checks if the system can handle waking up a new agent.
     * Returns a Promise that resolves when resources are available.
     */
    public requestAdmission(agent: Agent, priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL'): Promise<boolean> {
        if (!this.admissionOpen) return Promise.resolve(false);
        // Metrics were admitted before stop. Await them, but never admit/enqueue
        // downstream work if terminal stop happened while the check was running.
        return this.retain(this.evaluateAdmission(agent, priority));
    }

    private async evaluateAdmission(agent: Agent, priority: QueueItem['priority']): Promise<boolean> {
        const metrics = await this.readRealMetrics();
        if (!this.admissionOpen) return false;
        if (priority === 'CRITICAL' && metrics.ramUsed / metrics.ramTotal < 0.98) return true;
        if (process.uptime() < 60) return true;
        const ramUsagePercent = metrics.ramUsed / metrics.ramTotal;
        if (ramUsagePercent > this.maxRamThreshold || metrics.cpuLoad > this.maxCpuThreshold) {
            console.log(`[ARBITER] ⏳ Queuing ${agent.name} (Priority: ${priority}). RAM: ${(ramUsagePercent * 100).toFixed(1)}%`);
            return new Promise<boolean>(resolve => {
                this.queue.push({ agentId: agent.id, priority, timestamp: Date.now(), resolve });
                this.sortQueue();
            });
        }
        return true;
    }

    public release(): void {
        if (!this.admissionOpen) { this.releaseAfterStop++; return; }
        void this.processQueue();
    }

    private processQueue(): Promise<void> {
        if (!this.admissionOpen || this.queue.length === 0) return Promise.resolve();
        if (this.queueOwner) return this.queueOwner;
        const task = this.retain(this.checkQueue());
        this.queueOwner = task;
        // Both branches handled, original failure stays in retain's ledger.
        void task.then(() => { if (this.queueOwner === task) this.queueOwner = undefined; },
            () => { if (this.queueOwner === task) this.queueOwner = undefined; });
        return task;
    }

    private async checkQueue(): Promise<void> {
        const metrics = await this.readRealMetrics();
        if (!this.admissionOpen) return;
        const ramUsagePercent = metrics.ramUsed / metrics.ramTotal;
        if (ramUsagePercent < this.maxRamThreshold && metrics.cpuLoad < this.maxCpuThreshold) {
            const nextItem = this.queue.shift();
            if (nextItem) {
                console.log(`[ARBITER] ✅ Admitting from Queue: ${nextItem.agentId}`);
                nextItem.resolve(true);
            }
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

    /** Direct public metric checks are admitted/joined too; callers already using
     * their result remain outside this service's downstream stop ownership. */
    public getRealMetrics(): Promise<ResourceMetrics> {
        if (!this.admissionOpen) return Promise.reject(new Error('RESOURCE_ARBITER_STOPPED'));
        return this.retain(this.readRealMetrics());
    }

    private async readRealMetrics(): Promise<ResourceMetrics> {
        // Cache Check (2 seconds)
        if (this.lastMetrics && (Date.now() - this.lastMetricsTime < 2000)) {
            return this.lastMetrics;
        }

        if (this.isServer) {
            try {
                // Launch each original branch once, then await ALL branches even
                // when one rejects. A rejected fast CPU/memory branch must not
                // let an active GPU child escape this retained metric owner.
                const measured = await Promise.allSettled([
                    Promise.resolve().then(() => si.currentLoad()),
                    Promise.resolve().then(() => si.mem()),
                    Promise.resolve().then(() => this.getGpuMetrics())
                ] as const);
                const errors = measured.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
                const [loadResult, memResult, gpuResult] = measured;
                if (loadResult.status !== 'fulfilled' || memResult.status !== 'fulfilled' || gpuResult.status !== 'fulfilled') {
                    throw new AggregateError(errors, 'Real metric branches failed');
                }
                const load = loadResult.value;
                const mem = memResult.value;
                const gpu = gpuResult.value;

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
                this.recordFailure(e);
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
publishResourceArbiter(resourceArbiter);
