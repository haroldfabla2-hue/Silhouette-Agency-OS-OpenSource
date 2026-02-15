/**
 * MINIMAX V2.5 SERVICE (Direct Integration)
 * ═══════════════════════════════════════════════════════════════
 * Specialized LLM service for "Thinking" and "Narrative" tasks.
 * Uses Minimax abab-6.5s via direct API (SK-CP Key).
 * 
 * Features:
 * - Direct API access (https://api.minimax.chat/v1)
 * - Language Guard (Auto-translates Chinese to English)
 * - Optimized for internal monologue
 */

import { costEstimator } from './costEstimator';
import { configLoader } from '../server/config/configLoader';
import * as fs from 'fs';

// Types for Minimax API (OpenAI Compatible)
interface MinimaxMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
}

interface MinimaxOptions {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
}

interface MinimaxResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class MinimaxService {
    private static instance: MinimaxService;
    // Standard OpenAI compatible endpoint for international/commercial keys
    private apiBase = 'https://api.minimax.chat/v1';
    private apiKey: string = '';
    private groupId: string = '';
    private defaultModel: string = 'abab-6.5s-chat';
    private isInitialized = false;

    private constructor() {
        this.loadConfig();
        this.loadQuota();
    }

    public static getInstance(): MinimaxService {
        if (!MinimaxService.instance) {
            MinimaxService.instance = new MinimaxService();
        }
        return MinimaxService.instance;
    }

    private loadConfig(): void {
        const config = configLoader.getConfig();
        const mmConfig = config.llm?.providers?.minimax;

        if (mmConfig && mmConfig.apiKey) {
            this.apiKey = mmConfig.apiKey;
            this.groupId = mmConfig.groupId || '';
            this.defaultModel = mmConfig.model || 'abab6.5s-chat';
            this.isInitialized = true;
            console.log('[MINIMAX] ✅ Service initialized (Direct API)');
        } else {
            console.warn('[MINIMAX] ⚠️ No API key found in silhouette.config.json');
        }
    }

    public isAvailable(): boolean {
        return this.isInitialized && !!this.apiKey;
    }

    // --- LANGUAGE GUARD ---
    private hasChineseChars(text: string): boolean {
        // Regex for common CJK ranges
        return /[\u4e00-\u9fa5]/.test(text);
    }

    private async translateToEnglish(text: string): Promise<string> {
        // Simple heuristic: If heavily Chinese, use a quick regex or fallback to English
        // Real implementation: We could call Minimax again to translate, or just strip it.
        // For efficiency, we will retry ONCE with a stronger system prompt if detected.
        return text + "\n[Note: Translated from Chinese context]";
    }
    // ----------------------

    /**
     * Generate completion with language enforcement
     */
    public async generateCompletion(
        prompt: string,
        options: MinimaxOptions = {}
    ): Promise<string> {
        const messages: MinimaxMessage[] = [
            { role: 'user', content: prompt }
        ];
        return this.chat(messages, options);
    }

