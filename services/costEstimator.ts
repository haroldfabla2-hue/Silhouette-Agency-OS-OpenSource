import { CostMetrics, ModelUsage } from '../types';

export class CostEstimator {
    private static instance: CostEstimator;

    // Pricing Table (USD)
    // Supports: per 1M tokens, per image, per second, per request
    private readonly PRICING_TABLE: Record<string, {
        input?: number, // per 1M
        output?: number, // per 1M
        perImage?: number,
        perSecond?: number,
        perRequest?: number
    }> = {
            // --- LLMs: Gemini ---
            'gemini-2.5-flash': { input: 0.075, output: 0.30 },
            'gemini-2.0-flash-exp': { input: 0.00, output: 0.00 }, // Free Preview
            'gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
            'gemini-1.5-pro': { input: 3.50, output: 10.50 },
            'gemini-1.5-flash': { input: 0.075, output: 0.30 },

            // --- LLMs: OpenAI/Claude ---
            'gpt-4o': { input: 2.50, output: 10.00 },
            'claude-3-5-sonnet': { input: 3.00, output: 15.00 },

            // --- LLMs: ZhipuAI (z.ai) ---
            // SIMULATED COSTS (these models are FREE but we track potential spend)
            'glm-4.5-flash': { input: 0.05, output: 0.15 },      // FREE - Simulated: ~Gemini Flash tier
            'glm-4.6v-flash': { input: 0.10, output: 0.30 },     // FREE Multimodal - Simulated: ~Vision tier
            'glm-4.5': { input: 0.60, output: 2.20 },            // Paid
            'glm-4.6v': { input: 0.30, output: 0.90 },           // Paid Multimodal
            'glm-4.7': { input: 1.10, output: 4.50 },            // Premium

            // --- LLMs: Groq ---
            'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
            'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
            'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
            'groq-llama3': { input: 0.05, output: 0.10 },        // Generic Groq

            // --- LLMs: Ollama (Local - FREE) ---
            'ollama-glm4': { input: 0.00, output: 0.00 },        // Local
            'ollama-llama3.2': { input: 0.00, output: 0.00 },    // Local
            'ollama-qwen': { input: 0.00, output: 0.00 },        // Local

            // --- LLMs: DeepSeek (BEST FOR CODING) ---
            'deepseek-v3': { input: 0.28, output: 0.42 },        // 98% HumanEval, 128K context
            'deepseek-coder': { input: 0.14, output: 0.28 },     // Specialized for code
            'deepseek-chat': { input: 0.14, output: 0.28 },      // General chat

            // --- LLMs: MiniMax 2.5 (Direct) ---
            'abab-6.5s-chat': { input: 0.15, output: 0.60 },     // Approx cost (lower than OR)
            'minimax-m2.1': { input: 0.30, output: 1.20 },       // Legacy

            // --- LLMs: Mistral Codestral ---
            'codestral': { input: 0.20, output: 0.60 },          // 32K context, code specialist

            // --- IMAGE GENERATION ---
            'dall-e-3': { perImage: 0.040 }, // Standard quality
            'dall-e-3-hd': { perImage: 0.080 },
            'flux-dev': { perImage: 0.030 }, // Replicate approx
            'flux-schnell': { perImage: 0.003 }, // Replicate approx
            'sdxl': { perImage: 0.002 }, // Replicate approx
            'imagine-art': { perImage: 0.005 }, // Est

            // --- VIDEO GENERATION ---
            'google-veo-3': { perSecond: 0.10 }, // Est
            'svd-xt': { perSecond: 0.05 }, // Replicate approx

            // --- VOICE ---
            'eleven-labs-turbo': { input: 0.18, output: 0 }, // $0.18 per 1000 chars (treated as input tokens/1000 * 1000 for simplicity, or just use custom logic)
            // Actually ElevenLabs is per character. Let's use 'input' as 'characters' for 1M normalization or add perCharacter. 
            // 1M chars = $180.00. 
            'eleven-multilingual-v2': { input: 180.00 },
            'openai-tts': { input: 15.00 }, // $0.015 per 1k chars -> $15 per 1M

            // --- UTILS ---
            'unsplash-api': { perRequest: 0.00 }, // Free tier usually, but good to track
            'replicate-upscaler': { perImage: 0.01 },
            'default': { input: 3.50, output: 10.50 }
        };

    private metrics: CostMetrics = {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        sessionCost: 0,
        lastRequestCost: 0,
        modelBreakdown: {}
    };

