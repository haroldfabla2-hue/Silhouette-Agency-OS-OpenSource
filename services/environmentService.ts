/**
 * EnvironmentService - F1 Environment Awareness
 *
 * Lets Silhouette and its agents know WHERE they live: host, process,
 * service identity, which subsystems are actually reachable, which
 * capabilities exist, and which configuration keys are present.
 *
 * Hard rules:
 * - READ-ONLY: probes and inspections only. It never installs, writes,
 *   or changes anything outside its own cache.
 * - NO SECRETS: configuration is reported as presence booleans only.
 *   Values never leave the process.
 * - HONEST: unknown is reported as "unknown", never guessed.
 */

import os from 'os';
import net from 'net';
import { execFile } from 'child_process';

export type SubsystemStatus = 'available' | 'unavailable' | 'unknown';

export interface SubsystemProbe {
    name: string;
    status: SubsystemStatus;
    detail?: string;
}

export interface EnvironmentReport {
    generatedAt: string;
    host: {
        platform: string;
        arch: string;
        release: string;
        hostname: string;
        uptimeSec: number;
        cpus: number;
        totalMemMB: number;
        freeMemMB: number;
    };
    process: {
        pid: number;
        nodeVersion: string;
        cwd: string;
        uptimeSec: number;
        memoryRssMB: number;
    };
    service: {
        port: number | null;
        git: {
            branch: string | null;
            sha: string | null;
            dirty: boolean | null;
        };
    };
    subsystems: SubsystemProbe[];
    capabilities: {
        gpu: SubsystemStatus;
        gpuDetail?: string;
    };
    /** Presence booleans only - values are never exposed. */
    config: Record<string, boolean>;
}

const CONFIG_KEYS = [
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'OPENROUTER_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_VOICE_ID',
    'MINIMAX_API_KEY',
    'TAVILY_API_KEY',
    'NEO4J_URI',
    'REDIS_URL',
    'QDRANT_URL',
    'VOICE_PROVIDER',
    'VOICE_ENGINE_URL',
    'SILHOUETTE_API_TOKEN'
];

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const done = (ok: boolean) => {
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        socket.connect(port, host);
    });
}

function runReadOnly(cmd: string, args: string[], timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 256 }, (err, stdout) => {
            if (err) resolve(null);
            else resolve(stdout.toString());
        });
    });
}

function hostPortFromUrl(raw: string | undefined, fallbackPort: number): { host: string; port: number } {
    if (!raw) return { host: '127.0.0.1', port: fallbackPort };
    try {
        const u = new URL(raw);
        return { host: u.hostname, port: Number(u.port) || fallbackPort };
    } catch {
        return { host: '127.0.0.1', port: fallbackPort };
    }
}

class EnvironmentService {
    private cache: { at: number; report: EnvironmentReport } | null = null;
    private readonly CACHE_MS = 10000;

    public async getReport(): Promise<EnvironmentReport> {
        if (this.cache && Date.now() - this.cache.at < this.CACHE_MS) {
            return this.cache.report;
        }
        const report = await this.buildReport();
        this.cache = { at: Date.now(), report };
        return report;
    }

    private async buildReport(): Promise<EnvironmentReport> {
        const [branch, sha, dirtyOut, gpuOut] = await Promise.all([
            runReadOnly('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 3000),
            runReadOnly('git', ['rev-parse', 'HEAD'], 3000),
            runReadOnly('git', ['status', '--porcelain'], 3000),
            runReadOnly('nvidia-smi', ['-L'], 3000)
        ]);

        const port = process.env.PORT ? Number(process.env.PORT) : null;

        const probes: Array<{ name: string; host: string; port: number; detail: string }> = [
            { name: 'qdrant', ...hostPortFromUrl(process.env.QDRANT_URL, 6433), detail: 'vector memory (optional)' },
            { name: 'ollama', ...hostPortFromUrl(process.env.OLLAMA_URL, 11434), detail: 'local LLM runtime (optional)' },
            { name: 'voice-engine', ...hostPortFromUrl(process.env.VOICE_ENGINE_URL, 8100), detail: 'local TTS engine (optional)' }
        ];

        const subsystems: SubsystemProbe[] = await Promise.all(
            probes.map(async (p) => ({
                name: p.name,
                status: (await tcpProbe(p.host, p.port, 1500)) ? 'available' : 'unavailable',
                detail: `${p.detail} @ ${p.host}:${p.port}`
            }))
        );

        const config: Record<string, boolean> = {};
        for (const key of CONFIG_KEYS) {
            config[key] = Boolean(process.env[key] && process.env[key]!.trim().length > 0);
        }

        return {
            generatedAt: new Date().toISOString(),
            host: {
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                hostname: os.hostname(),
                uptimeSec: Math.floor(os.uptime()),
                cpus: os.cpus().length,
                totalMemMB: Math.floor(os.totalmem() / 1024 / 1024),
                freeMemMB: Math.floor(os.freemem() / 1024 / 1024)
            },
            process: {
                pid: process.pid,
                nodeVersion: process.version,
                cwd: process.cwd(),
                uptimeSec: Math.floor(process.uptime()),
                memoryRssMB: Math.floor(process.memoryUsage().rss / 1024 / 1024)
            },
            service: {
                port,
                git: {
                    branch: branch ? branch.trim() : null,
                    sha: sha ? sha.trim() : null,
                    dirty: dirtyOut === null ? null : dirtyOut.trim().length > 0
                }
            },
            subsystems,
            capabilities: {
                gpu: gpuOut === null ? 'unavailable' : gpuOut.trim().length > 0 ? 'available' : 'unknown',
                gpuDetail: gpuOut === null ? 'nvidia-smi not found or timed out' : gpuOut.trim().split('\n')[0]
            },
            config
        };
    }
}

export const environmentService = new EnvironmentService();
