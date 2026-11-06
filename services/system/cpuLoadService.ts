import { readFile } from 'fs/promises';
import os from 'os';

const CONTAINER_DETECTION_PATHS = ['/.dockerenv', '/run/.containerenv'];
const CONTAINER_CGROUP_HINTS = /(docker|containerd|kubepods|podman)/i;
const CPU_STAT_PATHS = ['/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu/cpu.stat'];
const CPU_MAX_PATHS = ['/sys/fs/cgroup/cpu.max'];
const CPU_QUOTA_PATHS = ['/sys/fs/cgroup/cpu/cpu.cfs_quota_us'];
const CPU_PERIOD_PATHS = ['/sys/fs/cgroup/cpu/cpu.cfs_period_us'];
const CPUSET_PATHS = [
    '/sys/fs/cgroup/cpuset.cpus.effective',
    '/sys/fs/cgroup/cpuset/cpuset.cpus.effective',
    '/sys/fs/cgroup/cpuset.cpus',
    '/sys/fs/cgroup/cpuset/cpuset.cpus'
];
const CPUACCT_USAGE_PATHS = ['/sys/fs/cgroup/cpuacct.usage', '/sys/fs/cgroup/cpu/cpuacct.usage'];

interface ContainerCpuSnapshot {
    measuredAtMs: number;
    usageUsec: number;
    availableCpus: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function readFirstExisting(paths: string[]): Promise<string | null> {
    for (const path of paths) {
        try {
            return await readFile(path, 'utf8');
        } catch {
            // Try the next candidate.
        }
    }
    return null;
}

export function parseCpuSetCores(raw: string): number {
    const value = raw.trim();
    if (!value) return 0;

    return value
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((total, part) => {
            const [startRaw, endRaw] = part.split('-', 2);
            const start = Number.parseInt(startRaw, 10);
            const end = endRaw !== undefined ? Number.parseInt(endRaw, 10) : start;
            if (!Number.isFinite(start) || !Number.isFinite(end)) return total;
            return total + Math.abs(end - start) + 1;
        }, 0);
}

export function calculateContainerCpuLoadPercent(
    usageDeltaUsec: number,
    elapsedMs: number,
    availableCpus: number
): number {
    if (!Number.isFinite(usageDeltaUsec) || usageDeltaUsec < 0) return 0;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
    if (!Number.isFinite(availableCpus) || availableCpus <= 0) return 0;

    const elapsedUsec = elapsedMs * 1000;
    const normalized = (usageDeltaUsec / (elapsedUsec * availableCpus)) * 100;
    return Math.max(0, Math.min(100, normalized));
}

class CpuLoadService {
    private inFlight: Promise<number> | null = null;
    private cachedLoadPercent = 0;
    private lastLoadAtMs = 0;
    private lastSnapshot: ContainerCpuSnapshot | null = null;
    private containerMode: boolean | null = null;
    private availableCpuCount: number | null = null;

    public async getCurrentLoadPercent(): Promise<number> {
        if (this.inFlight) {
            return this.inFlight;
        }

        this.inFlight = this.measureCurrentLoadPercent().finally(() => {
            this.inFlight = null;
        });

        return this.inFlight;
    }

    private async measureCurrentLoadPercent(): Promise<number> {
        if (await this.isRunningInContainer()) {
            const containerLoad = await this.measureContainerLoadPercent();
            if (containerLoad !== null) {
                return containerLoad;
            }
        }

        const si = await import('systeminformation');
        return (await si.currentLoad()).currentLoad;
    }

    private async isRunningInContainer(): Promise<boolean> {
        if (this.containerMode !== null) {
            return this.containerMode;
        }

        if (process.env.DEPLOY_MODE === 'docker' || process.env.KUBERNETES_SERVICE_HOST) {
            this.containerMode = true;
            return true;
        }

        const marker = await readFirstExisting(CONTAINER_DETECTION_PATHS);
        if (marker !== null) {
            this.containerMode = true;
            return true;
        }

        try {
            const cgroup = await readFile('/proc/1/cgroup', 'utf8');
            this.containerMode = CONTAINER_CGROUP_HINTS.test(cgroup);
        } catch {
            this.containerMode = false;
        }

        return this.containerMode;
    }

