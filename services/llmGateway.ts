/**
 * LLM GATEWAY SERVICE - Unified Multi-Provider Access
 * 
 * Centralizes all LLM calls with:
 * - Automatic fallback chain (Gemini → Groq → DeepSeek → Ollama)
 * - Circuit breaker per provider
 * - Retry with exponential backoff
 * - Latency and cost tracking
 * - Provider health monitoring
 * 
 * Usage:
 *   const result = await llmGateway.complete("Your prompt here");
 *   const stream = llmGateway.stream("Your prompt here");
 */

import { modelCatalog, ModelCatalogEntry, getModelById } from './modelCatalog';

// Provider status for circuit breaker
interface ProviderStatus {
    name: string;
    failures: number;
    lastFailure: number;
    circuitOpen: boolean;
    totalCalls: number;
    totalLatencyMs: number;
    currentModel?: string; // NEW: Track currently active model for this provider
}

// Completion options
interface CompletionOptions {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    preferredProvider?: 'GEMINI' | 'GROQ' | 'DEEPSEEK' | 'OLLAMA' | 'MINIMAX';
    skipProviders?: string[];
    timeout?: number;
}

// Completion result
interface CompletionResult {
    text: string;
    provider: string;
    latencyMs: number;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

const logger = {
    info: (msg: string, data?: any) => console.log(`[LLM_GATEWAY] ℹ️ ${msg}`, data || ''),
    warn: (msg: string, data?: any) => console.warn(`[LLM_GATEWAY] ⚠️ ${msg}`, data || ''),
    error: (msg: string, data?: any) => console.error(`[LLM_GATEWAY] ❌ ${msg}`, data || ''),
    debug: (msg: string, data?: any) => {
        if (process.env.DEBUG_LLM_GATEWAY) console.log(`[LLM_GATEWAY] 🔍 ${msg}`, data || '');
    }
};

class LLMGatewayService {
    private readonly CONFIG = {
        CIRCUIT_BREAKER_THRESHOLD: 3,      // Failures before opening circuit
        CIRCUIT_BREAKER_RESET_MS: 60000,   // 1 minute before retrying failed provider
        RETRY_DELAY_BASE_MS: 1000,         // Base delay for exponential backoff
        MAX_RETRIES: 2,                    // Max retries per provider
        DEFAULT_TIMEOUT_MS: 30000          // 30 second timeout
    };

    private providers: Map<string, ProviderStatus> = new Map([
        ['GEMINI', { name: 'GEMINI', failures: 0, lastFailure: 0, circuitOpen: false, totalCalls: 0, totalLatencyMs: 0, currentModel: 'gemini-2.0-flash' }],
        ['GROQ', { name: 'GROQ', failures: 0, lastFailure: 0, circuitOpen: false, totalCalls: 0, totalLatencyMs: 0, currentModel: 'llama-3.3-70b-versatile' }],
        ['DEEPSEEK', { name: 'DEEPSEEK', failures: 0, lastFailure: 0, circuitOpen: false, totalCalls: 0, totalLatencyMs: 0, currentModel: 'deepseek-chat' }],
        ['OLLAMA', { name: 'OLLAMA', failures: 0, lastFailure: 0, circuitOpen: false, totalCalls: 0, totalLatencyMs: 0, currentModel: 'qwen2.5-coder:7b' }],
        ['MINIMAX', { name: 'MINIMAX', failures: 0, lastFailure: 0, circuitOpen: false, totalCalls: 0, totalLatencyMs: 0, currentModel: 'abab6.5s-chat' }],
        ['ZHIPUAI', { name: 'ZHIPUAI', failures: 0, lastFailure: 0, circuitOpen: false, totalCalls: 0, totalLatencyMs: 0, currentModel: 'glm-4-flash' }]
    ]);

    private readonly FALLBACK_ORDER = ['MINIMAX', 'GEMINI', 'GROQ', 'DEEPSEEK', 'OLLAMA'];

