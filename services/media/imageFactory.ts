/**
 * ImageFactory - Quality-First Image Generation Pipeline
 * 
 * Strategy:
 * 1. Cloud FIRST (Replicate → OpenAI) for maximum quality
 * 2. Local fallback (DreamShaper 8) when cloud fails OR preferLocal=true
 * 3. All images saved locally to uploads/image/
 * 4. Auto-register in AssetLibrary for @mentions and video integration
 */

import { nanoBanana, ImageStyle } from './nanoBananaService';
import { stockService } from './stockService';
import { providerHealth } from '../providerHealthManager';
import { mediaManager } from '../mediaManager';
import { getDreamShaperWorkflow } from '../workflows/dreamShaperWorkflow';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ImageGenerationRequest {
    prompt: string;
    style: 'PHOTOREALISTIC' | 'ILLUSTRATION' | 'ICON' | 'VECTOR' | 'STOCK_PHOTO';
    aspectRatio?: '1:1' | '16:9' | '9:16';
    negativePrompt?: string;
    count?: number;
    preferLocal?: boolean;      // User explicitly wants free/local mode
    saveToLibrary?: boolean;    // Auto-register as asset for @mentions
}

export interface ImageAsset {
    id: string;
    url: string;              // Remote URL (if cloud)
    localPath?: string;       // Local path (always saved)
    provider: string;
    prompt: string;
    metadata: any;
    timestamp: number;
}

export class ImageFactory {

    constructor() { }

    /**
     * Quality-First Image Generation with Local Fallback
     */
    public async createAsset(request: ImageGenerationRequest): Promise<ImageAsset | null> {
        console.log(`[ImageFactory] 🏭 Processing: ${request.style} - "${request.prompt.substring(0, 50)}..."`);
        console.log(`[ImageFactory] Mode: ${request.preferLocal ? 'LOCAL PREFERRED' : 'CLOUD FIRST'}`);
        const start = Date.now();

        // Stock photos - no generation needed
        if (request.style === 'STOCK_PHOTO') {
            return this.handleStockPhoto(request, start);
        }

        let result: ImageAsset | null = null;

        // === USER PREFERS LOCAL (Free Mode) ===
        if (request.preferLocal) {
            result = await this.attemptLocalGeneration(request, start);
            if (result) return this.finalizeAsset(result, request);

            // If local fails, still try cloud as fallback
            console.log('[ImageFactory] ⚠️ Local preferred but failed, trying cloud...');
        }

        // === CLOUD FIRST (Quality Priority) ===
        if (!request.preferLocal) {
            // Tier 1: Replicate (NanoBanana/FLUX)
            result = await this.attemptReplicate(request, start);
            if (result) return this.finalizeAsset(result, request);

            // Tier 2: OpenAI (DALL-E 3)
            result = await this.attemptOpenAI(request, start);
            if (result) return this.finalizeAsset(result, request);

            // Tier 3: Local Fallback
            console.log('[ImageFactory] ⚠️ Cloud providers failed, falling back to local...');
            result = await this.attemptLocalGeneration(request, start);
            if (result) return this.finalizeAsset(result, request);
        }

        console.error('[ImageFactory] ❌ All providers failed');
        return null;
    }

    /**
     * Attempt cloud generation via Replicate
     */
    private async attemptReplicate(request: ImageGenerationRequest, start: number): Promise<ImageAsset | null> {
        if (!providerHealth.isAvailable('replicate-image')) {
            console.log('[ImageFactory] ⏭️ Skipping Replicate (Circuit Breaker: Suspended)');
            return null;
        }

        try {
            console.log('[ImageFactory] 🌐 Attempting Replicate (NanoBanana Pro)...');

            // Map factory style to NanoBanana style for better prompts
            const nbStyle = this.mapToNanoBananaStyle(request.style);

            const url = await nanoBanana.generateImage(request.prompt, request.aspectRatio, nbStyle);
            if (url) {
                providerHealth.reportSuccess('replicate-image');
                return this.createAssetObject(url, 'REPLICATE_NANO_BANANA_PRO', request, start);
            }
        } catch (e: any) {
            console.warn('[ImageFactory] ⚠️ Replicate failed:', e.message);
            if (e.message?.includes('402') || e.message?.includes('quota') || e.message?.includes('credit')) {
                providerHealth.reportFailure('replicate-image', e.message);
            }
        }
        return null;
    }

    /**
     * Map factory style to NanoBanana style for enhanced prompts
     */
    private mapToNanoBananaStyle(factoryStyle: string): ImageStyle | undefined {
        const styleMap: Record<string, ImageStyle> = {
            'PHOTOREALISTIC': 'PHOTOREALISTIC',
            'ILLUSTRATION': 'ILLUSTRATION',
            'ICON': 'ILLUSTRATION',
            'VECTOR': 'ILLUSTRATION',
            'TECHNICAL': 'TECHNICAL',
            'BLUEPRINT': 'BLUEPRINT',
            'RENDER_3D': 'RENDER_3D',
            'EXPLODED': 'EXPLODED',
            'INFOGRAPHIC': 'INFOGRAPHIC'
        };
        return styleMap[factoryStyle];
    }