    private async measureContainerLoadPercent(): Promise<number | null> {
        if (this.lastLoadAtMs > 0 && Date.now() - this.lastLoadAtMs < 1000) {
            return this.cachedLoadPercent;
        }

        const snapshot = await this.readContainerSnapshot();
        if (!snapshot) {
            return null;
        }

        if (!this.lastSnapshot) {
            this.lastSnapshot = snapshot;
            await sleep(250);

            const followUp = await this.readContainerSnapshot();
            if (!followUp) {
                return this.cachedLoadPercent;
            }

            return this.updateLoadFromSnapshot(followUp);
        }

        return this.updateLoadFromSnapshot(snapshot);
    }

    private updateLoadFromSnapshot(snapshot: ContainerCpuSnapshot): number {
        const previous = this.lastSnapshot;
        this.lastSnapshot = snapshot;

        if (!previous) {
            return this.cachedLoadPercent;
        }

        const availableCpus = Math.max(0.1, Math.min(previous.availableCpus, snapshot.availableCpus));
        this.cachedLoadPercent = calculateContainerCpuLoadPercent(
            snapshot.usageUsec - previous.usageUsec,
            snapshot.measuredAtMs - previous.measuredAtMs,
            availableCpus
        );
        this.lastLoadAtMs = snapshot.measuredAtMs;

        return this.cachedLoadPercent;
    }

    private async readContainerSnapshot(): Promise<ContainerCpuSnapshot | null> {
        const usageUsec = await this.readContainerUsageUsec();
        if (usageUsec === null) {
            return null;
        }

        return {
            measuredAtMs: Date.now(),
            usageUsec,
            availableCpus: await this.getAvailableCpuCount()
        };
    }

    private async readContainerUsageUsec(): Promise<number | null> {
        const cpuStat = await readFirstExisting(CPU_STAT_PATHS);
        if (cpuStat) {
            for (const line of cpuStat.split(/\r?\n/)) {
                if (!line.startsWith('usage_usec ')) continue;
                const value = Number.parseInt(line.slice('usage_usec '.length).trim(), 10);
                if (Number.isFinite(value) && value >= 0) {
                    return value;
                }
            }
        }

        const cpuAcctUsage = await readFirstExisting(CPUACCT_USAGE_PATHS);
        if (!cpuAcctUsage) {
            return null;
        }

        const usageNsec = Number.parseInt(cpuAcctUsage.trim(), 10);
        if (!Number.isFinite(usageNsec) || usageNsec < 0) {
            return null;
        }

        return Math.round(usageNsec / 1000);
    }

    private async getAvailableCpuCount(): Promise<number> {
        if (this.availableCpuCount !== null) {
            return this.availableCpuCount;
        }

        const candidates: number[] = [];
        const quotaCpuCount = await this.readQuotaCpuCount();
        if (quotaCpuCount !== null) {
            candidates.push(quotaCpuCount);
        }

        const cpusetCpuCount = await this.readCpuSetCpuCount();
        if (cpusetCpuCount !== null) {
            candidates.push(cpusetCpuCount);
        }

        const hostCpuCount = typeof os.availableParallelism === 'function'
            ? os.availableParallelism()
            : os.cpus().length;
        if (Number.isFinite(hostCpuCount) && hostCpuCount > 0) {
            candidates.push(hostCpuCount);
        }

        this.availableCpuCount = candidates.length > 0 ? Math.max(0.1, Math.min(...candidates)) : 1;
        return this.availableCpuCount;
    }

    private async readQuotaCpuCount(): Promise<number | null> {
        const cpuMax = await readFirstExisting(CPU_MAX_PATHS);
        if (cpuMax) {
            const [quotaRaw, periodRaw] = cpuMax.trim().split(/\s+/, 2);
            if (quotaRaw && quotaRaw !== 'max' && periodRaw) {
                const quota = Number.parseInt(quotaRaw, 10);
                const period = Number.parseInt(periodRaw, 10);
                if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) {
                    return quota / period;
                }
            }
        }

        const [quotaRaw, periodRaw] = await Promise.all([
            readFirstExisting(CPU_QUOTA_PATHS),
            readFirstExisting(CPU_PERIOD_PATHS)
        ]);
        if (!quotaRaw || !periodRaw) {
            return null;
        }

        const quota = Number.parseInt(quotaRaw.trim(), 10);
        const period = Number.parseInt(periodRaw.trim(), 10);
        if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) {
            return null;
        }

        return quota / period;
    }

    private async readCpuSetCpuCount(): Promise<number | null> {
        const cpuset = await readFirstExisting(CPUSET_PATHS);
        if (!cpuset) {
            return null;
        }

        const cpuCount = parseCpuSetCores(cpuset);
        return cpuCount > 0 ? cpuCount : null;
    }
}

export const cpuLoadService = new CpuLoadService();
