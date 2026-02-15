import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { SilhouetteConfig, DEFAULT_CONFIG } from './configSchema';
import { PATHS } from './paths';

// Load .env files for initial migration
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const CONFIG_PATH = path.join(process.cwd(), 'silhouette.config.json');

export class ConfigLoader {
    private static instance: ConfigLoader;
    private config: SilhouetteConfig;

    private constructor() {
        this.config = this.loadOrMigrate();
    }

    public static getInstance(): ConfigLoader {
        if (!ConfigLoader.instance) {
            ConfigLoader.instance = new ConfigLoader();
        }
        return ConfigLoader.instance;
    }

    /**
     * Main config accessor
     */
    public getConfig(): SilhouetteConfig {
        return this.config;
    }

    /**
     * Save config updates to disk
     */
    public saveConfig(newConfig: Partial<SilhouetteConfig>): void {
        this.config = { ...this.config, ...newConfig };
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 4), 'utf-8');
            console.log('[CONFIG] 💾 Configuration saved to silhouette.config.json');
        } catch (error) {
            console.error('[CONFIG] ❌ Failed to save configuration:', error);
        }
    }

    /**
     * Load JSON or migrate from ENV if missing
     */
    private loadOrMigrate(): SilhouetteConfig {
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
                const loaded = JSON.parse(raw);
                console.log('[CONFIG] ✅ Loaded silhouette.config.json');
                // Shallow merge with defaults to ensure new fields flow in
                return { ...DEFAULT_CONFIG, ...loaded };
            } catch (error) {
                console.error('[CONFIG] ⚠️ Corrupt config file, falling back to defaults/env:', error);
            }
        }

        console.log('[CONFIG] 🚀 initializing from ENV (First Run / Migration)...');
        return this.migrateFromEnv();
    }

    /**
     * Construct config from Environment Variables (Migration Logic)
     */
    private migrateFromEnv(): SilhouetteConfig {
        const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as SilhouetteConfig;

        // System
        if (process.env.PORT) config.system.port = Number(process.env.PORT);
        if (process.env.NODE_ENV) config.system.env = process.env.NODE_ENV as any;

        // LLM - Providers
        if (process.env.GEMINI_API_KEY) {
            config.llm.providers.gemini = {
                apiKey: process.env.GEMINI_API_KEY,
                model: 'gemini-1.5-pro-latest' // Default
            };
        }

        if (process.env.GROQ_API_KEY) {
            config.llm.providers.groq = {
                apiKey: process.env.GROQ_API_KEY,
                model: 'llama3-70b-8192'
            };
        }

        if (process.env.DEEPSEEK_API_KEY) {
            config.llm.providers.deepseek = {
                apiKey: process.env.DEEPSEEK_API_KEY,
                model: 'deepseek-coder'
            };
        }

        if (process.env.OPENROUTER_API_KEY) {
            config.llm.providers.openrouter = {
                apiKey: process.env.OPENROUTER_API_KEY,
                model: 'google/gemini-2.0-flash-exp:free'
            };
        }

        // [PHASE 10] Minimax Prime
        if (process.env.MINIMAX_API_KEY) {
            config.llm.providers.minimax = {
                apiKey: process.env.MINIMAX_API_KEY,
                groupId: process.env.MINIMAX_GROUP_ID,
                model: 'abab-6.5s-chat'
            };
        }

        // ZhipuAI (custom handling for pool)
        if (process.env.ZHIPU_API_KEYS) {
            // We don't have a direct field for "pool" in standard providers yet, 
            // but we can map the first key if needed, or stick to the ENV usage for complex pools 
            // until schema is updated. For now, let's leave complex pools to ENV or manual config.
        }

        // Channels
        if (process.env.TELEGRAM_BOT_TOKEN) {
            config.channels.telegram = {
                enabled: true,
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                allowedChatIds: []
            };
        }

        if (process.env.DISCORD_BOT_TOKEN) {
            config.channels.discord = {
                enabled: true,
                botToken: process.env.DISCORD_BOT_TOKEN
            };
        }

        // Media
        if (process.env.ELEVENLABS_API_KEY) {
            config.media.elevenlabs = {
                apiKey: process.env.ELEVENLABS_API_KEY,
                defaultVoice: 'rachel'
            };
        }

        // Persist the migrated config immediately
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
            console.log('[CONFIG] ✨ Migration complete: Created silhouette.config.json');
        } catch (e) {
            console.error('[CONFIG] Migration save failed', e);
        }

        return config;
    }
}

export const configLoader = ConfigLoader.getInstance();
export const config = configLoader.getConfig();
