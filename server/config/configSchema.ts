// =============================================================================
// SILHOUETTE CENTRALIZED CONFIGURATION SCHEMA
// Centralized configuration management. Defines the full config tree
// with defaults, validation, and environment variable overrides.
// =============================================================================

import fs from 'fs';
import path from 'path';

// ─── Configuration Interface ─────────────────────────────────────────────────

export interface SilhouetteConfig {
    /** Core system settings */
    system: {
        /** Display name for this instance */
        name: string;
        /** Server HTTP port */
        port: number;
        /** Environment mode */
        env: 'development' | 'production' | 'test';
        /** Enable verbose logging */
        debug: boolean;
        /** Server version string */
        version: string;
    };

    /** Service Modules (Lite Mode Toggles) [PA-058] */
    modules: {
        /** Enable Neo4j Graph */
        graph: boolean;
        /** Enable Qdrant Vector DB */
        vectorDB: boolean;
        /** Enable Redis */
        redis: boolean;
        /** Enable Puppeteer Browser */
        browser: boolean;
    };

    /** WebSocket Gateway configuration */
    gateway: {
        /** WS path on the HTTP server */
        path: string;
        /** Heartbeat interval in ms */
        heartbeatMs: number;
        /** Max payload size in bytes */
        maxPayloadBytes: number;
        /** Handshake timeout in ms */
        handshakeTimeoutMs: number;
    };

    /** LLM Provider configuration */
    llm: {
        /** Default provider to use */
        defaultProvider: string;
        /** Provider configurations */
        providers: {
            gemini?: { apiKey: string; model: string };
            groq?: { apiKey: string; model: string };
            deepseek?: { apiKey: string; model: string };
            minimax?: { apiKey: string; groupId?: string; model: string };
            ollama?: { baseUrl: string; model: string };
            openrouter?: { apiKey: string; model: string };
        };
        /** Fallback chain order */
        fallbackChain: string[];
        /** Circuit breaker settings */
        circuitBreaker: {
            maxFailures: number;
            resetTimeMs: number;
        };
    };

    /** Memory system configuration */
    memory: {
        /** SQLite database path */
        sqlitePath: string;
        /** LanceDB directory */
        lanceDbPath: string;
        /** Neo4j connection */
        neo4j: {
            uri: string;
            user: string;
            password: string;
        };
        /** Redis connection */
        redis: {
            host: string;
            port: number;
            password?: string;
        };
        /** Working memory max entries */
        workingMemoryLimit: number;
        /** Idle sweep interval ms */
        sweepIntervalMs: number;
    };

    /** Channel configuration */
    channels: {
        whatsapp?: {
            enabled: boolean;
            sessionPath: string;
            accessMode: 'open' | 'allowlist';
            allowFrom?: string[];  // Allowed phone numbers
        };
        telegram?: {
            enabled: boolean;
            botToken: string;
            accessMode: 'open' | 'allowlist';
            allowedChatIds?: number[];
        };
        discord?: {
            enabled: boolean;
            botToken: string;
            accessMode: 'open' | 'allowlist';
            allowedGuildIds?: string[];
        };
    };

    /** Tool execution security */
    tools: {
        /** Tools that are always allowed */
        allowlist: string[];
        /** Tools that are always blocked */
        denylist: string[];
        /** Require approval for side-effecting tools */
        requireApproval: boolean;
        /** Docker sandbox for code execution */
        sandbox: {
            enabled: boolean;
            image: string;
            memoryLimit: string;
            timeoutMs: number;
        };
    };

    /** Scheduler / Cron configuration */
    scheduler: {
        /** Enable cron scheduler */
        enabled: boolean;
        /** Persist jobs to disk */
        persistJobs: boolean;
        /** Max concurrent jobs */
        maxConcurrent: number;
    };

    /** Media pipeline */
    media: {
        /** Upload directory */
        uploadsDir: string;
        /** ElevenLabs TTS */
        elevenlabs?: {
            apiKey: string;
            defaultVoice: string;
        };
        /** Image generation */
        imageGeneration: {
            provider: string;
            apiKey?: string;
        };
    };

