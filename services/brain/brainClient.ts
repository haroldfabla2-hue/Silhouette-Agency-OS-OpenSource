// ═══════════════════════════════════════════════════════════════════════════
// SILHOUETTE BRAIN CLIENT
// ───────────────────────────────────────────────────────────────────────────
// Typed, resilient HTTP client for the external `silhouette-brain` service
// (https://github.com/haroldfabla2-hue/silhouette-brain).
//
// The Brain is an independent Python micro-service exposing a 4-Tier cognitive
// memory system (Working/Redis · Medium/SQLite · Long-Term/Vectors · Deep/Neo4j)
// plus a reasoning engine, over a plain HTTP API (default: http://localhost:9876).
//
// Design goals:
//   • Optional: the rest of the OS works whether or not the Brain is running.
//   • Graceful degradation: every call fails *closed-to-empty* (never throws to
//     the caller), so the Brain can never take down the cognitive loop.
//   • Health caching: availability is probed lazily and memoised for a short TTL
//     to avoid hammering the service on every chat turn.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '../logger';

const log = logger.child({ service: 'BrainClient' });

// ─── Response Shapes (mirror of silhouette-brain enhanced_memory_api.py) ─────

export interface BrainSource {
    type?: string;
    data?: any;
    confidence?: number;
    [key: string]: any;
}

export interface BrainMemoryEntry {
    id?: string | number;
    message?: string;
    content?: string;
    score?: number;
    similarity?: number;
    timestamp?: string | number;
    tags?: string[];
    [key: string]: any;
}

export interface BrainReasoningContext {
    query: string;
    synthesis?: string;
    semantic: BrainMemoryEntry[];
    recent: BrainMemoryEntry[];
    graph?: any[];
    tiers?: Record<string, any>;
    reasoning_chain?: string[];
    semantic_count?: number;
    recent_count?: number;
    graph_count?: number;
    [key: string]: any;
}

export interface BrainStatus {
    status: string;
    version?: string;
    endpoints?: string[];
    features?: Record<string, any>;
    [key: string]: any;
}

export interface BrainAddResult {
    status: string;
    id?: string | number;
    reason?: string;
}

export interface BrainReasoningOptions {
    semLimit?: number;
    recLimit?: number;
    hours?: number;
    minScore?: number;
    includeGraph?: boolean;
    includeTiers?: boolean;
    synthesize?: boolean;
    filterHeartbeats?: boolean;
    tierFilter?: string;
    signal?: AbortSignal;
}

export interface BrainClientConfig {
    /** Base URL of the Brain API, e.g. http://localhost:9876 */
    baseUrl: string;
    /** Whether the integration is enabled at all */
    enabled: boolean;
    /** Optional bearer token if the Brain is deployed behind an auth proxy */
    apiKey?: string;
    /** Per-request timeout in ms */
    timeoutMs: number;
    /** How long (ms) to trust a cached availability probe */
    healthTtlMs: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_HEALTH_TTL_MS = 30_000;

function readEnvConfig(): BrainClientConfig {
    const env = (typeof process !== 'undefined' && process.env) ? process.env : ({} as Record<string, string>);
    const baseUrl = (env.BRAIN_API_URL || env.SILHOUETTE_BRAIN_URL || 'http://localhost:9876').replace(/\/+$/, '');
    // Enabled if explicitly requested, or implicitly when a non-default URL is provided.
    const explicit = env.BRAIN_API_ENABLED ?? env.SILHOUETTE_BRAIN_ENABLED;
    const enabled = explicit !== undefined
        ? /^(1|true|yes|on)$/i.test(explicit)
        : Boolean(env.BRAIN_API_URL || env.SILHOUETTE_BRAIN_URL);
    return {
        baseUrl,
        enabled,
        apiKey: env.BRAIN_API_KEY || env.SILHOUETTE_BRAIN_API_KEY,
        timeoutMs: env.BRAIN_API_TIMEOUT_MS ? parseInt(env.BRAIN_API_TIMEOUT_MS, 10) : DEFAULT_TIMEOUT_MS,
        healthTtlMs: DEFAULT_HEALTH_TTL_MS,
    };
}

export class BrainClient {
    private config: BrainClientConfig;
    private availabilityCache: { value: boolean; checkedAt: number } | null = null;

