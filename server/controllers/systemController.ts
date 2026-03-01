
import { Request, Response } from 'express';
import { configureGenAI } from '../../services/geminiService';
import { sqliteService } from '../../services/sqliteService';

// Prefix used for all secrets in the system_config table
const SECRETS_PREFIX = 'secretsVault_';

export class SystemController {

    // ═══════════════════════════════════════════════════════════
    // SECRETS VAULT — Server-side credential storage
    // ═══════════════════════════════════════════════════════════

    /**
     * Save credentials for a specific service (e.g., gemini, openai, google_drive).
     * POST /v1/system/secrets/:serviceId
     * Body: { credentials: { apiKey: "...", orgId: "..." } }
     */
    public async saveSecret(req: Request, res: Response) {
        try {
            const { serviceId } = req.params;
            const { credentials } = req.body;

            if (!serviceId || !credentials || typeof credentials !== 'object') {
                return res.status(400).json({ error: 'Missing serviceId or credentials object' });
            }

            const key = `${SECRETS_PREFIX}${serviceId}`;
            sqliteService.setConfig(key, credentials);

            // Hot-reload side effects for known services
            if (serviceId === 'gemini' && credentials.apiKey) {
                configureGenAI(credentials.apiKey);
                sqliteService.setConfig('systemApiKey', credentials.apiKey);
            }
            if (serviceId === 'media') {
                try {
                    const { mediaService } = await import('../../services/mediaService');
                    mediaService.updateConfig(credentials);
                    sqliteService.setConfig('mediaConfig', credentials);
                } catch (e) { /* mediaService may not be loaded yet */ }
            }

            console.log(`[SECRETS] Saved credentials for service: ${serviceId}`);
            res.json({ success: true, serviceId });
        } catch (e: any) {
            console.error('[SECRETS] Save failed:', e.message);
            res.status(500).json({ error: 'Failed to save secret', details: e.message });
        }
    }

    /**
     * List which services have stored credentials (NEVER returns raw values).
     * GET /v1/system/secrets
     * Returns: { services: [{ id: "gemini", hasCredentials: true, keys: ["apiKey"] }] }
     */
    public async listSecrets(req: Request, res: Response) {
        try {
            const allConfig = sqliteService.getAllConfig();
            const services = Object.entries(allConfig)
                .filter(([key]) => key.startsWith(SECRETS_PREFIX))
                .map(([key, value]) => ({
                    id: key.replace(SECRETS_PREFIX, ''),
                    hasCredentials: true,
                    keys: typeof value === 'object' && value !== null ? Object.keys(value) : [],
                    maskedPreview: typeof value === 'object' && value !== null
                        ? Object.fromEntries(
                            Object.entries(value).map(([k, v]) => [
                                k,
                                typeof v === 'string' && v.length > 4
                                    ? `${v.substring(0, 4)}${'•'.repeat(Math.min(v.length - 4, 12))}`
                                    : '••••'
                            ])
                        )
                        : {}
                }));

            res.json({ services });
        } catch (e: any) {
            console.error('[SECRETS] List failed:', e.message);
            res.status(500).json({ error: 'Failed to list secrets', details: e.message });
        }
    }

    /**
     * Get raw secret for a specific service (for internal agent/service use).
     * GET /v1/system/secrets/:serviceId
     * Returns raw credentials — should be behind auth middleware.
     */
    public async getSecret(req: Request, res: Response) {
        try {
            const { serviceId } = req.params;
            const key = `${SECRETS_PREFIX}${serviceId}`;
            const value = sqliteService.getConfig(key);

            if (!value) {
                return res.status(404).json({ error: `No credentials found for ${serviceId}` });
            }

            res.json({ serviceId, credentials: value });
        } catch (e: any) {
            console.error('[SECRETS] Get failed:', e.message);
            res.status(500).json({ error: 'Failed to get secret', details: e.message });
        }
    }