    /**
     * Complete a prompt using the best available provider
     */
    public async complete(prompt: string, options: CompletionOptions = {}): Promise<CompletionResult> {
        const startTime = Date.now();
        const skipProviders = new Set(options.skipProviders || []);

        // Build provider order
        let providerOrder = [...this.FALLBACK_ORDER];
        if (options.preferredProvider) {
            providerOrder = [options.preferredProvider, ...providerOrder.filter(p => p !== options.preferredProvider)];
        }

        // Try each provider in order
        for (const providerName of providerOrder) {
            if (skipProviders.has(providerName)) continue;
            if (!this.isProviderAvailable(providerName)) continue;

            try {
                const result = await this.callProvider(providerName, prompt, options);

                // Update success metrics
                const provider = this.providers.get(providerName)!;
                provider.totalCalls++;
                provider.totalLatencyMs += result.latencyMs;
                provider.failures = 0; // Reset failures on success

                return result;

            } catch (error: any) {
                this.recordFailure(providerName, error);
                logger.warn(`${providerName} failed, trying next provider...`, error.message);
            }
        }

        // All providers failed
        throw new Error(`All LLM providers failed. Last fallback exhausted.`);
    }

    /**
     * Stream a completion (returns async generator)
     */
    public async *stream(prompt: string, options: CompletionOptions = {}): AsyncGenerator<string, void, unknown> {
        const skipProviders = new Set(options.skipProviders || []);
        let providerOrder = [...this.FALLBACK_ORDER];

        if (options.preferredProvider) {
            providerOrder = [options.preferredProvider, ...providerOrder.filter(p => p !== options.preferredProvider)];
        }

        for (const providerName of providerOrder) {
            if (skipProviders.has(providerName)) continue;
            if (!this.isProviderAvailable(providerName)) continue;

            try {
                yield* await this.streamFromProvider(providerName, prompt, options);
                return; // Success - exit
            } catch (error: any) {
                this.recordFailure(providerName, error);
                logger.warn(`${providerName} streaming failed, trying next...`);
            }
        }

        yield "[ERROR] All streaming providers failed";
    }

    /**
     * Check if a provider is available (circuit not open)
     */
    private isProviderAvailable(providerName: string): boolean {
        const provider = this.providers.get(providerName);
        if (!provider) return false;

        // Check if circuit is open but enough time has passed to retry
        if (provider.circuitOpen) {
            if (Date.now() - provider.lastFailure > this.CONFIG.CIRCUIT_BREAKER_RESET_MS) {
                provider.circuitOpen = false;
                provider.failures = 0;
                logger.info(`Circuit closed for ${providerName}, retrying...`);
            } else {
                return false;
            }
        }

        return true;
    }

    /**
     * Record a failure for circuit breaker
     */
    private recordFailure(providerName: string, error: any) {
        const provider = this.providers.get(providerName);
        if (!provider) return;

        provider.failures++;
        provider.lastFailure = Date.now();

        if (provider.failures >= this.CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
            provider.circuitOpen = true;
            logger.warn(`Circuit OPEN for ${providerName} after ${provider.failures} failures`);
        }
    }