    /** Autonomy settings */
    autonomy: {
        /** Enable autonomous mode */
        enabled: boolean;
        /** Maximum daily token budget */
        maxDailyTokens: number;
        /** Allow self-evolution */
        allowEvolution: boolean;
        /** Max concurrent agents */
        maxConcurrentAgents: number;
        /** Enable Stream of Consciousness (Narrator) */
        enableNarrative: boolean;
        /** Enable Metacognition (Introspection) */
        enableIntrospection: boolean;
    };
}

// ─── Default Configuration ───────────────────────────────────────────────────

export const DEFAULT_CONFIG: SilhouetteConfig = {
    system: {
        name: 'Silhouette Agency OS',
        port: 3005,
        env: 'development',
        debug: false,
        version: '2.2.0',
    },
    modules: {
        graph: true,
        vectorDB: true,
        redis: true,
        browser: true,
    },
    gateway: {
        path: '/ws',
        heartbeatMs: 30_000,
        maxPayloadBytes: 10 * 1024 * 1024,
        handshakeTimeoutMs: 5_000,
    },
    llm: {
        defaultProvider: 'gemini',
        providers: {},
        fallbackChain: ['gemini', 'groq', 'deepseek', 'ollama'],
        circuitBreaker: {
            maxFailures: 3,
            resetTimeMs: 60_000,
        },
    },
    memory: {
        sqlitePath: './data/silhouette.db',
        lanceDbPath: './data/lancedb',
        neo4j: {
            uri: 'bolt://localhost:7687',
            user: 'neo4j',
            password: '',
        },
        redis: {
            host: 'localhost',
            port: 6379,
        },
        workingMemoryLimit: 1000,
        sweepIntervalMs: 5 * 60_000,
    },
    channels: {},
    tools: {
        allowlist: [],
        denylist: [],
        requireApproval: true,
        sandbox: {
            enabled: false,
            image: 'silhouette-sandbox:latest',
            memoryLimit: '512m',
            timeoutMs: 30_000,
        },
    },
    scheduler: {
        enabled: true,
        persistJobs: true,
        maxConcurrent: 5,
    },
    media: {
        uploadsDir: './uploads',
        imageGeneration: {
            provider: 'gemini',
        },
    },
    autonomy: {
        enabled: false,
        maxDailyTokens: 100_000,
        allowEvolution: false,
        maxConcurrentAgents: 10,
        enableNarrative: false,      // Default disabled
        enableIntrospection: false,  // Default disabled
    },
};

// ─── Config Loader ───────────────────────────────────────────────────────────

const CONFIG_FILENAME = 'silhouette.config.json';

/**
 * Deep merge two objects (target is mutated).
 */
