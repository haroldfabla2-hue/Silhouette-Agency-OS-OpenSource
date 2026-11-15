// Shared SDK/key state only. No app owner, timer, constructor boot or provider call on import.
import { GoogleGenAI } from '@google/genai';
import { externalProvidersDisabled } from './security/bootMode';

// [ROBUST] Lazy initialization - don't read env at module level
// Environment might not be loaded yet when this module is first imported
export const apiKeys: string[] = [];
export let currentKeyIndex = 0;
export let apiKey: string | null = null;
export let ai: GoogleGenAI | null = null;

export function ensureClient(): GoogleGenAI | null {
    if (externalProvidersDisabled()) return null;
    // Lazy load API key on first use (after dotenv has loaded)
    if (ai === null) {
        // Load Primary and Rotation Keys
        const primary = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (primary) apiKeys.push(primary);

        // Load up to 5 rotation keys
        for (let i = 2; i <= 5; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key) apiKeys.push(key);
        }

        if (apiKeys.length > 0) {
            ai = new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
            console.log(`[GeminiService] 🔌 Client initialized with Key #${currentKeyIndex + 1} (Total: ${apiKeys.length}).`);
        }
    }
    return ai;
}

export function rotateKey(): boolean {
    if (apiKeys.length <= 1) return false; // No rotation possible

    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    ai = new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
    console.warn(`[GEMINI] 🔄 Rotating to API Key #${currentKeyIndex + 1}`);
    return true;
}

export const configureGenAI = (key: string) => {
    if (externalProvidersDisabled()) throw new Error('External providers disabled by process policy');
    apiKey = key;
    ai = new GoogleGenAI({ apiKey });
    console.log("[GEMINI] API Key updated dynamically.");
};
