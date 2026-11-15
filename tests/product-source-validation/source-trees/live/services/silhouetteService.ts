/**
 * SILHOUETTE Service
 * TypeScript bridge to the Silhouette Python inference API (port 8102).
 * Similar pattern to ttsService.ts for voice_engine.
 */

import axios, { AxiosInstance } from 'axios';

interface GenerateOptions {
    maxNewTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
}

interface GenerateResponse {
    text: string;
    tokens_generated: number;
}

interface HealthStatus {
    status: string;
    model_loaded: boolean;
    device: string;
}

class SilhouetteService {
    private client: AxiosInstance;
    private readonly endpoint: string;
    private isAvailable: boolean = false;
    private lastHealthCheck: number = 0;
    private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

    constructor() {
        this.endpoint = process.env.SILHOUETTE_API_URL || 'http://localhost:8102';
        this.client = axios.create({
            baseURL: this.endpoint,
            timeout: 60000, // 60s timeout for generation
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log(`[SILHOUETTE] Service initialized. Endpoint: ${this.endpoint}`);
    }

    /**
     * Check if the Silhouette API is available and model is loaded.
     */
    async health(): Promise<HealthStatus> {
        try {
            const response = await this.client.get('/health');
            this.isAvailable = response.data.model_loaded === true;
            this.lastHealthCheck = Date.now();
            return response.data;
        } catch (error) {
            this.isAvailable = false;
            console.error('[SILHOUETTE] Health check failed:', error instanceof Error ? error.message : error);
            return { status: 'unavailable', model_loaded: false, device: 'unknown' };
        }
    }

    /**
     * Check availability with caching to avoid excessive health checks.
     */
    async checkAvailability(): Promise<boolean> {
        const now = Date.now();
        if (now - this.lastHealthCheck > this.HEALTH_CHECK_INTERVAL) {
            await this.health();
        }
        return this.isAvailable;
    }

    /**
     * Generate text using the Silhouette model.
     */
    async generate(prompt: string, options?: GenerateOptions): Promise<string> {
        if (!await this.checkAvailability()) {
            throw new Error('[SILHOUETTE] Model not available. Ensure the Python API is running.');
        }

        try {
            const response = await this.client.post<GenerateResponse>('/generate', {
                prompt,
                max_new_tokens: options?.maxNewTokens ?? 256,
                temperature: options?.temperature ?? 0.7,
                top_p: options?.topP ?? 0.9,
                top_k: options?.topK ?? 50,
            });

            return response.data.text;
        } catch (error) {
            console.error('[SILHOUETTE] Generation failed:', error instanceof Error ? error.message : error);
            throw error;
        }
    }

    /**
     * Get text embedding using the model's JEPA head.
     * Useful for semantic similarity and retrieval tasks.
     */
    async getEmbedding(text: string): Promise<number[]> {
        if (!await this.checkAvailability()) {
            throw new Error('[SILHOUETTE] Model not available.');
        }

        try {
            const response = await this.client.post('/embedding', { text });
            return response.data.embedding;
        } catch (error) {
            console.error('[SILHOUETTE] Embedding failed:', error instanceof Error ? error.message : error);
            throw error;
        }
    }

    /**
     * Attempt to wake up the Silhouette API if it's sleeping.
     */
    async wake(): Promise<boolean> {
        try {
            const health = await this.health();
            return health.model_loaded;
        } catch {
            return false;
        }
    }
}

// Singleton instance
export const silhouetteService = new SilhouetteService();

// Export class for testing
export { SilhouetteService };