    private constructor() {
        this.loadPersistedMetrics();
    }

    public static getInstance(): CostEstimator {
        if (!CostEstimator.instance) {
            CostEstimator.instance = new CostEstimator();
        }
        return CostEstimator.instance;
    }

    // Track LLM Transactions
    public trackTransaction(input: number, output: number, modelId: string = 'default') {
        const pricing = this.PRICING_TABLE[modelId] || this.PRICING_TABLE['default'];

        const inputCost = pricing.input ? (input / 1000000) * pricing.input : 0;
        const outputCost = pricing.output ? (output / 1000000) * pricing.output : 0;
        const total = inputCost + outputCost;

        this.updateMetrics(total, input, output, 0, 0, 0, modelId);
    }

    // Track Event Transactions (Images, Video Seconds, API Requests)
    public trackEvent(modelId: string, quantity: number = 1) {
        const pricing = this.PRICING_TABLE[modelId] || { perImage: 0, perSecond: 0, perRequest: 0 };
        let total = 0;
        let images = 0;
        let seconds = 0;
        let requests = 0;

        if (pricing.perImage) {
            total = quantity * pricing.perImage;
            images = quantity;
        } else if (pricing.perSecond) {
            total = quantity * pricing.perSecond;
            seconds = quantity;
        } else if (pricing.perRequest) {
            total = quantity * pricing.perRequest;
        }
    }

    private saveTimeout: NodeJS.Timeout | null = null;

    private updateMetrics(cost: number, input: number, output: number, images: number, seconds: number, requests: number, modelId: string) {
        // Global
        this.metrics.inputTokens += input;
        this.metrics.outputTokens += output;
        this.metrics.totalTokens += (input + output);
        this.metrics.totalCost += cost;
        this.metrics.sessionCost += cost;
        this.metrics.lastRequestCost = cost;

        // Model Specific
        if (!this.metrics.modelBreakdown[modelId]) {
            this.metrics.modelBreakdown[modelId] = {
                inputTokens: 0, outputTokens: 0, images: 0, seconds: 0, requests: 0, cost: 0
            };
        }
        const m = this.metrics.modelBreakdown[modelId];
        m.inputTokens += input;
        m.outputTokens += output;
        m.images += images;
        m.seconds += seconds;
        m.requests += requests;
        m.cost += cost;

        this.schedulePersistence();
    }

    private schedulePersistence() {
        if (this.saveTimeout) return; // Already scheduled

        // Debounce: Wait 5 seconds before writing to disk to avoid IO thrashing
        this.saveTimeout = setTimeout(() => {
            this.persistMetrics();
            this.saveTimeout = null;
        }, 5000);
    }

    public reset() {
        this.metrics = {
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalCost: 0,
            sessionCost: 0,
            lastRequestCost: 0,
            dailyCost: 0,
            projectedMonthly: 0,
            costPerToken: 0,
            tokenCount: 0,
            modelBreakdown: {}
        };
        this.persistMetrics();
    }

    public getMetrics(): CostMetrics {
        return { ...this.metrics };
    }

    public hydrate(metrics: CostMetrics) {
        this.metrics = { ...metrics };
    }

    public getPricingTable() {
        return this.PRICING_TABLE;
    }

    private async loadPersistedMetrics() {
        try {
            if (typeof window === 'undefined') {
                // SERVER SIDE (Node.js) -> Use SQLite
                const { sqliteService } = await import('./sqliteService');
                const persisted = sqliteService.getCostMetrics();
                if (persisted) {
                    this.hydrate(persisted);
                    console.log("[COST] Loaded metrics from SQLite.");
                }
            } else {
                // CLIENT SIDE (Browser)
                const data = localStorage.getItem('silhouette_cost_metrics');
                if (data) {
                    const persisted = JSON.parse(data);
                    this.hydrate(persisted);
                }
            }
        } catch (e) {
            console.error("[COST] Failed to load metrics:", e);
        }
    }

    private async persistMetrics() {
        try {
            if (typeof window === 'undefined') {
                // SERVER SIDE (Node.js) -> Use SQLite
                const { sqliteService } = await import('./sqliteService');
                sqliteService.saveCostMetrics(this.metrics);
            } else {
                // CLIENT SIDE (Browser)
                localStorage.setItem('silhouette_cost_metrics', JSON.stringify(this.metrics));
            }
        } catch (e) {
            console.error("[COST] Failed to save metrics:", e);
        }
    }
}

export const costEstimator = CostEstimator.getInstance();