function deepMerge(target: any, source: any): any {
    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            target[key] &&
            typeof target[key] === 'object'
        ) {
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

/**
 * Apply environment variable overrides.
 * Convention: SILHOUETTE__SECTION__KEY → config.section.key
 */
function applyEnvOverrides(config: SilhouetteConfig): void {
    const envMap: Record<string, (val: string) => void> = {
        'PORT': (v) => config.system.port = parseInt(v, 10),
        'NODE_ENV': (v) => config.system.env = v as any,
        'SILHOUETTE_DEBUG': (v) => config.system.debug = v === 'true',
        // LLM Providers (from existing .env.local)
        'GEMINI_API_KEY': (v) => {
            if (!config.llm.providers.gemini) config.llm.providers.gemini = { apiKey: '', model: 'gemini-2.0-flash' };
            config.llm.providers.gemini.apiKey = v;
        },
        'GROQ_API_KEY': (v) => {
            if (!config.llm.providers.groq) config.llm.providers.groq = { apiKey: '', model: 'llama-3.3-70b-versatile' };
            config.llm.providers.groq.apiKey = v;
        },
        'DEEPSEEK_API_KEY': (v) => {
            if (!config.llm.providers.deepseek) config.llm.providers.deepseek = { apiKey: '', model: 'deepseek-chat' };
            config.llm.providers.deepseek.apiKey = v;
        },
        'OLLAMA_BASE_URL': (v) => {
            if (!config.llm.providers.ollama) config.llm.providers.ollama = { baseUrl: v, model: 'llama3:8b' };
            config.llm.providers.ollama.baseUrl = v;
        },
        // Memory
        'NEO4J_URI': (v) => config.memory.neo4j.uri = v,
        'NEO4J_USER': (v) => config.memory.neo4j.user = v,
        'NEO4J_PASSWORD': (v) => config.memory.neo4j.password = v,
        'REDIS_HOST': (v) => config.memory.redis.host = v,
        'REDIS_PORT': (v) => config.memory.redis.port = parseInt(v, 10),
        // Channels
        'TELEGRAM_BOT_TOKEN': (v) => {
            if (!config.channels.telegram) config.channels.telegram = { enabled: true, botToken: '', accessMode: 'allowlist' };
            config.channels.telegram.botToken = v;
            config.channels.telegram.enabled = true;
        },
        'DISCORD_BOT_TOKEN': (v) => {
            if (!config.channels.discord) config.channels.discord = { enabled: true, botToken: '', accessMode: 'allowlist' };
            config.channels.discord.botToken = v;
            config.channels.discord.enabled = true;
        },
        // Media
        'ELEVENLABS_API_KEY': (v) => {
            config.media.elevenlabs = config.media.elevenlabs ?? { apiKey: '', defaultVoice: 'Rachel' };
            config.media.elevenlabs.apiKey = v;
        },
    };

    for (const [envKey, setter] of Object.entries(envMap)) {
        const value = process.env[envKey];
        if (value) {
            setter(value);
        }
    }
}

/**
 * Load configuration with priority:
 * 1. Default config
 * 2. silhouette.config.json (if exists)
 * 3. Environment variables (.env.local, .env, process.env)
 */
export function loadConfig(projectRoot?: string): SilhouetteConfig {
    const root = projectRoot ?? process.cwd();
    const configPath = path.join(root, CONFIG_FILENAME);

    // Start with defaults (deep copy)
    const config: SilhouetteConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    // Layer 2: JSON config file
    if (fs.existsSync(configPath)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            deepMerge(config, fileConfig);
            console.log(`[Config] 📄 Loaded ${CONFIG_FILENAME}`);
        } catch (err) {
            console.error(`[Config] ⚠️ Failed to parse ${CONFIG_FILENAME}:`, err);
        }
    }

    // Layer 3: Environment overrides (highest priority for secrets)
    applyEnvOverrides(config);

    return config;
}

/**
 * Save current config to disk (excluding secrets).
 */
export function saveConfig(config: SilhouetteConfig, projectRoot?: string): void {
    const root = projectRoot ?? process.cwd();
    const configPath = path.join(root, CONFIG_FILENAME);

    // Strip sensitive fields before saving
    const safeConfig = JSON.parse(JSON.stringify(config));

    // Redact API keys
    if (safeConfig.llm?.providers) {
        for (const provider of Object.values(safeConfig.llm.providers) as any[]) {
            if (provider?.apiKey) provider.apiKey = '***REDACTED***';
        }
    }
    if (safeConfig.channels?.telegram?.botToken) {
        safeConfig.channels.telegram.botToken = '***REDACTED***';
    }
    if (safeConfig.channels?.discord?.botToken) {
        safeConfig.channels.discord.botToken = '***REDACTED***';
    }
    if (safeConfig.media?.elevenlabs?.apiKey) {
        safeConfig.media.elevenlabs.apiKey = '***REDACTED***';
    }
    if (safeConfig.memory?.neo4j?.password) {
        safeConfig.memory.neo4j.password = '***REDACTED***';
    }

    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf-8');
    console.log(`[Config] 💾 Saved ${CONFIG_FILENAME} (secrets redacted)`);
}

/**
 * Validate essential config fields.
 * Returns an array of issues found.
 */
export function validateConfig(config: SilhouetteConfig): string[] {
    const issues: string[] = [];

    // System
    if (!config.system.port || config.system.port < 1 || config.system.port > 65535) {
        issues.push('system.port must be between 1 and 65535');
    }

    // LLM - at least one provider should have an API key
    const hasProvider = Object.values(config.llm.providers).some(
        (p: any) => p?.apiKey || p?.baseUrl
    );
    if (!hasProvider) {
        issues.push('No LLM providers configured. Set at least GEMINI_API_KEY or OLLAMA_BASE_URL');
    }

    return issues;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _config: SilhouetteConfig | null = null;

export function getConfig(): SilhouetteConfig {
    if (!_config) {
        _config = loadConfig();
    }
    return _config;
}

export function resetConfig(): void {
    _config = null;
}
