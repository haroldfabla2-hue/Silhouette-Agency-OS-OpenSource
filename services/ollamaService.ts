import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Ollama } from 'ollama';
import { REDIS_CONFIG } from '../constants';
import Redis from 'ioredis';
import { resourceArbiter } from './resourceArbiter'; // [PA-036]

// --- TYPES ---
interface OllamaJobData {
    type: 'generate' | 'embedding';
    payload: any;
}

interface OllamaJobResult {
    success: boolean;
    data?: any;
    error?: string;
}

// --- CIRCUIT BREAKER CONFIG ---
const CB_THRESHOLD = 3;
const CB_TIMEOUT_MS = 30000; // 30 seconds cooldown

export class OllamaService {
    private ollama: Ollama;
    private queue: Queue;
    private worker: Worker;
    private queueEvents: QueueEvents;

    // Circuit Breaker State
    private failureCount = 0;
    private lastFailureTime = 0;
    private isCircuitOpen = false;

    private readonly QUEUE_NAME = 'ollama-execution-queue';
    public serviceName = "Ollama Native Brain";

    constructor() {
        // 1. Initialize Official Client
        this.ollama = new Ollama({ host: 'http://localhost:11434' });

        // 2. Initialize Redis Connection for BullMQ
        // We create a dedicated connection for the Queue to avoid blocking shared clients
        const redisOptions = {
            host: REDIS_CONFIG.host,
            port: REDIS_CONFIG.port,
            password: REDIS_CONFIG.password,
            maxRetriesPerRequest: null // Required by BullMQ
        };

        // 3. Initialize Queue
        this.queue = new Queue(this.QUEUE_NAME, {
            connection: new Redis(redisOptions)
        });

        // 4. Initialize QueueEvents (Required for waitUntilFinished)
        this.queueEvents = new QueueEvents(this.QUEUE_NAME, {
            connection: new Redis(redisOptions)
        });

        // 5. Initialize Worker (The Gridlock Solver)
        // Concurrency: 1 ensures SERIAL execution. No conflicting GPU calls.
        this.worker = new Worker(this.QUEUE_NAME, async (job: Job) => {
            return await this.processJob(job);
        }, {
            connection: new Redis(redisOptions),
            concurrency: 1
        });

        // Worker Event Listeners
        this.worker.on('failed', (job, err) => {
            console.error(`[Ollama] Job ${job?.id} failed:`, err);
            this.handleFailure();
        });

        this.worker.on('completed', (job) => {
            // console.log(`[Ollama] Job ${job.id} completed.`);
            this.handleSuccess();
        });
    }

    async initialize(): Promise<void> {
        if (await this.checkStatus()) {
            console.log("🟢 Ollama Native Brain is ONLINE (Buffered & Robust).");
        } else {
            console.warn("⚠️ Ollama is unreachable. queued requests will wait or fail.");
        }
    }

