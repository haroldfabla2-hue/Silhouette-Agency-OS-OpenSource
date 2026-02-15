/**
 * ZhipuAI Service V8.0 - True Concurrent (9 slots)
 * 
 * Changes from V7:
 * - PARALLEL PROCESSING: 3 concurrent per key × 3 keys = 9 total
 * - PER-KEY TRACKING: Each key tracks its own active connections
 * - LEAST CONNECTIONS: Distributes load to least busy key
 * - BACKPRESSURE: Limits queue size, bypasses at threshold
 * - NO GLOBAL COOLDOWN: Removed 3s cooldown for true parallelism
 */

type KeyPurpose = 'narration' | 'agents' | 'overflow';

interface ZhipuMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

// Full ZhipuAI response structure (handles all formats)
interface ZhipuResponse {
    choices: Array<{
        index: number;
        finish_reason: string;
        message: {
            role: string;
            content: string | null;
            // Reasoning content (GLM's internal thinking - often in Chinese)
            reasoning_content?: string;
            // Tool calls (when z.ai uses function calling)
            tool_calls?: Array<{
                id: string;
                type: string;
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
            // Refusal (when z.ai refuses to respond)
            refusal?: string;
        };
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    // Web search results (when z.ai uses web search)
    web_search?: Array<{
        icon: string;
        title: string;
        link: string;
        media: string;
        content: string;
    }>;
}

interface KeyStatus {
    key: string;
    purpose: KeyPurpose;
    activeConnections: number;  // Current active requests on this key
    totalCalls: number;
    successCount: number;
    failures: number;
    suspendedUntil: number;     // Key-level suspension
    // Per-key token bucket
    tokens: number;             // Available tokens for this key
    lastTokenRefill: number;    // Last time tokens were refilled
}

class ZhipuService {
    private keys: KeyStatus[] = [];
    private apiBase: string;
    private lastRequestTime: number = 0;  // For rate limiting
    private roundRobinIndex: number = 0;  // For distributing load evenly

    // Configuration
    private readonly CONFIG = {
        MAX_CONCURRENT_PER_KEY: 1,  // [USER-REQUEST] Strict concurrency of 1 per key

        // GLOBAL IP-based throttle (z.ai limits by IP, not just by key)
        MIN_REQUEST_INTERVAL: 1000,   // Reduced based on 1 concurrent (can go faster if single thread)

        // Per-key token bucket
        TOKENS_PER_KEY: 4,
        TOKEN_REFILL_INTERVAL: 15000,

        // Backoff for rate limits (per key)
        BACKOFF_FIRST: 5000,
        BACKOFF_SECOND: 20000,
        BACKOFF_THIRD: 60000,
        FAILURE_WINDOW_MS: 60000,

        // Token limits (output)
        DEFAULT_MAX_TOKENS: 512,

        // Backpressure
        QUEUE_MAX_SIZE: 10,         // Reduced queue for single concurrency
        QUEUE_SOFT_LIMIT: 5,
        QUEUE_HARD_LIMIT: 8,
        QUEUE_TIMEOUT_MS: 30000,
    };

    private requestQueue: Array<{
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        model: string;
        messages: ZhipuMessage[];
        options: { maxTokens?: number; temperature?: number };
        purpose: KeyPurpose;
    }> = [];

    constructor() {
        const keysString = process.env.ZHIPU_API_KEYS || process.env.ZHIPU_API_KEY || '';
        this.apiBase = process.env.ZHIPU_API_BASE || 'https://open.bigmodel.cn/api/paas/v4';

        const keyList = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
        const purposes: KeyPurpose[] = ['narration', 'agents', 'overflow', 'overflow', 'overflow'];

        if (keyList.length > 0) {
            this.keys = keyList.map((key, index) => ({
                key,
                purpose: purposes[index] || 'overflow',
                activeConnections: 0,
                totalCalls: 0,
                successCount: 0,
                failures: 0,
                suspendedUntil: 0,
                tokens: 4,
                lastTokenRefill: Date.now()
            }));

            const totalConcurrent = this.keys.length * this.CONFIG.MAX_CONCURRENT_PER_KEY;
            console.log(`[ZHIPU] ✅ ZhipuAI Service V9.2 - Single Concurrency Mode`);
            console.log(`[ZHIPU] 📊 Capacity: ${totalConcurrent} concurrent (1 per key)`);
            this.keys.forEach((k, i) => {
                console.log(`[ZHIPU]    Key #${i + 1}: ${k.purpose.toUpperCase()} (${k.key.substring(0, 8)}...)`);
            });
            console.log(`[ZHIPU] 🆓 Model: glm-4-flash (FREE)`);
        } else {
            console.warn('[ZHIPU] ⚠️ No ZHIPU_API_KEYS configured');
        }
    }

    /**
     * Get total active connections across all keys
     */
    private getTotalActiveConnections(): number {
        return this.keys.reduce((sum, k) => sum + k.activeConnections, 0);
    }

    /**
     * Get total concurrent capacity
     */
    private getTotalCapacity(): number {
        return this.keys.length * this.CONFIG.MAX_CONCURRENT_PER_KEY;
    }

    /**
     * ROBUST CONTENT EXTRACTION
     * Handles all z.ai response formats:
     * 1. Direct content in message.content
     * 2. Tool calls with arguments
     * 3. Web search results
     * 4. Refusal messages
     * 5. Full response fallback
     */
    private extractContent(data: ZhipuResponse): string | null {
        const choice = data.choices?.[0];
        if (!choice) return null;

        const message = choice.message;

        // 1. Direct content (most common)
        if (message.content && typeof message.content === 'string' && message.content.trim()) {
            return message.content;
        }

        // 2. Tool calls - extract arguments as content
        if (message.tool_calls && message.tool_calls.length > 0) {
            const toolResults = message.tool_calls.map(tc => {
                try {
                    // Try to parse arguments as JSON
                    const args = JSON.parse(tc.function.arguments);
                    return JSON.stringify(args);
                } catch {
                    return tc.function.arguments;
                }
            });
            console.log(`[ZHIPU] 🔧 Extracted ${message.tool_calls.length} tool call(s)`);
            return toolResults.join('\n');
        }

        // 3. Web search results - extract content
        if (data.web_search && data.web_search.length > 0) {
            const searchContent = data.web_search.map(ws => ws.content).filter(Boolean).join('\n\n');
            if (searchContent) {
                console.log(`[ZHIPU] 🔍 Extracted web search results (${data.web_search.length} items)`);
                return searchContent;
            }
        }

        // 4. Refusal message
        if (message.refusal) {
            console.log(`[ZHIPU] 🚫 Model refused: ${message.refusal}`);
            return `[REFUSAL] ${message.refusal}`;
        }

        // 5. Reasoning content (GLM's internal thinking in Chinese)
        // This happens when model spends all tokens on reasoning without generating content
        // DO NOT return reasoning_content as output - it pollutes the response with Chinese
        // Instead, log it and return null to trigger fallback
        if (message.reasoning_content && message.reasoning_content.trim()) {
            console.log(`[ZHIPU] 🧠 Model used reasoning_content (${message.reasoning_content.length} chars in Chinese) but no actual output`);
            console.log(`[ZHIPU] ⚠️ Treating as empty response - will fallback to another provider`);
            return null;  // Trigger fallback
        }

        // 6. Empty content but finished - this is a real empty response
        if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
            console.log(`[ZHIPU] ⚠️ Truly empty response with finish_reason: ${choice.finish_reason}`);
            return null;  // Trigger fallback instead of returning empty
        }

        return null;
    }

    /**
     * Refill tokens for a key based on elapsed time
     */
    private refillKeyTokens(key: KeyStatus): void {
        const now = Date.now();
        const elapsed = now - key.lastTokenRefill;
        const tokensToAdd = Math.floor(elapsed / this.CONFIG.TOKEN_REFILL_INTERVAL);

        if (tokensToAdd > 0) {
            key.tokens = Math.min(this.CONFIG.TOKENS_PER_KEY, key.tokens + tokensToAdd);
            key.lastTokenRefill = now - (elapsed % this.CONFIG.TOKEN_REFILL_INTERVAL);
        }
    }

    /**
     * Find best available key using Per-Key Tokens + Least Connections + Round Robin
     */
    private findBestKey(): KeyStatus | null {
        const now = Date.now();

        // Refill tokens for all keys
        this.keys.forEach(k => this.refillKeyTokens(k));

        // Filter available keys (not suspended, not at max capacity, HAS TOKENS)
        const availableKeys = this.keys.filter(k =>
            k.suspendedUntil <= now &&
            k.activeConnections < this.CONFIG.MAX_CONCURRENT_PER_KEY &&
            k.tokens > 0  // Must have tokens available
        );

        if (availableKeys.length === 0) return null;

        // Find minimum connections among keys with tokens
        const minConnections = Math.min(...availableKeys.map(k => k.activeConnections));

        // Get all keys with minimum connections
        const candidateKeys = availableKeys.filter(k => k.activeConnections === minConnections);

        // Round-robin among candidates with equal connections
        this.roundRobinIndex = (this.roundRobinIndex + 1) % candidateKeys.length;
        const selectedKey = candidateKeys[this.roundRobinIndex];

        // Consume one token from selected key
        selectedKey.tokens--;

        return selectedKey;
    }

    /**
     * Check if service has capacity
     */
    public isAvailable(purpose: KeyPurpose = 'agents'): boolean {
        return this.findBestKey() !== null;
    }

    /**
     * Generate text completion - parallel execution
     */
    public async generateCompletion(
        prompt: string,
        options: { maxTokens?: number; temperature?: number; model?: string } = {},
        purpose: KeyPurpose = 'agents'
    ): Promise<string> {
        const model = options.model || 'glm-4-flash'; // [USER-REQUEST] Use Free Flash Model
        const maxTokens = options.maxTokens || this.CONFIG.DEFAULT_MAX_TOKENS;

        // [USER-REQUEST] Enforce Spanish Output
        const messages: ZhipuMessage[] = [
            { role: 'system', content: 'Responde siempre en ESPAÑOL. Aunque la pregunta sea en otro idioma, tu salida debe ser en español. No uses caracteres chinos ni reasoning content visible.' },
            { role: 'user', content: prompt }
        ];

        return this.executeOrQueue(model, messages, { ...options, maxTokens }, purpose);
    }

    /**
     * Generate multimodal completion
     */
    public async generateMultimodalCompletion(
        textPrompt: string,
        imageUrls: string[],
        options: { maxTokens?: number; temperature?: number } = {},
        purpose: KeyPurpose = 'agents'
    ): Promise<string> {
        // [USER-REQUEST] Visual tasks must use Gemini. Zhipu vision disabled.
        throw new Error("Zhipu Vision DISABLED. Please use Gemini for visual tasks.");
    }

    /**
     * Execute immediately if capacity available, otherwise queue
     */
    private async executeOrQueue(
        model: string,
        messages: ZhipuMessage[],
        options: { maxTokens?: number; temperature?: number },
        purpose: KeyPurpose
    ): Promise<string> {
        // Import congestion manager for queue tracking (backpressure signals)
        const { congestionManager } = await import('./congestionManager');

        // Update queue size for backpressure tracking
        congestionManager.updateQueueSize(1);

        try {
            // Backpressure: hard limit (but never lose request, just warn)
            if (this.requestQueue.length >= this.CONFIG.QUEUE_HARD_LIMIT) {
                console.warn(`[ZHIPU] 🚨 Queue overflow (${this.requestQueue.length}). Processing anyway.`);
            }

            // =========================================================
            // GLOBAL IP-BASED THROTTLE: z.ai rate limits by IP, not key
            // Must WAIT between requests regardless of which key we use
            // =========================================================
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            if (timeSinceLastRequest < this.CONFIG.MIN_REQUEST_INTERVAL) {
                const waitTime = this.CONFIG.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
                console.log(`[ZHIPU] ⏳ Global throttle: waiting ${(waitTime / 1000).toFixed(1)}s before request...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            this.lastRequestTime = Date.now();

            // Try to execute with key rotation on rate limit
            const maxRetries = this.keys.length; // Try ALL keys before giving up
            let lastError: Error | null = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const key = this.findBestKey();
                if (!key) {
                    // All keys exhausted (no tokens or all suspended)
                    console.log(`[ZHIPU] ⏳ No keys available. Waiting ${this.CONFIG.MIN_REQUEST_INTERVAL / 1000}s for cooldown...`);
                    await new Promise(resolve => setTimeout(resolve, this.CONFIG.MIN_REQUEST_INTERVAL));
                    break;
                }

                try {
                    return await this.executeRequest(key, model, messages, options);
                } catch (error: any) {
                    lastError = error;
                    // If rate limited, wait FULL THROTTLE INTERVAL then try another key
                    if (error.message.includes('Rate limited')) {
                        console.log(`[ZHIPU] 🔄 Key rate limited, waiting ${this.CONFIG.MIN_REQUEST_INTERVAL / 1000}s before retry... (attempt ${attempt + 1}/${maxRetries})`);
                        // Wait FULL global throttle interval between retries
                        await new Promise(resolve => setTimeout(resolve, this.CONFIG.MIN_REQUEST_INTERVAL));
                        this.lastRequestTime = Date.now(); // Update throttle timer
                        continue;
                    }
                    // For other errors, don't retry
                    throw error;
                }
            }

            // If all retry attempts failed, queue or throw
            if (lastError?.message.includes('Rate limited')) {
                // All tried keys were rate limited
                console.warn(`[ZHIPU] ⚠️ All ${maxRetries} keys rate limited. Queueing request.`);
            }

            // If no key available, queue with warning
            if (this.requestQueue.length >= this.CONFIG.QUEUE_SOFT_LIMIT) {
                console.warn(`[ZHIPU] 📊 Queue pressure: ${this.requestQueue.length}/${this.CONFIG.QUEUE_MAX_SIZE}`);
            }

            // Queue for later
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    const idx = this.requestQueue.findIndex(r => r.resolve === wrappedResolve);
                    if (idx !== -1) {
                        this.requestQueue.splice(idx, 1);
                        console.warn(`[ZHIPU] ⏰ Request timeout after ${this.CONFIG.QUEUE_TIMEOUT_MS / 1000}s`);
                        reject(new Error('Queue timeout - use fallback'));
                    }
                }, this.CONFIG.QUEUE_TIMEOUT_MS);

                const wrappedResolve = (value: string) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                };
                const wrappedReject = (error: Error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                };

                this.requestQueue.push({
                    resolve: wrappedResolve,
                    reject: wrappedReject,
                    model,
                    messages,
                    options,
                    purpose
                });
            });
        } finally {
            // Decrement queue size on completion
            const { congestionManager } = await import('./congestionManager');
            congestionManager.updateQueueSize(-1);
        }
    }
    /**
     * Execute request on specific key
     */
    private async executeRequest(
        keyStatus: KeyStatus,
        model: string,
        messages: ZhipuMessage[],
        options: { maxTokens?: number; temperature?: number }
    ): Promise<string> {
        const maxTokens = options.maxTokens || this.CONFIG.DEFAULT_MAX_TOKENS;
        const temperature = options.temperature || 0.7;
        const keyIndex = this.keys.indexOf(keyStatus) + 1;

        // Increment active connections
        keyStatus.activeConnections++;
        keyStatus.totalCalls++;

        const activeTotal = this.getTotalActiveConnections();
        const capacity = this.getTotalCapacity();
        console.log(`[ZHIPU] 🔑 Key #${keyIndex} (${keyStatus.purpose}) → ${model} [${activeTotal}/${capacity} active]`);

        try {
            const response = await fetch(`${this.apiBase}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${keyStatus.key}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: maxTokens,
                    temperature,
                    stream: false,
                    // DISABLE Deep Thinking Mode - prevents Chinese reasoning_content
                    // Without this, GLM spends tokens on internal Chinese thoughts
                    // and returns empty content
                    thinking: {
                        type: 'disabled'
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorDetails = '';

                try {
                    const errorJson = JSON.parse(errorText);
                    errorDetails = errorJson.error?.message || errorJson.message || errorText;
                } catch {
                    errorDetails = errorText;
                }

                if (response.status === 429) {
                    keyStatus.failures++;
                    const backoff = this.getBackoffDuration(keyStatus.failures);
                    keyStatus.suspendedUntil = Date.now() + backoff;
                    console.warn(`[ZHIPU] ⚠️ Key #${keyIndex} rate limited. Suspended ${backoff / 1000}s`);
                    throw new Error(`Rate limited: ${errorDetails}`);
                }

                throw new Error(`API error ${response.status}: ${errorDetails}`);
            }

            const data: ZhipuResponse = await response.json();

            if (!data.choices || data.choices.length === 0) {
                throw new Error('No choices in response');
            }

            // Success - reset failures
            keyStatus.failures = 0;
            keyStatus.successCount++;

            if (data.usage) {
                try {
                    const { costEstimator } = await import('./costEstimator');
                    costEstimator.trackTransaction(
                        data.usage.prompt_tokens || 0,
                        data.usage.completion_tokens || 0,
                        model
                    );
                } catch (e) { }
                console.log(`[ZHIPU] ✅ ${model} | Tokens: ${data.usage.total_tokens} | Key #${keyIndex}`);
            }

            // =========================================================
            // ROBUST CONTENT EXTRACTION: Handle all z.ai response formats
            // =========================================================
            const content = this.extractContent(data);
            console.log(`[ZHIPU] 📤 Response content: ${content ? content.substring(0, 50) + '...' : 'NULL/EMPTY'}`);

            if (!content) {
                // Log full response for debugging
                console.warn(`[ZHIPU] ⚠️ Empty content. Full response:`, JSON.stringify(data, null, 2).substring(0, 500));
                throw new Error('Empty response from z.ai');
            }

            return content;

        } catch (error: any) {
            if (!error.message.includes('Rate limited')) {
                console.warn(`[ZHIPU] ❌ Key #${keyIndex} error: ${error.message}`);
            }
            throw error;
        } finally {
            // Decrement active connections
            keyStatus.activeConnections--;

            // Process queued requests
            this.processQueue();
        }
    }

    /**
     * Get backoff duration based on failure count
     */
    private getBackoffDuration(failures: number): number {
        if (failures >= 3) return this.CONFIG.BACKOFF_THIRD;
        if (failures >= 2) return this.CONFIG.BACKOFF_SECOND;
        return this.CONFIG.BACKOFF_FIRST;
    }

    /**
     * Process queued requests when capacity becomes available
     */
    private processQueue(): void {
        while (this.requestQueue.length > 0) {
            const key = this.findBestKey();
            if (!key) break;  // No capacity available

            const request = this.requestQueue.shift()!;
            this.executeRequest(key, request.model, request.messages, request.options)
                .then(request.resolve)
                .catch(request.reject);
        }
    }

    /**
     * Get service status
     */
    public getStatus(): {
        available: boolean;
        totalCapacity: number;
        activeConnections: number;
        queueLength: number;
        keyStats: Array<{ index: number; purpose: string; active: number; max: number; suspended: boolean }>
    } {
        const now = Date.now();
        return {
            available: this.isAvailable(),
            totalCapacity: this.getTotalCapacity(),
            activeConnections: this.getTotalActiveConnections(),
            queueLength: this.requestQueue.length,
            keyStats: this.keys.map((k, i) => ({
                index: i + 1,
                purpose: k.purpose,
                active: k.activeConnections,
                max: this.CONFIG.MAX_CONCURRENT_PER_KEY,
                suspended: k.suspendedUntil > now
            }))
        };
    }
}

export const zhipuService = new ZhipuService();