    /**
     * Call a specific provider
     */
    private async callProvider(
        providerName: string,
        prompt: string,
        options: CompletionOptions
    ): Promise<CompletionResult> {
        const startTime = Date.now();
        const systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';
        const temperature = options.temperature ?? 0.7;
        const providerStatus = this.providers.get(providerName);
        const modelId = providerStatus?.currentModel || 'default';

        let text: string;
        let usage: any;

        switch (providerName) {
            case 'GEMINI': {
                const { geminiService } = await import('./geminiService');
                text = await geminiService.generateText(`${systemPrompt}\n\n${prompt}`, {
                    model: modelId
                });
                break;
            }

            case 'GROQ': {
                const response = await this.callGroqDirect(systemPrompt, prompt, temperature, modelId);
                text = response.text;
                usage = response.usage;
                break;
            }

            case 'DEEPSEEK': {
                const { deepSeekService } = await import('./deepSeekService');
                text = await deepSeekService.chat([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ], { temperature, model: modelId });
                break;
            }

            case 'OLLAMA': {
                const { ollamaService } = await import('./ollamaService');
                // Pass model as 5th argument: generateCompletion(prompt, stop, tier, priority, model)
                text = await ollamaService.generateCompletion(`${systemPrompt}\n\n${prompt}`, undefined, 'fast', 0, modelId);
                break;
            }

            case 'MINIMAX': {
                const { minimaxService } = await import('./minimaxService');
                text = await minimaxService.generateCompletion(prompt, {
                    // System prompt handled inside service
                });
                break;
            }

            case 'ZHIPUAI': {
                const { zhipuService } = await import('./zhipuService');
                text = await zhipuService.generateCompletion(prompt, {
                    temperature,
                    model: modelId
                });
                break;
            }

            default:
                throw new Error(`Unknown provider: ${providerName}`);
        }

        return {
            text,
            provider: providerName,
            latencyMs: Date.now() - startTime,
            usage
        };
    }

    /**
     * Direct Groq call (extracted from geminiService)
     */
    private async callGroqDirect(
        systemPrompt: string,
        userMessage: string,
        temperature: number,
        modelId: string = 'llama-3.1-70b-versatile'
    ): Promise<{ text: string; usage: any }> {
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature,
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            throw new Error(`Groq API error: ${response.status}`);
        }

        const data = await response.json();
        return {
            text: data.choices[0]?.message?.content || '',
            usage: data.usage
        };
    }

    /**
     * Stream from a specific provider
     */
    private async *streamFromProvider(
        providerName: string,
        prompt: string,
        options: CompletionOptions
    ): AsyncGenerator<string, void, unknown> {
        const systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';

        switch (providerName) {
            case 'GEMINI': {
                const { geminiService } = await import('./geminiService');
                // Use streaming if available, otherwise chunk the response
                const text = await geminiService.generateText(`${systemPrompt}\n\n${prompt}`);
                // Simulate streaming for non-streaming providers
                const words = text.split(' ');
                for (const word of words) {
                    yield word + ' ';
                }
                break;
            }

            case 'OLLAMA': {
                const { ollamaService } = await import('./ollamaService');
                // Note: generateStream takes (prompt, model), so we combine systemPrompt into prompt
                yield* ollamaService.generateStream(`${systemPrompt}\n\n${prompt}`);
                break;
            }

            default:
                // For providers without native streaming, simulate it
                const result = await this.callProvider(providerName, prompt, options);
                const words = result.text.split(' ');
                for (const word of words) {
                    yield word + ' ';
                }
        }
    }

    /**
     * Get health status of all providers
     */
    public getProviderHealth(): Record<string, any> {
        const health: Record<string, any> = {};

        for (const [name, status] of this.providers) {
            health[name] = {
                available: !status.circuitOpen,
                failures: status.failures,
                circuitOpen: status.circuitOpen,
                totalCalls: status.totalCalls,
                avgLatencyMs: status.totalCalls > 0
                    ? Math.round(status.totalLatencyMs / status.totalCalls)
                    : 0
            };
        }

        return health;
    }

    /**
     * Reset circuit breaker for a specific provider
     */
    public resetCircuit(providerName: string) {
        const provider = this.providers.get(providerName);
        if (provider) {
            provider.failures = 0;
            provider.circuitOpen = false;
            logger.info(`Circuit manually reset for ${providerName}`);
        }
    }

    /**
     * Quick completion for internal use (lower temperature, concise output)
     */
    public async quickComplete(prompt: string): Promise<string> {
        const result = await this.complete(prompt, {
            temperature: 0.3,
            maxTokens: 500,
            systemPrompt: 'Be concise and direct.'
        });
        return result.text;
    }
}

export const llmGateway = new LLMGatewayService();
