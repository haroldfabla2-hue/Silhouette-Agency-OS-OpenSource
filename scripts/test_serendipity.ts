
import fs from 'fs';
import path from 'path';

// MANUAL ENV LOADER (Since we don't have dotenv and npx tsx doesn't load .env by default)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
    console.log("✅ Loaded .env.local for Test Environment");
} else {
    console.warn("⚠️ .env.local not found. API calls may fail.");
}

import { dreamer } from '../services/dreamerService';
import { continuum } from '../services/continuumMemory';
import { vectorMemory } from '../services/vectorMemoryService';
import { geminiService } from '../services/geminiService';

// RE-CONFIGURE GEMINI SERVICE WITH LOADED KEY
// Because imports are hoisted, geminiService initiated with empty key.
const loadedKey = process.env.VITE_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
if (loadedKey) {
    console.log(`✅ Injecting API Key into Gemini Service: ${loadedKey.substring(0, 5)}...`);
    geminiService.configureGenAI(loadedKey);
} else {
    console.error("❌ No API Key found in .env.local!");
}

// Monkey Patching for Deterministic Test
console.log("--- TEST: SERENDIPITY (BISOCIATION) ---");
console.log("1. Setting up Mock Memories (Software vs. Biology)...");

// MOCK: Gemni Service to bypass API Key issues during Logic Test
geminiService.generateEmbedding = async (text: string) => {
    console.log(`[MOCK] Generating embedding for: "${text.substring(0, 15)}..."`);
    return Array(768).fill(0.1); // Return dummy vector
};

// MOCK: Agent Response (The LLM)
geminiService.generateAgentResponse = async (...args) => {
    const prompt = args[3] as string;
    console.log(`[MOCK] LLM Prompt received (${prompt.length} chars).`);

    // Simulate "Synesthete" output
    if (prompt.includes("Synesthete")) {
        return { output: "BISOCIATION: Both systems act as guardians, isolating threats to preserve the integrity of the whole." } as any;
    }

    // Simulate "Critic" output
    if (prompt.includes("Critic")) {
        return { output: "SCORE: 9.5" } as any;
    }

    return { output: "..." } as any;
};

// MOCK: Continuum returns one Anchor
continuum.getAllNodes = async () => {
    return {
        SHORT: [{
            content: "Microservices architecture requires independent deployment and fault isolation to prevent cascading failures.",
            timestamp: Date.now(),
            id: 'mock-anchor',
            tags: [],
            importance: 1
        }]
    } as any;
};

// MOCK: Vector Memory returns a "Goldilocks" match (Biology)
vectorMemory.searchMemory = async (vector: number[], limit: number) => {
    return [{
        id: 'mock-match',
        score: 0.65, // PERFECT GOLDILOCKS ZONE (0.5 - 0.85)
        payload: {
            content: "In biological ecosystems, compartmentalization allows organisms to survive viral outbreaks by cutting off infected tissues."
        }
    }];
};

async function runTest() {
    try {
        console.log("2. Triggering Deep Dream...");
        await dreamer.synthesizeDeepConnections();
        console.log("3. Test Complete. Check logs above for 'Isomorphism' and 'Critic Grade'.");
    } catch (e) {
        console.error("Test Failed:", e);
    }
}

runTest();