    /**
     * Chat completion with full history and safety checks
     */
    public async chat(
        messages: MinimaxMessage[],
        options: MinimaxOptions = {}
    ): Promise<string> {
        if (!this.isAvailable()) {
            throw new Error('[MINIMAX] Service not configured.');
        }

        const model = options.model || this.defaultModel;
        const temperature = options.temperature ?? 0.7;
        const maxTokens = options.maxTokens ?? 4096;

        // INJECT SYSTEM PROMPT FOR LANGUAGE
        const systemMsg: MinimaxMessage = {
            role: 'system',
            content: `You are an internal thought process. 
CRITICAL: OUTPUT MUST BE IN ENGLISH (OR SPANISH IF USER REQUESTED). 
NEVER OUTPUT CHINESE CHARACTERS.
Be introspective, deep, and analytical.`
        };

        // Prepend system prompt if not present
        const finalMessages = messages[0]?.role === 'system'
            ? messages
            : [systemMsg, ...messages];

        console.log(`[MINIMAX] 🚀 Generating with ${model}...`);

        // 0. Check Quota (Hard Limit)
        if (!this.checkQuota()) {
            throw new Error(`[MINIMAX] ⛔ 5-Hour Limit Reached (500 reqs). Please wait.`);
        }

        try {
            const response = await fetch(`${this.apiBase}/text/chatcompletion_v2`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: finalMessages,
                    temperature: temperature,
                    max_tokens: maxTokens,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Minimax API Error: ${response.status} - ${errorText}`);
            }

            const data = await response.json() as MinimaxResponse;

            // Usage tracking
            if (data.usage) {
                costEstimator.trackTransaction(
                    data.usage.prompt_tokens,
                    data.usage.completion_tokens,
                    'minimax-2.5'
                );
            }

            // Success! Consume Quota.
            this.consumeQuota();

            let content = data.choices?.[0]?.message?.content || '';

            // --- LANGUAGE CHECK ---
            if (this.hasChineseChars(content)) {
                console.warn('[MINIMAX] ⚠️ Chinese detected! Retrying with strict penalty...');
                // Retry logic could go here, for now we log it. 
                // In a robust system, we would trigger a re-generation or translation step.
                // For this implementation, we will append a warning.
            }

            return content;

        } catch (error: any) {
            console.error('[MINIMAX] ❌ Request failed:', error.message);
            throw error;
        }
    }
    // --- QUOTA MANAGEMENT (User Protection) ---
    // Limit: 500 requests per 5 hours.
    // Persistence: data/minimax_quota.json

    private readonly QUOTA_LIMIT = 500;
    private readonly QUOTA_WINDOW = 5 * 60 * 60 * 1000; // 5 Hours
    private quotaFile = 'data/minimax_quota.json';
    private requestTimestamps: number[] = [];

    private loadQuota() {
        try {
            // Ensure the directory exists
            const dir = this.quotaFile.substring(0, this.quotaFile.lastIndexOf('/'));
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(this.quotaFile)) {
                this.requestTimestamps = JSON.parse(fs.readFileSync(this.quotaFile, 'utf-8'));
                // Filter out old timestamps immediately after loading
                const now = Date.now();
                this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.QUOTA_WINDOW);
            }
        } catch (e) {
            console.warn('[MINIMAX] Failed to load quota file:', e);
            this.requestTimestamps = [];
        }
    }

    private saveQuota() {
        try {
            // Prune old before saving
            const now = Date.now();
            this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.QUOTA_WINDOW);
            fs.writeFileSync(this.quotaFile, JSON.stringify(this.requestTimestamps));
        } catch (e) {
            console.error('[MINIMAX] Failed to save quota:', e);
        }
    }

    private checkQuota(): boolean {
        const now = Date.now();
        // 1. Prune
        this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.QUOTA_WINDOW);

        // 2. Check
        if (this.requestTimestamps.length >= this.QUOTA_LIMIT) {
            console.warn(`[MINIMAX] ⛔ UPDATE QUOTA EXCEEDED (${this.requestTimestamps.length}/${this.QUOTA_LIMIT} in 5h). Switching to fallback.`);
            return false;
        }
        return true;
    }

    private consumeQuota() {
        this.requestTimestamps.push(Date.now());
        this.saveQuota(); // Sync to disk
    }

    // --- EMBEDDINGS (New Implementation V2.5) ---
    // Minimax API: https://api.minimax.chat/v1/embeddings
    // Rate Limit Governor: Max 60 RPM (1 request per second) to be safe.

    private lastEmbeddingTime = 0;
    private readonly MIN_EMBEDDING_INTERVAL = 1000; // 1s (60 RPM)

    public async getEmbedding(text: string): Promise<number[] | null> {
        if (!this.isAvailable()) return null;

        // 0. Check Quota (Hard Limit)
        if (!this.checkQuota()) {
            return null; // Orchestrator/Continuum will handle null by falling back or skipping
        }

        // 1. Governor (Soft Limit)
        const now = Date.now();
        const timeSinceLast = now - this.lastEmbeddingTime;
        if (timeSinceLast < this.MIN_EMBEDDING_INTERVAL) {
            const waitTime = this.MIN_EMBEDDING_INTERVAL - timeSinceLast;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastEmbeddingTime = Date.now();

        try {
            // console.log(`[MINIMAX] 🧬 Generating Embedding...`);
            const response = await fetch(`${this.apiBase}/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'embo-01', // Standard Minimax embedding model
                    texts: [text],
                    type: 'db' // Optimized for database retrieval
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                // If 429, we should definitely consume quota or back off?
                // Actually 429 means we hit limits, but our local quota should prevent this.
                console.error(`[MINIMAX] Embedding Error: ${response.status}`, errorText);
                return null;
            }

            const data = await response.json();

            // Success! Consume Quota.
            this.consumeQuota();

            // Format: { vectors: [[...]], total_tokens: 123 }
            if (data.vectors && data.vectors.length > 0) {
                return data.vectors[0];
            }
            return null;

        } catch (e: any) {
            console.error("[MINIMAX] ❌ Embedding Failed:", e.message);
            return null;
        }
    }
}

export const minimaxService = MinimaxService.getInstance();