    /**
     * Static helper for programmatic access from other backend services.
     * Usage: SystemController.getSecretInternal('gemini') => { apiKey: '...' }
     */
    public static getSecretInternal(serviceId: string): Record<string, any> | null {
        return sqliteService.getConfig(`${SECRETS_PREFIX}${serviceId}`);
    }

    // ═══════════════════════════════════════════════════════════
    // CONFIG (existing)
    // ═══════════════════════════════════════════════════════════

    public async getConfig(req: Request, res: Response) {
        // Fetch fresh config from SQLite + Env merger logic if needed
        const config = sqliteService.getAllConfig();

        // Add Drive configuration from environment
        const driveConfig = {
            folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
            clientId: process.env.GOOGLE_CLIENT_ID ? '***configured***' : null,
        };

        res.json({ ...config, driveConfig });
    }

    public async updateConfig(req: Request, res: Response) {
        try {
            const { apiKey, mediaConfig, dreamerConfig } = req.body;
            let updatedCount = 0;

            if (apiKey) {
                configureGenAI(apiKey);
                // genesisConfig.systemApiKey = apiKey; // Legacy Global Var
                sqliteService.setConfig('systemApiKey', apiKey);
                updatedCount++;
            }

            if (mediaConfig) {
                const { mediaService } = await import('../../services/mediaService');
                mediaService.updateConfig(mediaConfig);
                // genesisConfig.mediaConfig = ... // Legacy
                sqliteService.setConfig('mediaConfig', mediaConfig); // Store as JSON blob or individual keys
                updatedCount++;
            }

            if (dreamerConfig) {
                const { dreamer } = await import('../../services/dreamerService');
                if (dreamerConfig.threshold) {
                    dreamer.setThreshold(dreamerConfig.threshold);
                }
                sqliteService.setConfig('dreamerConfig', dreamerConfig);
                console.log("[CONFIG] Dreamer Configuration Updated");
                updatedCount++;
            }

            res.json({ success: true, message: `Configuration updated (${updatedCount} sections) and persisted.` });

        } catch (e: any) {
            console.error("[CONFIG] Error updating system config:", e);
            res.status(500).json({ error: "Internal Server Error", details: e.message });
        }
    }

    public async scanSystem(req: Request, res: Response) {
        res.json({ success: true, map: { files: [] } }); // Placeholder from original code
    }

    public async readFile(req: Request, res: Response) {
        const { filePath } = req.body;
        // ... logic to read file safely ...
        // Replicating original simplified logic for now:
        const fs = await import('fs');
        const path = await import('path');
        try {
            const rootDir = process.cwd();
            const fullPath = path.join(rootDir, filePath);
            if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found" });
            const content = fs.readFileSync(fullPath, 'utf-8');
            res.json({ success: true, content });
        } catch (e) { res.status(500).json({ error: "Read failed" }); }
    }
    public async getStatus(req: Request, res: Response) {
        res.json({
            status: 'ONLINE',
            uptime: process.uptime(),
            timestamp: Date.now(),
            services: [
                { id: 'core', name: 'Orchestrator Core', status: 'ONLINE', port: 3000 },
                { id: 'db', name: 'SQLite Persistence', status: 'ONLINE', url: 'file:///db/silhouette.sqlite' }
            ]
        });
    }

    public async getCosts(req: Request, res: Response) {
        const costs = sqliteService.getCostMetrics() || { totalCost: 0, dailyCost: 0, projectedMonthly: 0, costPerToken: 0, tokenCount: 0, modelBreakdown: {} };
        res.json(costs);
    }

    // CACHE FOR TELEMETRY
    private lastTelemetry: any = null;
    private lastTelemetryTime: number = 0;
    private readonly CACHE_TTL = 5000;
    private isPolling: boolean = false;

    constructor() {
        // Start background polling immediately to warm up cache
        this.startBackgroundPolling();
    }

