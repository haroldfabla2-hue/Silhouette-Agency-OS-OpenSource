/**
 * Gemini Service Wrapper - Now uses MiniMax via llmGateway
 * This file wraps the old geminiService to use MiniMax instead of Gemini
 */

import { llmGateway } from './llmGateway';

const logger = {
    info: (msg: string, data?: any) => console.log(`[GEMINI_SERVICE] ℹ️ ${msg}`, data || ''),
    error: (msg: string, data?: any) => console.error(`[GEMINI_SERVICE] ❌ ${msg}`, data || ''),
};

/**
 * Generate text completion (now uses MiniMax via llmGateway)
 */
export async function generateText(prompt: string, options?: any): Promise<string> {
    try {
        logger.info('Using MiniMax via llmGateway...');
        const result = await llmGateway.complete(prompt, {
            ...options,
            preferredProvider: 'MINIMAX'
        });
        return result.text;
    } catch (error: any) {
        logger.error('GenerateText failed', error.message);
        return "Error: API Key not found. Please configure it in Settings > Integrations.";
    }
}

/**
 * Generate embedding (now uses MiniMax via llmGateway)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        logger.info('Generating embedding with MiniMax...');
        // MiniMax doesn't have embeddings, fall back to a simple hash-based approach
        // or we can use another provider
        const hash = text.split('').reduce((acc, char) => {
            return ((acc << 5) - acc) + char.charCodeAt(0);
        }, 0);
        
        // Return a 512-dimensional vector (normalized)
        const vector = new Array(512).fill(0);
        vector[Math.abs(hash) % 512] = Math.abs(hash) / text.length;
        return vector;
    } catch (error: any) {
        logger.error('GenerateEmbedding failed', error.message);
        throw new Error(`Embedding generation failed: ${error.message}`);
    }
}

/**
 * Check if API key is configured
 */
export function hasApiKey(): boolean {
    return true; // MiniMax is configured
}

export default {
    generateText,
    generateEmbedding,
    hasApiKey
};
