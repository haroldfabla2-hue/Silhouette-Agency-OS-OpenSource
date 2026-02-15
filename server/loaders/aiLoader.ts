
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local (priority) and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { vectorMemory } from '../../services/vectorMemoryService';
import { configureGenAI } from '../../services/geminiService';
import { sqliteService } from '../../services/sqliteService';
import { mediaService } from '../../services/mediaService';
import { toolRegistry } from '../../services/tools/toolRegistry';

export const initAIServices = async () => {
    console.log("[LOADER] 🧠 Initializing AI Services...");

    // 1. Vector Memory
    try {
        await vectorMemory.connect();
        console.log("[LOADER] ✅ Vector Memory Connected.");
    } catch (e) {
        console.error("[LOADER] ❌ Failed to connect to Vector Memory:", e);
    }

    // 2. Hydrate GenAI Config
    const apiKey = sqliteService.getConfig('systemApiKey') || process.env.GEMINI_API_KEY;
    if (apiKey) {
        configureGenAI(apiKey);
        console.log("[LOADER] ✅ GenAI Configured from Persistence.");
    }

    // 3. Configure MediaService with API keys from environment
    const mediaConfig = {
        executionMode: 'SERVER' as const,
        replicateKey: process.env.REPLICATE_API_TOKEN,
        openaiKey: process.env.OPENAI_API_KEY,
        imagineArtKey: process.env.IMAGINE_ART_KEY,
        elevenLabsKey: process.env.ELEVENLABS_API_KEY,
        unsplashKey: process.env.UNSPLASH_ACCESS_KEY
    };

    // Only log configured providers
    const configuredProviders = Object.entries(mediaConfig)
        .filter(([k, v]) => v && k !== 'executionMode')
        .map(([k]) => k.replace('Key', ''));

    if (configuredProviders.length > 0) {
        mediaService.updateConfig(mediaConfig);
        console.log(`[LOADER] ✅ MediaService Configured. Providers: ${configuredProviders.join(', ')}`);
    } else {
        console.warn("[LOADER] ⚠️ No media API keys found in environment. Image/video generation will fail.");
    }

    // 4. Initialize Tool Registry (CRITICAL for tool execution)
    // This registers all core tools including generate_image, web_search, etc.
    try {
        await toolRegistry.initialize();
        console.log("[LOADER] ✅ Tool Registry Initialized.");
    } catch (e) {
        console.error("[LOADER] ❌ Failed to initialize Tool Registry:", e);
    }
};