    private startBackgroundPolling() {
        if (this.isPolling) return;
        this.isPolling = true;

        const poll = async () => {
            try {
                // Background fetch
                await this.refreshTelemetryCache();
            } catch (e) {
                console.error("[TELEMETRY] Background poll failed", e);
            } finally {
                // Schedule next poll (5s)
                setTimeout(poll, 5000);
            }
        };

        // Initial kick
        poll();
    }

    public async getTelemetry(req: Request, res: Response) {
        // Return whatever is in cache immediately (Stale-While-Revalidate style)
        // If cache is null (startup), we wait for one fetch
        if (!this.lastTelemetry) {
            await this.refreshTelemetryCache();
        }
        res.json(this.lastTelemetry);
    }

    // ... introspection endpoints ...

    public async getFullState(req: Request, res: Response) {
        try {
            const telemetry = await this.getTelemetryData();
            const { orchestrator } = await import('../../services/orchestrator');
            const { sqliteService } = await import('../../services/sqliteService');

            // Generate or fetch Brain Telemetry
            let brainStats = null;
            try {
                const { continuum } = await import('../../services/continuumMemory');
                const { thoughtNarrator } = await import('../../services/cognitive/thoughtNarrator');
                const memStats = await continuum.getStats();
                const narrative = await thoughtNarrator.generateNarrative();
                brainStats = {
                    workingMemoryItems: memStats.workingMemoryItems,
                    latestNarrative: narrative
                };
            } catch (e) {
                console.warn("[SYSTEM] Failed to fetch brain telemetry", e);
            }

            // Get media queue status for Visual Cortex Queue display
            let mediaQueue: any[] = [];
            try {
                const { localVideoService } = await import('../../services/media/localVideoService');
                mediaQueue = localVideoService.getQueueStatus();
            } catch (e) {
                console.warn("[SYSTEM] Media queue fetch failed", e);
            }

            // Get projects from factory config (Active Operations VFS)
            let projects: any[] = [];
            try {
                projects = sqliteService.getConfig('genesisProjects') || [];
            } catch (e) {
                console.warn("[SYSTEM] Projects fetch failed", e);
            }

            // Gather all data in parallel or sequence
            const logs = sqliteService.getRecentLogs('INFO', 5); // Last 5 mins logs? or just last 10 items? 
            // Better: get last 20 logs independent of time
            const recentLogs = sqliteService.getLogs(20).map(l => `[${l.level}] ${l.message}`);

            const state = {
                telemetry: {
                    ...telemetry, // This has cpu, ram, gpu, providerHealth
                    agentCount: orchestrator.getActiveCount(),
                    mediaQueue, // Add media queue to telemetry
                    brain: brainStats // Emits cognitive data straight to frontend
                },
                orchestrator: {
                    agents: orchestrator.getAgents(), // This returns full list (mixed active/offline)
                    agentCount: orchestrator.getActiveCount()
                },
                introspection: {
                    thoughts: [], // Thoughts handled by IntrospectionEngine
                    // Fallback to logs if thoughts missing?
                    // Or check systemBus? For now empty array is fine to stop crash, fetching agents is priority.
                },
                projects, // Add projects for Dashboard Active Operations
                logs: recentLogs
            };

            res.json(state);
        } catch (e: any) {
            console.error("[SYSTEM] getFullState failed", e);
            // Fallback to avoid 500 loop
            res.json({
                metrics: this.lastTelemetry || { cpu: 0, ram: { active: 0, total: 16 } },
                logs: [],
                liveThoughts: [],
                squadThoughts: {},
                activeAgents: 0
            });
        }
    }

    // Helper methods for getFullState
    private async getTelemetryData() {
        // Instant return from cache
        if (this.lastTelemetry) return this.lastTelemetry;
        return await this.refreshTelemetryCache();
    }

