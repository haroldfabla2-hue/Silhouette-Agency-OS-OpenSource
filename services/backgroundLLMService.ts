/**
 * BACKGROUND LLM SERVICE V2
 * ═══════════════════════════════════════════════════════════════
 * Intelligent routing for background tasks to avoid rate limits.
 * 
 * Strategy:
 * - CODING tasks → DeepSeek (cheap, best for code, no strict RPM)
 * - GENERAL tasks → ZhipuAI throttled (FREE, 10-15 RPM limit)
 * - FALLBACK → Ollama local (FREE, but uses GPU)
 * 
 * Rate Limit Handling:
 * - ZhipuAI: 10s minimum between requests (global)
 * - DeepSeek: Queue with 1s spacing (soft limit)
 * - Ollama: Only GPU constraints
 */

import { deepSeekService } from './deepSeekService';
import { ollamaService } from './ollamaService';
import { costEstimator } from './costEstimator';

export type BackgroundPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskType = 'CODE' | 'GENERAL' | 'ANALYSIS';

interface BackgroundLLMOptions {
    priority?: BackgroundPriority;
    taskType?: TaskType;
    maxTokens?: number;
    temperature?: number;
}

// Request queue for rate limiting
interface QueuedRequest {
    execute: () => Promise<string>;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    priority: number;
}

class BackgroundLLMService {
    private static instance: BackgroundLLMService;

    // Rate limiting queues
    private zhipuQueue: QueuedRequest[] = [];
    private lastZhipuRequest = 0;
    private readonly ZHIPU_MIN_INTERVAL = 10000; // 10s between ZhipuAI requests

    private deepseekQueue: QueuedRequest[] = [];
    private lastDeepseekRequest = 0;
    private readonly DEEPSEEK_MIN_INTERVAL = 1000; // 1s between DeepSeek requests

    private isProcessingZhipu = false;
    private isProcessingDeepseek = false;

    private constructor() {
        console.log('[BACKGROUND_LLM] V2 Initialized - Intelligent Routing Active');
    }

    public static getInstance(): BackgroundLLMService {
        if (!BackgroundLLMService.instance) {
            BackgroundLLMService.instance = new BackgroundLLMService();
        }
        return BackgroundLLMService.instance;
    }

    /**
     * Map priority to numeric value for queue sorting
     */
    private mapPriority(priority: BackgroundPriority): number {
        switch (priority) {
            case 'HIGH': return 1;
            case 'MEDIUM': return 2;
            case 'LOW': return 3;
            default: return 3;
        }
    }

    /**
     * Generate completion for background tasks
     * Routes to best provider based on task type and availability
     */
    public async generate(
        prompt: string,
        options: BackgroundLLMOptions = {}
    ): Promise<string> {
        const {
            priority = 'LOW',
            taskType = 'GENERAL',
            temperature
        } = options;

        console.log(`[BACKGROUND_LLM] 📋 Task: ${taskType}, Priority: ${priority}`);

        // Route based on task type
        switch (taskType) {
            case 'CODE':
            case 'ANALYSIS':
                return this.routeToDeepSeek(prompt, options);
            case 'GENERAL':
            default:
                return this.routeToZhipuOrFallback(prompt, options);
        }
    }

    /**
     * Generate code - always uses DeepSeek
     */
    public async generateCode(
        task: string,
        context?: string,
        language: string = 'TypeScript'
    ): Promise<string> {
        if (!deepSeekService.isAvailable()) {
            console.warn('[BACKGROUND_LLM] DeepSeek unavailable, falling back to ZhipuAI');
            return this.routeToZhipuOrFallback(
                `${task}\n\nContext: ${context || 'None'}\nLanguage: ${language}`,
                { taskType: 'CODE' }
            );
        }

        return this.queueDeepSeekRequest(async () => {
            return deepSeekService.generateCode(task, context, language);
        }, 'MEDIUM');
    }

    /**
     * Route to DeepSeek with queue management
     */
    private async routeToDeepSeek(
        prompt: string,
        options: BackgroundLLMOptions
    ): Promise<string> {
        // Check if DeepSeek is available
        if (!deepSeekService.isAvailable()) {
            console.warn('[BACKGROUND_LLM] ⚠️ DeepSeek unavailable, falling back');
            return this.routeToZhipuOrFallback(prompt, options);
        }

        return this.queueDeepSeekRequest(async () => {
            return deepSeekService.generateCompletion(prompt, {
                temperature: options.temperature
            });
        }, options.priority || 'LOW');
    }

