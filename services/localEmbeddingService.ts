import { pipeline, env } from '@xenova/transformers';

// Suppress local file warnings in production
env.localModelPath = './models';
env.allowRemoteModels = true; // Auto-download model on first run

class LocalEmbeddingService {
    private isReady: boolean = false;
    private extractor: any = null;
    private initPromise: Promise<void> | null = null;

    constructor() {
        // Under the test runner, do NOT start the model download at import
        // time: a pending download when the worker closes fails the whole
        // suite ("Closing rpc while fetch was pending"). getEmbedding()
        // lazily initializes in every environment; production keeps the
        // boot warm-up.
        if (!process.env.VITEST) {
            this.initPromise = this.init();
        }
    }

    private async init() {
        try {
            console.log('[LOCAL_EMBED] 🔄 Initializing all-MiniLM-L6-v2 Transformer...');
            // Load the feature extraction pipeline
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            this.isReady = true;
            console.log('[LOCAL_EMBED] ✅ Local Embedding Model ready (384-dims).');
        } catch (error: any) {
            console.error('[LOCAL_EMBED] ❌ Initialization failed:', error.message);
        }
    }

    public async getEmbedding(text: string): Promise<number[] | null> {
        if (!this.initPromise) this.initPromise = this.init();
        if (!this.isReady) {
            await this.initPromise;
        }

        if (!this.extractor) {
            console.warn('[LOCAL_EMBED] ⚠️ Extractor not initialized. Embedding skipped.');
            return null;
        }

        try {
            // Predict the embedding
            const output = await this.extractor(text, { pooling: 'mean', normalize: true });

            // Output is usually a tensor. We extract the data array.
            const embeddingArray = Array.from(output.data);
            return embeddingArray as number[];
        } catch (error: any) {
            console.error('[LOCAL_EMBED] ❌ Generation failed:', error.message);
            return null;
        }
    }
}

export const localEmbeddingService = new LocalEmbeddingService();