    private async refreshTelemetryCache() {
        const now = Date.now();
        const si = await import('systeminformation');

        let cpu, mem, gpu;

        try {
            cpu = await si.currentLoad();
        } catch (e) {
            console.warn("[TELEMETRY] CPU fetch failed", e);
            cpu = { currentLoad: 0 };
        }

        try {
            mem = await si.mem();
        } catch (e) {
            console.warn("[TELEMETRY] Mem fetch failed", e);
            mem = { used: 0, total: 16 * 1024 * 1024 * 1024 };
        }

        try {
            // Graphics often hangs/fails on some Windows envs
            gpu = await si.graphics().catch(() => ({ controllers: [] }));
        } catch (e) {
            console.warn("[TELEMETRY] GPU fetch failed", e);
            gpu = { controllers: [] };
        }

        let vramUsed = 0;
        let vramTotal = 4096;
        if (gpu.controllers && gpu.controllers.length > 0) {
            const card = gpu.controllers[0];
            vramTotal = card.vram || 4096;
            vramUsed = (card as any).memoryUsed || 0;
        }

        // Get real provider health stats (Enriched with Local Models)
        let providerStats = {};
        try {
            const { providerHealth } = await import('../../services/providerHealthManager');
            providerStats = await providerHealth.getEnrichedHealthStats();
        } catch (e) {
            console.warn("[TELEMETRY] Provider health fetch failed", e);
        }

        const telemetry = {
            cpu: cpu.currentLoad,
            ram: { active: mem.active, total: mem.total },
            gpu: { vramUsed, vramTotal },
            activeAgents: 0,
            agentsInVram: 0,
            agentsInRam: 0,
            providerHealth: providerStats
        };

        this.lastTelemetry = telemetry;
        this.lastTelemetryTime = now;
        return telemetry;
    }

    private async getIntrospectionData() {
        try {
            const { introspection } = await import('../../services/introspectionEngine');
            return {
                thoughts: introspection.getRecentThoughts(),
                layer: introspection.getCurrentLayer(),
                activeConcepts: introspection.getActiveConcepts(),
                isDreaming: introspection.getDreaming()
            };
        } catch {
            return { thoughts: [], layer: 0, activeConcepts: [], isDreaming: false };
        }
    }

    private async getOrchestratorData() {
        try {
            const { orchestrator } = await import('../../services/orchestrator');
            const agents = orchestrator.getAgents();
            return {
                agents: agents,
                agentCount: agents.length
            };
        } catch {
            return { agents: [], agentCount: 0 };
        }
    }

    // Public endpoint for introspection state (used by introspection.routes.ts)
    async getIntrospectionState(req: Request, res: Response) {
        try {
            const state = await this.getIntrospectionData();
            res.json(state);
        } catch (e: any) {
            console.error('[SYSTEM] getIntrospectionState failed:', e.message);
            res.status(500).json({ error: 'Failed to get introspection state', thoughts: [], layer: 0, activeConcepts: [] });
        }
    }

    /**
     * Get resource metrics (CPU, RAM, VRAM) for frontend Canvas optimization
     * Uses resourceArbiter for accurate nvidia-smi based VRAM readings
     */
    async getResources(req: Request, res: Response) {
        try {
            const { resourceArbiter } = await import('../../services/resourceArbiter');
            const metrics = await resourceArbiter.getRealMetrics();
            res.json(metrics);
        } catch (e: any) {
            console.error('[SYSTEM] getResources failed:', e.message);
            // Return simulated metrics as fallback (safe defaults)
            res.json({
                cpuLoad: 25,
                ramUsed: 8 * 1024 * 1024 * 1024, // 8GB
                ramTotal: 16 * 1024 * 1024 * 1024, // 16GB
                vramUsed: 1 * 1024 * 1024 * 1024, // 1GB
                vramTotal: 4 * 1024 * 1024 * 1024 // 4GB
            });
        }
    }
}

export const systemController = new SystemController();