    /**
     * Attempt cloud generation via OpenAI
     */
    private async attemptOpenAI(request: ImageGenerationRequest, start: number): Promise<ImageAsset | null> {
        if (!providerHealth.isAvailable('openai-image')) {
            console.log('[ImageFactory] ⏭️ Skipping OpenAI (Circuit Breaker: Suspended)');
            return null;
        }

        try {
            console.log('[ImageFactory] 💳 Attempting OpenAI (DALL-E 3)...');
            const url = await this.generateWithOpenAI(request.prompt);
            if (url) {
                providerHealth.reportSuccess('openai-image');
                return this.createAssetObject(url, 'OPENAI_DALLE3', request, start);
            }
        } catch (e: any) {
            console.warn('[ImageFactory] ⚠️ OpenAI failed:', e.message);
            if (e.message?.includes('429') || e.message?.includes('quota') || e.message?.includes('billing')) {
                providerHealth.reportFailure('openai-image', e.message);
            }
        }
        return null;
    }

    /**
     * Attempt local generation via ComfyUI DreamShaper
     */
    private async attemptLocalGeneration(request: ImageGenerationRequest, start: number): Promise<ImageAsset | null> {
        // Check VRAM availability
        const { resourceManager } = await import('../resourceManager');
        const vramOwner = resourceManager.getCurrentOwner();

        if (vramOwner === 'VIDEO') {
            console.log('[ImageFactory] ⏭️ Skipping Local (VRAM reserved for video)');
            return null;
        }

        if (!providerHealth.isAvailable('comfyui-image')) {
            console.log('[ImageFactory] ⏭️ Skipping ComfyUI (Circuit Breaker: Suspended)');
            return null;
        }

        try {
            console.log('[ImageFactory] 🏠 Attempting Local ComfyUI (DreamShaper 8)...');
            const localPath = await this.generateWithComfyUI(request);
            if (localPath) {
                providerHealth.reportSuccess('comfyui-image');
                return {
                    id: crypto.randomUUID(),
                    url: `file://${localPath}`,
                    localPath: localPath,
                    provider: 'LOCAL_COMFYUI_DREAMSHAPER',
                    prompt: request.prompt,
                    metadata: {
                        style: request.style,
                        aspectRatio: request.aspectRatio,
                        latency: Date.now() - start,
                        free: true
                    },
                    timestamp: Date.now()
                };
            }
        } catch (e: any) {
            console.warn('[ImageFactory] ⚠️ ComfyUI failed:', e.message);
            if (!e.message?.includes('offline')) {
                providerHealth.reportFailure('comfyui-image', e.message);
            }
        }
        return null;
    }

    /**
     * Generate image using local ComfyUI DreamShaper 8
     */
    private async generateWithComfyUI(request: ImageGenerationRequest): Promise<string | null> {
        const { comfyService } = await import('../comfyService');

        if (!await comfyService.isAvailable()) {
            throw new Error('ComfyUI is offline');
        }

        // Build workflow
        const workflow = getDreamShaperWorkflow(
            request.prompt,
            request.aspectRatio,
            request.negativePrompt
        );

        // Queue and wait
        console.log('[ImageFactory] 📡 Queuing DreamShaper job...');
        const promptId = await comfyService.queuePrompt(workflow);

        // Poll for result (images are much faster than video)
        return await this.waitForComfyResult(promptId);
    }