    constructor(config?: Partial<BrainClientConfig>) {
        this.config = { ...readEnvConfig(), ...config };
        if (this.config.enabled) {
            log.info({ baseUrl: this.config.baseUrl }, '🧠 Silhouette Brain integration enabled');
        }
    }

    /** Reload configuration (e.g. after settings change). */
    public reconfigure(config?: Partial<BrainClientConfig>): void {
        this.config = { ...readEnvConfig(), ...config };
        this.availabilityCache = null;
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public getBaseUrl(): string {
        return this.config.baseUrl;
    }

    // ─── Core fetch wrapper ──────────────────────────────────────────────────

    private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
        const url = new URL(this.config.baseUrl + path);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.set(key, String(value));
                }
            }
        }
        return url.toString();
    }

    private async request<T>(
        method: 'GET' | 'POST',
        path: string,
        opts: { params?: Record<string, any>; body?: any; signal?: AbortSignal } = {},
    ): Promise<T | null> {
        if (!this.config.enabled) return null;

        const url = this.buildUrl(path, opts.params);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

        // If the caller passed a signal, propagate aborts.
        if (opts.signal) {
            if (opts.signal.aborted) controller.abort();
            else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        try {
            const headers: Record<string, string> = { Accept: 'application/json' };
            if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
            if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

            const res = await fetch(url, {
                method,
                headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                signal: controller.signal,
            });

            if (!res.ok) {
                log.warn({ url, status: res.status }, 'Brain API returned non-OK status');
                return null;
            }

            const text = await res.text();
            if (!text) return null;
            return JSON.parse(text) as T;
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                log.warn({ url, timeoutMs: this.config.timeoutMs }, 'Brain API request timed out');
            } else {
                log.warn({ url, error: err?.message }, 'Brain API request failed');
            }
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // ─── Health / availability ───────────────────────────────────────────────

    /** Fetch the raw status payload (uncached). */
    public async getStatus(): Promise<BrainStatus | null> {
        return this.request<BrainStatus>('GET', '/api/status');
    }

    /** Cached availability probe. Returns false when disabled or unreachable. */
    public async isAvailable(force = false): Promise<boolean> {
        if (!this.config.enabled) return false;

        const now = Date.now();
        if (!force && this.availabilityCache && now - this.availabilityCache.checkedAt < this.config.healthTtlMs) {
            return this.availabilityCache.value;
        }

        const status = await this.getStatus();
        const value = Boolean(status && status.status === 'ok');
        this.availabilityCache = { value, checkedAt: now };
        if (!value) {
            log.warn({ baseUrl: this.config.baseUrl }, 'Brain API unavailable — degrading gracefully');
        }
        return value;
    }

    // ─── Reasoning / context retrieval ───────────────────────────────────────

    /**
     * Unified reasoning context: semantic + recent (+ optional graph/tiers/synthesis).
     * This is the primary read path used by the OS context assembler.
     */
    public async getReasoningContext(query: string, opts: BrainReasoningOptions = {}): Promise<BrainReasoningContext | null> {
        if (!query?.trim()) return null;
        const result = await this.request<BrainReasoningContext>('GET', '/api/reasoning/context', {
            signal: opts.signal,
            params: {
                query,
                sem_limit: opts.semLimit ?? 5,
                rec_limit: opts.recLimit ?? 3,
                hours: opts.hours ?? 2,
                min_score: opts.minScore ?? 0.15,
                graph: opts.includeGraph ?? false,
                tiers: opts.includeTiers ?? false,
                synthesize: opts.synthesize ?? false,
                filter_heartbeats: opts.filterHeartbeats ?? true,
                tier_filter: opts.tierFilter,
            },
        });
        return result;
    }

    /** Lightweight combined context (semantic + recent), no synthesis. */
    public async getMemoryContext(query: string, opts: BrainReasoningOptions = {}): Promise<BrainReasoningContext | null> {
        if (!query?.trim()) return null;
        return this.request<BrainReasoningContext>('GET', '/api/memory/context', {
            signal: opts.signal,
            params: {
                query,
                sem_limit: opts.semLimit ?? 5,
                rec_limit: opts.recLimit ?? 3,
                hours: opts.hours ?? 2,
                min_score: opts.minScore ?? 0.15,
                filter_heartbeats: opts.filterHeartbeats ?? true,
            },
        });
    }

    /** Pure semantic (vector) search. */
    public async semanticSearch(query: string, limit = 5, minScore = 0.0): Promise<BrainMemoryEntry[]> {
        if (!query?.trim()) return [];
        const res = await this.request<{ results?: BrainMemoryEntry[] }>('GET', '/api/memory/semantic', {
            params: { query, limit, min_score: minScore, filter_heartbeats: true },
        });
        return res?.results ?? [];
    }

    /** Recent conversations from Medium memory. */
    public async getRecent(hours = 24, limit = 20): Promise<BrainMemoryEntry[]> {
        const res = await this.request<{ conversations?: BrainMemoryEntry[] }>('GET', '/api/memory/recent', {
            params: { hours, limit },
        });
        return res?.conversations ?? [];
    }

    /** Tracked entities from the knowledge graph / SQLite. */
    public async getEntities(type?: string, limit = 20): Promise<any[]> {
        const res = await this.request<{ entities?: any[] } & Record<string, any>>('GET', '/api/memory/entities', {
            params: { type, limit },
        });
        if (!res) return [];
        return res.entities ?? (Array.isArray(res) ? (res as any) : []);
    }

    /** Neo4j relationship graph around an entity. */
    public async getGraph(entity?: string): Promise<{ graph: any[]; available: boolean }> {
        const res = await this.request<{ graph?: any[]; available?: boolean }>('GET', '/api/memory/graph', {
            params: { entity },
        });
        return { graph: res?.graph ?? [], available: Boolean(res?.available) };
    }

    /** Raw 4-tier memory dump (optionally a single tier). */
    public async getTiers(tier?: 'working' | 'medium' | 'long' | 'deep'): Promise<Record<string, any> | null> {
        const res = await this.request<{ tiers?: Record<string, any> }>('GET', '/api/memory/tiers', {
            params: { tier },
        });
        return res?.tiers ?? null;
    }

    // ─── Write path ──────────────────────────────────────────────────────────

    /** Persist a memory into the Brain (Working tier by default). */
    public async addMemory(
        text: string,
        opts: { importance?: number; tags?: string[]; tier?: 'WORKING' | 'MEDIUM' | 'LONG' | 'DEEP'; channel?: string; senderId?: string } = {},
    ): Promise<BrainAddResult | null> {
        if (!text?.trim()) return null;
        return this.request<BrainAddResult>('POST', '/api/memory', {
            body: {
                text,
                importance: opts.importance ?? 0.5,
                tags: opts.tags ?? [],
                tier: opts.tier ?? 'WORKING',
                channel: opts.channel ?? 'silhouette-os',
                sender_id: opts.senderId,
            },
        });
    }

    /** Record retrieval-quality feedback so the Brain can learn source ranking. */
    public async recordFeedback(sources: string[], outcome: 'success' | 'failure', reason = '', actor = 'silhouette-os'): Promise<boolean> {
        if (!sources?.length || !outcome) return false;
        const res = await this.request<{ ok?: boolean }>('POST', '/api/reasoning/feedback', {
            body: { sources, outcome, reason, actor },
        });
        return Boolean(res?.ok);
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const brainClient = new BrainClient();