    /**
     * Queue a DeepSeek request with rate limiting
     */
    private queueDeepSeekRequest(
        execute: () => Promise<string>,
        priority: BackgroundPriority
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            this.deepseekQueue.push({
                execute,
                resolve,
                reject,
                priority: this.mapPriority(priority)
            });

            // Sort by priority (lower number = higher priority)
            this.deepseekQueue.sort((a, b) => a.priority - b.priority);

            this.processDeepSeekQueue();
        });
    }

    private async processDeepSeekQueue(): Promise<void> {
        if (this.isProcessingDeepseek || this.deepseekQueue.length === 0) return;

        this.isProcessingDeepseek = true;

        while (this.deepseekQueue.length > 0) {
            const request = this.deepseekQueue.shift()!;

            // Rate limit: wait if needed
            const timeSinceLast = Date.now() - this.lastDeepseekRequest;
            if (timeSinceLast < this.DEEPSEEK_MIN_INTERVAL) {
                const waitTime = this.DEEPSEEK_MIN_INTERVAL - timeSinceLast;
                console.log(`[BACKGROUND_LLM] ⏳ DeepSeek rate limit, waiting ${waitTime}ms`);
                await new Promise(r => setTimeout(r, waitTime));
            }

            try {
                this.lastDeepseekRequest = Date.now();
                const result = await request.execute();
                request.resolve(result);
            } catch (error: any) {
                request.reject(error);
            }
        }

        this.isProcessingDeepseek = false;
    }

    /**
     * Route to ZhipuAI with strict rate limiting, fallback to Ollama
     */
    private async routeToZhipuOrFallback(
        prompt: string,
        options: BackgroundLLMOptions
    ): Promise<string> {
        return this.queueZhipuRequest(async () => {
            try {
                const { zhipuService } = await import('./zhipuService');

                if (zhipuService.isAvailable('background' as any)) {
                    console.log('[BACKGROUND_LLM] 🇨🇳 Using ZhipuAI (FREE)');
                    const result = await zhipuService.generateCompletion(prompt, {
                        maxTokens: options.maxTokens || 1024,
                        temperature: options.temperature || 0.7
                    }, 'background' as any);

                    // Track simulated cost
                    costEstimator.trackTransaction(
                        prompt.length / 4, // Rough token estimate
                        (result?.length || 0) / 4,
                        'glm-4.5-flash'
                    );

                    return result;
                }
            } catch (error: any) {
                console.warn('[BACKGROUND_LLM] ZhipuAI failed:', error.message);
            }

            // Fallback to Ollama
            if (await ollamaService.isAvailable()) {
                console.log('[BACKGROUND_LLM] 🏠 Falling back to Ollama (local)');
                const bullPriority = options.priority === 'HIGH' ? 50 : 100;
                return ollamaService.generateCompletion(prompt, [], 'fast', bullPriority);
            }

            throw new Error('[BACKGROUND_LLM] No providers available');
        }, options.priority || 'LOW');
    }

    /**
     * Queue a ZhipuAI request with strict rate limiting (10s)
     */
    private queueZhipuRequest(
        execute: () => Promise<string>,
        priority: BackgroundPriority
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            this.zhipuQueue.push({
                execute,
                resolve,
                reject,
                priority: this.mapPriority(priority)
            });

            this.zhipuQueue.sort((a, b) => a.priority - b.priority);
            this.processZhipuQueue();
        });
    }

    private async processZhipuQueue(): Promise<void> {
        if (this.isProcessingZhipu || this.zhipuQueue.length === 0) return;

        this.isProcessingZhipu = true;

        while (this.zhipuQueue.length > 0) {
            const request = this.zhipuQueue.shift()!;

            // Rate limit: wait 10s between ZhipuAI requests
            const timeSinceLast = Date.now() - this.lastZhipuRequest;
            if (timeSinceLast < this.ZHIPU_MIN_INTERVAL) {
                const waitTime = this.ZHIPU_MIN_INTERVAL - timeSinceLast;
                console.log(`[BACKGROUND_LLM] ⏳ ZhipuAI rate limit, waiting ${waitTime}ms`);
                await new Promise(r => setTimeout(r, waitTime));
            }

            try {
                this.lastZhipuRequest = Date.now();
                const result = await request.execute();
                request.resolve(result);
            } catch (error: any) {
                request.reject(error);
            }
        }

        this.isProcessingZhipu = false;
    }

    /**
     * Get service status
     */
    public async getStatus(): Promise<{
        deepseek: { available: boolean; queueLength: number };
        zhipu: { available: boolean; queueLength: number };
        ollama: { available: boolean };
    }> {
        let zhipuAvailable = false;
        try {
            const { zhipuService } = await import('./zhipuService');
            zhipuAvailable = zhipuService.isAvailable('background' as any);
        } catch { }

        return {
            deepseek: {
                available: deepSeekService.isAvailable(),
                queueLength: this.deepseekQueue.length
            },
            zhipu: {
                available: zhipuAvailable,
                queueLength: this.zhipuQueue.length
            },
            ollama: {
                available: await ollamaService.isAvailable()
            }
        };
    }
}

export const backgroundLLM = BackgroundLLMService.getInstance();