    /**
     * Wait for ComfyUI image result
     */
    private async waitForComfyResult(promptId: string): Promise<string | null> {
        const { default: axios } = await import('axios');
        const maxAttempts = 120; // 2 minutes max for image

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1000));

            try {
                const res = await axios.get(`http://127.0.0.1:8188/history/${promptId}`);
                const history = res.data[promptId];

                if (history?.status?.completed) {
                    const outputs = history.outputs;
                    for (const nodeId of Object.keys(outputs)) {
                        const images = outputs[nodeId]?.images;
                        if (images?.length > 0) {
                            const filename = images[0].filename;
                            const subfolder = images[0].subfolder || '';
                            const comfyOutputRoot = path.resolve(process.cwd(), 'ComfyUI/ComfyUI/output');
                            const sourcePath = subfolder
                                ? path.join(comfyOutputRoot, subfolder, filename)
                                : path.join(comfyOutputRoot, filename);

                            // Organize to uploads folder
                            const organized = await mediaManager.organizeAsset(sourcePath, 'image', `dreamshaper_${promptId.slice(0, 8)}`);
                            return path.resolve(process.cwd(), organized);
                        }
                    }
                }
            } catch (e) {
                // Continue polling
            }
        }
        throw new Error('ComfyUI image generation timed out');
    }

    /**
     * Generate with OpenAI DALL-E 3
     */
    private async generateWithOpenAI(prompt: string): Promise<string | null> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt: prompt,
                n: 1,
                size: '1024x1024',
                quality: 'standard',
                response_format: 'url'
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.data?.[0]?.url || null;
    }

    /**
     * Handle stock photo requests
     */
    private async handleStockPhoto(request: ImageGenerationRequest, start: number): Promise<ImageAsset | null> {
        try {
            const url = await stockService.searchPhoto(
                request.prompt,
                this.mapAspectToOrientation(request.aspectRatio)
            );
            if (url) {
                const asset = this.createAssetObject(url, 'UNSPLASH', request, start);
                return this.finalizeAsset(asset, request);
            }
        } catch (e: any) {
            console.warn('[ImageFactory] Stock photo failed:', e.message);
        }
        return null;
    }

    /**
     * Finalize asset: save locally and register in library
     */
    private async finalizeAsset(asset: ImageAsset, request: ImageGenerationRequest): Promise<ImageAsset> {
        // Download and save cloud images locally
        if (!asset.localPath && asset.url.startsWith('http')) {
            try {
                asset.localPath = await this.downloadAndSave(asset.url, asset.id);
                console.log(`[ImageFactory] 💾 Saved locally: ${asset.localPath}`);
            } catch (e: any) {
                console.warn('[ImageFactory] Failed to save locally:', e.message);
            }
        }

        // === ALWAYS register in AssetCatalog (unified catalog) ===
        if (asset.localPath) {
            try {
                const { assetCatalog } = await import('../assetCatalog');
                await assetCatalog.register({
                    type: 'image',
                    name: `img_${asset.id.slice(0, 8)}`,
                    filePath: asset.localPath,
                    description: request.prompt?.slice(0, 200),
                    prompt: request.prompt,
                    provider: asset.provider,
                    tags: [request.style.toLowerCase(), asset.provider.toLowerCase()],
                    metadata: {
                        aspectRatio: request.aspectRatio,
                        style: request.style,
                        latency: asset.metadata?.latency
                    }
                });
                console.log('[ImageFactory] 📦 Registered in AssetCatalog');
            } catch (e: any) {
                console.warn('[ImageFactory] Failed to register in catalog:', e.message);
            }
        }

        // Register in AssetLibrary if explicitly requested (for @mentions)
        if (request.saveToLibrary && asset.localPath) {
            try {
                const { assetLibrary } = await import('../assets/assetLibrary');
                await assetLibrary.createAsset({
                    name: `img_${asset.id.slice(0, 8)}`,
                    role: 'prop',
                    description: request.prompt,
                    referenceImages: [asset.localPath],
                    tags: [request.style.toLowerCase(), asset.provider.toLowerCase()]
                });
                console.log('[ImageFactory] 📚 Registered in AssetLibrary (for @mentions)');
            } catch (e: any) {
                console.warn('[ImageFactory] Failed to register in library:', e.message);
            }
        }

        return asset;
    }

    /**
     * Download remote image and save locally
     */
    private async downloadAndSave(url: string, id: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to download image');

        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = url.includes('.png') ? '.png' : '.jpg';
        const today = new Date().toISOString().split('T')[0];
        const dir = path.join(process.cwd(), 'uploads', 'image', today);

        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `cloud_${id.slice(0, 8)}${ext}`);
        await fs.writeFile(filePath, buffer);

        return filePath;
    }

    private createAssetObject(url: string, provider: string, request: ImageGenerationRequest, start: number): ImageAsset {
        return {
            id: crypto.randomUUID(),
            url: url,
            provider: provider,
            prompt: request.prompt,
            metadata: {
                style: request.style,
                aspectRatio: request.aspectRatio,
                latency: Date.now() - start
            },
            timestamp: Date.now()
        };
    }

    private mapAspectToOrientation(aspect?: string): 'landscape' | 'portrait' | 'squarish' {
        if (aspect === '9:16') return 'portrait';
        if (aspect === '1:1') return 'squarish';
        return 'landscape';
    }

    /**
     * Get provider health for UI
     */
    public getProviderHealth(): Record<string, { available: boolean; backoffMs: number }> {
        return {
            'comfyui-image': {
                available: providerHealth.isAvailable('comfyui-image'),
                backoffMs: providerHealth.getBackoffTime('comfyui-image')
            },
            'replicate-image': {
                available: providerHealth.isAvailable('replicate-image'),
                backoffMs: providerHealth.getBackoffTime('replicate-image')
            },
            'openai-image': {
                available: providerHealth.isAvailable('openai-image'),
                backoffMs: providerHealth.getBackoffTime('openai-image')
            }
        };
    }
}

export const imageFactory = new ImageFactory();
