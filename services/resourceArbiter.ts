
import { Agent, AgentStatus, SystemMode } from "../types";
import * as si from 'systeminformation';
import { exec } from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(exec);

// --- RESOURCE ARBITER V1.0 ---
// "The Gatekeeper"
// Decides if an agent can be woken up based on REAL hardware metrics.

interface ResourceMetrics {
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

    constructor() {
        this.isServer = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
        console.log(`[ARBITER] Initialized. Environment: ${this.isServer ? 'SERVER (Real Metrics)' : 'CLIENT (Simulated)'}`);

        // Start Queue Processor Loop with dynamic interval
        this.startProcessing();
    }

    private startProcessing() {
        // Import dynamically to avoid circular dependency
        import('./powerManager').then(({ powerManager }) => {
            const intervalMs = powerManager.getConfig().resourceArbiterMs;
            this.intervalId = setInterval(() => this.processQueue(), intervalMs);
            console.log(`[ARBITER] Queue processor started (${intervalMs}ms interval)`);
        });
    }

    /**
     * Checks if the system can handle waking up a new agent.
     * Returns a Promise that resolves when resources are available.
     */
    public async requestAdmission(agent: Agent, priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL'): Promise<boolean> {
        return new Promise(async (resolve) => {
            const metrics = await this.getRealMetrics();

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
                    resolve
                });
                this.sortQueue();
            } else {
                // ADMIT IMMEDIATELY
                resolve(true);
            }
        });
    }

    public release() {
        // Trigger immediate check when resources are freed
        this.processQueue();
    }

    private async processQueue() {
        if (this.queue.length === 0) return;

        const metrics = await this.getRealMetrics();
        const ramUsagePercent = metrics.ramUsed / metrics.ramTotal;

        // If we have headroom
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



    // Helper to fetch VRAM from nvidia-smi
    private async getGpuMetrics(): Promise<{ used: number; total: number }> {
        try {
            // Returns "961, 4096"
            const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits');
            const [usedStr, totalStr] = stdout.trim().split(',').map(s => s.trim());
            return {
                used: parseInt(usedStr) || 0,
                total: parseInt(totalStr) || 4096
            };
        } catch (error) {
            // console.warn("[ARBITER] nvidia-smi failed, using fallback:", error);
            return { used: 0, total: 4096 };
        }
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

    private getSimulatedMetrics(): ResourceMetrics {
        // Fallback for Client-Side or Error
        // We can use performance.memory if available in Chrome (non-standard)
        const perf = (performance as any).memory;
        if (perf) {
            return {
                cpuLoad: 50, // Cannot measure CPU in browser easily
                ramUsed: perf.usedJSHeapSize,
                ramTotal: perf.jsHeapSizeLimit,
                vramUsed: 0,
                vramTotal: 4096
            };
        }

        return {
            cpuLoad: 40,
            ramUsed: 8 * 1024 * 1024 * 1024, // 8GB Mock
            ramTotal: 16 * 1024 * 1024 * 1024,
            vramUsed: 2048,
            vramTotal: 4096
        };
    }

    public getQueueLength(): number {
        return this.queue.length;
    }
}

export const resourceArbiter = new ResourceArbiter();