    async checkStatus(): Promise<boolean> {
        if (this.isCircuitOpen) return false;
        try {
            await this.ollama.list(); // Simple ping
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Circuit Breaker Logic
     */
    private handleFailure() {
        this.failureCount++;
        if (this.failureCount >= CB_THRESHOLD) {
            this.isCircuitOpen = true;
            this.lastFailureTime = Date.now();
            console.error(`[Ollama] 🔴 CIRCUIT BREAKER OPENED. Pausing requests for ${CB_TIMEOUT_MS}ms.`);
        }
    }

    private handleSuccess() {
        if (this.failureCount > 0) {
            this.failureCount = 0;
            if (this.isCircuitOpen) {
                console.log(`[Ollama] 🟢 CIRCUIT BREAKER CLOSED. Resuming operations.`);
                this.isCircuitOpen = false;
            }
        }
    }

    private checkCircuit(): boolean {
        if (this.isCircuitOpen) {
            if (Date.now() - this.lastFailureTime > CB_TIMEOUT_MS) {
                // Half-open: Try one request
                console.log(`[Ollama] 🟡 Circuit Half-Open. Testing connection...`);
                return true; // Allow attempt
            }
            return false; // Reject
        }
        return true;
    }

    /**
     * The Processor: Logic executed by the Worker
     */


    private async processJob(job: Job): Promise<OllamaJobResult> {
        if (!this.checkCircuit()) {
            throw new Error("Ollama Circuit Breaker is OPEN. Service unavailable.");
        }

        // [PA-036] INTELLIGENT RESOURCE CHECK
        const metrics = await resourceArbiter.getRealMetrics();
        const vramUsage = metrics.vramUsed / metrics.vramTotal;

        // If VRAM is critical (>92%) and we are not in a retry loop (simplified)
        if (vramUsage > 0.92) {
            console.warn(`[Ollama] 🛑 GPU Saturated (${(vramUsage * 100).toFixed(1)}%). Rejecting job to protect system.`);
            throw new Error("GPU_SATURATION_PROTECTION"); // Will trigger retry strategies
        }

        const { type, payload } = job.data as OllamaJobData;

        try {
            let result;
            if (type === 'generate') {
                // Typed Payload for Generate
                const { prompt, stop, max_tokens, model } = payload;
                const response = await this.ollama.generate({
                    model: model || 'mamba_native',
                    prompt: prompt,
                    stream: false, // We use BullMQ, so streaming is harder. Batch mode for now.
                    options: {
                        stop: stop,
                        num_predict: max_tokens || 500,
                        temperature: 0.7,
                        top_p: 0.9,
                        num_gpu: 99, // [OPTIMIZATION] Force GPU offloading
                        num_ctx: 2048 // [OPTIMIZATION] Limit context to save RAM
                    }
                });
                result = response.response;

            } else if (type === 'embedding') {
                const { text, model } = payload;
                const response = await this.ollama.embeddings({
                    model: model || 'nomic-embed-text',
                    prompt: text
                });
                result = response.embedding;
            }

            return { success: true, data: result };

        } catch (error: any) {
            console.error(`[Ollama Worker] Error processing ${type}:`, error.message);
            throw error; // Will trigger 'failed' event
        }
    }

    /**
     * Public API: Enqueues a generation request
     * @param tier 'fast' (GLM-4 Light), 'smart' (GLM-4 Light), or 'legacy' (GLM-4 Light fallback)
     * NOTE: All tiers now unified to GLM-4 Light for VRAM efficiency.
     *       Silhouette model will handle AGI tasks when trained.
     * @param priority BullMQ priority (lower = higher priority). 0 = highest (chat), 100 = low (background tasks)
     */
    async generateCompletion(
        prompt: string,
        stopSequences: string[] = ["User:", "System:"],
        tier: 'fast' | 'smart' | 'legacy' = 'fast',
        priority: number = 0,
        model: string = 'glm4:light'
    ): Promise<string> {
        // [MODIFIED] Support dynamic model selection, defaulting to GLM-4 Light
        const modelToUse = model || 'glm4:light';

        const job = await this.queue.add('generate', {
            type: 'generate',
            payload: {
                prompt,
                stop: stopSequences,
                model: modelToUse
            }
        }, {
            priority: priority  // BullMQ: lower number = higher priority
        });

        // Wait for the job to finish
        const result = await job.waitUntilFinished(this.queueEvents);
        return result.data;
    }

    /**
     * Public API: Enqueues an embedding request
     */
    async generateEmbedding(text: string): Promise<number[]> {
        const job = await this.queue.add('embedding', {
            type: 'embedding',
            payload: {
                text,
                model: 'nomic-embed-text'
            }
        });

        const result = await job.waitUntilFinished(this.queueEvents);
        return result.data;
    }

    /**
     * Public API: Checks if Ollama is reachable
     */
    async isAvailable(): Promise<boolean> {
        return await this.checkStatus();
    }

    /**
     * Public API: Fast, simple generation without complex stop sequences
     */
    async generateSimpleResponse(prompt: string): Promise<string> {
        return await this.generateCompletion(prompt, [], 'fast'); // Default to Fast tier
    }
    /**
     * Public API: Direct Streaming for Chat Fallback (Bypasses Queue for Latency)
     */
    async * generateStream(prompt: string, model: string = 'glm4:light'): AsyncGenerator<string, void, unknown> {
        if (!this.checkCircuit()) {
            yield " [Ollama Circuit Open - Local Brain Offline]";
            return;
        }

        try {
            const stream = await this.ollama.generate({
                model: model,
                prompt: prompt,
                stream: true,
                options: { temperature: 0.7 }
            });

            for await (const chunk of stream) {
                yield chunk.response;
            }

            this.handleSuccess();
        } catch (error: any) {
            this.handleFailure();
            console.error("[Ollama Stream Error]", error);
            yield " [Local Brain Error]";
        }
    }

    /**
     * Public API: Chat Streaming (Messages Array) - Best for Context Retention
     */
    async * generateChatStream(messages: { role: string, content: string }[], model: string = 'glm4:light'): AsyncGenerator<string, void, unknown> {
        if (!this.checkCircuit()) {
            yield " [Ollama Circuit Open - Local Brain Offline]";
            return;
        }

        try {
            const stream = await this.ollama.chat({
                model: model,
                messages: messages,
                stream: true,
                options: { temperature: 0.7 }
            });

            for await (const chunk of stream) {
                yield chunk.message.content;
            }

            this.handleSuccess();
        } catch (error: any) {
            this.handleFailure();
            console.error("[Ollama Chat Error]", error);
            yield " [Local Brain Error]";
        }
    }
    /**
     * Public API: Forcefully unload a model from VRAM
     */
    async unloadModel(modelName: string): Promise<boolean> {
        try {
            console.log(`[Ollama] 📉 Unloading model: ${modelName}`);
            // Sending an empty request with keep_alive: 0 forces immediate unload
            await this.ollama.generate({
                model: modelName,
                prompt: '',
                keep_alive: 0
            });
            return true;
        } catch (error) {
            console.warn(`[Ollama] Failed to unload ${modelName}:`, error);
            return false;
        }
    }
}

export const ollamaService = new OllamaService();
