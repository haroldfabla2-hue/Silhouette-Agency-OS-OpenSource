
import { GenesisConfig } from '../types';
import { stockService } from './stockService';
import { DEFAULT_API_CONFIG, REPLICATE_CONFIG } from '../constants';
import { costEstimator } from './costEstimator';

// --- MEDIA CORTEX SERVICE ---
// Handles integration with SOTA Cloud APIs for media generation.

interface MediaGenerationRequest {
    prompt: string;
    type: 'IMAGE' | 'VOICE' | 'VIDEO';
    params?: any;
}

// Extend Config to include execution mode
type ExtendedMediaConfig = GenesisConfig['mediaConfig'] & { executionMode?: 'CLIENT' | 'SERVER' };

export class MediaService {
    private config: ExtendedMediaConfig;

    constructor(config: ExtendedMediaConfig) {
        this.config = config || { executionMode: 'CLIENT' };
        // Default to CLIENT if not specified, but we'll set SERVER in backend
        if (!this.config.executionMode) this.config.executionMode = 'CLIENT';
    }

    public updateConfig(newConfig: ExtendedMediaConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    // --- IMAGE GENERATION ---
    public async generateImage(prompt: string, style?: string): Promise<string> {
        // If style is specified, route through imageFactory which handles NanoBanana styles
        if (style && style !== 'none') {
            console.log(`[MEDIA] 🎨 Generating with style: ${style}`);
            const { imageFactory } = await import('./media/imageFactory');
            const asset = await imageFactory.createAsset({
                prompt,
                style: style as any, // ImageFactory will map this to NanoBanana style
                aspectRatio: '16:9',
                saveToLibrary: true
            });
            if (asset?.url) {
                return asset.localPath || asset.url;
            }
            console.warn('[MEDIA] imageFactory failed, falling back to legacy providers');
        }

        // GOD MODE: CLIENT DELEGATION
        if (this.config.executionMode === 'CLIENT') {
            try {
                const response = await fetch('/v1/media/generate-image', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
                    },
                    body: JSON.stringify({ prompt, style })
                });
                if (!response.ok) throw new Error("Media Proxy Failed");
                const data = await response.json();
                return data.url;
            } catch (e) {
                console.warn("[MEDIA] Proxy failed, falling back to local iteration (not recommended due to CORS)", e);
            }
        }

        console.log("[MEDIA] Generating Image. Config:", JSON.stringify(this.config, null, 2));
        const providers = ['OPENAI', 'REPLICATE', 'IMAGINEART', 'GEMINI'];
        let lastError = null;

        for (const provider of providers) {
            try {
                console.log(`[MEDIA] Attempting Provider: ${provider}`);
                if (provider === 'OPENAI' && this.config?.openaiKey) {
                    return await this.generateImageOpenAI(prompt);
                } else if (provider === 'REPLICATE' && this.config?.replicateKey) {
                    return await this.generateImageReplicate(prompt);
                } else if (provider === 'IMAGINEART' && this.config?.imagineArtKey) {
                    return await this.generateImageImagineArt(prompt);
                } else if (provider === 'GEMINI') {
                    // Placeholder
                    // return await this.generateImageGemini(prompt);
                } else {
                    console.log(`[MEDIA] Skipping ${provider} (No Key)`);
                }
            } catch (e: any) {
                console.warn(`[MEDIA] ${provider} Image Gen Failed:`, e.message);
                lastError = e;
            }
        }

        throw new Error(`All Image Generation Providers Failed. Last Error: ${lastError?.message}`);
    }

    private async generateImageOpenAI(prompt: string): Promise<string> {
        if (!this.config?.openaiKey) throw new Error("Missing OpenAI API Key");
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.openaiKey}`
            },
            body: JSON.stringify({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
                quality: "standard",
                response_format: "url"
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        // Track Cost
        costEstimator.trackEvent('dall-e-3', 1);

        return data.data[0].url;
    }

    private async generateImageReplicate(prompt: string): Promise<string> {
        // MODE CHECK: CLIENT vs SERVER
        if (this.config.executionMode === 'CLIENT') {
            const response = await fetch(`/v1/media/generate-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
                },
                body: JSON.stringify({
                    provider: 'REPLICATE',
                    prompt: prompt,
                    modelId: REPLICATE_CONFIG.models.primary
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Replicate Proxy Failed");
            }
            const data = await response.json();
            return data.url;
        }

        // SERVER SIDE LOGIC
        const apiKey = this.config?.replicateKey || REPLICATE_CONFIG.apiKey;
        if (!apiKey) throw new Error("Missing Replicate Key");

        const primaryModel = REPLICATE_CONFIG.models.primary;
        const fallbackModel = REPLICATE_CONFIG.models.fallback;

        try {
            console.log(`[MEDIA] Attempting Replicate Gen via ${primaryModel}...`);
            return await this.runReplicate(primaryModel, {
                prompt: prompt + ", high quality, 8k, photorealistic",
                width: 1024,
                height: 1024
            });
        } catch (e: any) {
            console.warn(`[MEDIA] Primary Model (${primaryModel}) failed, trying fallback (${fallbackModel})...`, e.message);

            try {
                // Fallback to Flux
                return await this.runReplicate(fallbackModel, {
                    prompt: prompt + ", photorealistic, 8k, highly detailed",
                    aspect_ratio: "1:1",
                    output_format: "jpg",
                    output_quality: 90
                });
            } catch (fallbackError: any) {
                throw new Error(`Replicate Generation Failed (Primary & Fallback). Last Error: ${fallbackError.message}`);
            }
        }
    }

    private async generateImageImagineArt(prompt: string): Promise<string> {
        // MODE CHECK: CLIENT vs SERVER
        if (this.config.executionMode === 'CLIENT') {
            const response = await fetch(`/v1/media/generate-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
                },
                body: JSON.stringify({
                    provider: 'IMAGINEART',
                    prompt: prompt
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "ImagineArt Proxy Failed");
            }
            const data = await response.json();
            return data.url;
        }

        // SERVER SIDE LOGIC
        if (!this.config?.imagineArtKey) throw new Error("Missing ImagineArt Key");
        const response = await fetch('https://api.imagineapi.dev/v1/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.imagineArtKey}`
            },
            body: JSON.stringify({
                prompt: prompt,
                style_id: 29 // Realistic
            })
        });

        if (!response.ok) throw new Error("ImagineArt Failed");
        const data = await response.json();

        // Track Cost
        costEstimator.trackEvent('imagine-art', 1);

        return data.data?.url || "";
    }

    // --- VOICE GENERATION ---
    public async generateSpeech(text: string, voiceId?: string): Promise<ArrayBuffer> {
        const providers = ['ELEVENLABS', 'OPENAI'];
        let lastError = null;

        for (const provider of providers) {
            try {
                if (provider === 'ELEVENLABS' && this.config?.elevenLabsKey) {
                    return await this.generateSpeechElevenLabs(text, voiceId);
                } else if (provider === 'OPENAI' && this.config?.openaiKey) {
                    return await this.generateSpeechOpenAI(text);
                }
            } catch (e: any) {
                console.warn(`[MEDIA] ${provider} Voice Gen Failed:`, e.message);
                lastError = e;
            }
        }
        throw new Error(`All Voice Generation Providers Failed. Last Error: ${lastError?.message}`);
    }

    private async generateSpeechOpenAI(text: string): Promise<ArrayBuffer> {
        if (!this.config?.openaiKey) throw new Error("Missing OpenAI API Key");
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.openaiKey}` },
            body: JSON.stringify({ model: "tts-1", input: text, voice: "alloy" })
        });
        if (!response.ok) throw new Error("OpenAI TTS Failed");

        // Track Cost (Approx chars)
        costEstimator.trackTransaction(text.length, 0, 'openai-tts');

        return await response.arrayBuffer();
    }

    private async generateSpeechElevenLabs(text: string, voiceId?: string): Promise<ArrayBuffer> {
        if (!this.config?.elevenLabsKey) throw new Error("Missing ElevenLabs API Key");
        const vId = voiceId || this.config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': this.config.elevenLabsKey },
            body: JSON.stringify({ text: text, model_id: "eleven_monolingual_v1", voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail?.message || "ElevenLabs Error");
        }

        // Track Cost (Approx chars)
        costEstimator.trackTransaction(text.length, 0, 'eleven-multilingual-v2');

        return await response.arrayBuffer();
    }
    // --- ASSET SCOUTING ---
    public async searchRealAssets(query: string): Promise<any[]> {
        return stockService.searchImages(query);
    }

    // --- CREATIVE DIRECTOR TOOLS ---

    public async enhanceImage(imageUrl: string, prompt: string, strength: number = 0.3): Promise<string> {
        if (!this.config?.replicateKey) throw new Error("Missing Replicate Key for Enhancement.");

        // Use a model good for upscaling/refining (e.g., Real-ESRGAN or just img2img with low strength)
        // Here we use the same NanoBanana model but with low strength to "polish" without changing too much.
        const modelId = this.config.nanoBananaModelId || "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b7159d55124d612";

        console.log(`[MEDIA] Enhancing Image via ${modelId}...`);

        const prediction = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${this.config.replicateKey}`
            },
            body: JSON.stringify({
                version: modelId.split(':')[1] || modelId,
                input: {
                    prompt: prompt + ", 4k, highly detailed, professional photography, studio lighting",
                    image: imageUrl,
                    strength: strength, // Low strength = subtle enhancement
                    num_inference_steps: 40,
                    guidance_scale: 7.5
                }
            })
        });

        const data = await prediction.json();
        if (data.error) throw new Error(data.error);

        // Poll for result
        let status = data.status;
        let output = null;
        while (status !== 'succeeded' && status !== 'failed') {
            await new Promise(r => setTimeout(r, 2000));
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
                headers: { 'Authorization': `Token ${this.config.replicateKey}` }
            });
            const pData = await poll.json();
            status = pData.status;
            if (status === 'succeeded') output = pData.output;
            else if (status === 'failed') throw new Error("Enhancement failed.");
        }

        // Track Cost
        costEstimator.trackEvent('sdxl', 1); // Using SDXL pricing for NanoBanana/Enhance
        return Array.isArray(output) ? output[0] : output;
    }

    public async generateComposite(baseImageUrl: string, prompt: string, options?: { strength?: number, guidance?: number, steps?: number }): Promise<string> {
        if (!this.config?.replicateKey) throw new Error("Missing Replicate Key for Composite.");

        // Use NanoBanana Pro (or similar img2img model)
        const modelId = this.config.nanoBananaModelId || "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b7159d55124d612";

        console.log(`[MEDIA] Generating Composite via ${modelId}...`);

        const prediction = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${this.config.replicateKey}`
            },
            body: JSON.stringify({
                version: modelId.split(':')[1] || modelId,
                input: {
                    prompt: prompt + ", high quality, 8k, photorealistic",
                    image: baseImageUrl,
                    strength: options?.strength || 0.75,
                    guidance_scale: options?.guidance || 7.5,
                    num_inference_steps: options?.steps || 30
                }
            })
        });

        const data = await prediction.json();
        if (data.error) throw new Error(data.error);

        // Poll for result
        let status = data.status;
        let output = null;
        while (status !== 'succeeded' && status !== 'failed') {
            await new Promise(r => setTimeout(r, 2000));
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
                headers: { 'Authorization': `Token ${this.config.replicateKey}` }
            });
            const pData = await poll.json();
            status = pData.status;
            if (status === 'succeeded') output = pData.output;
            else if (status === 'failed') throw new Error("Composite generation failed.");
        }

        // Track Cost
        costEstimator.trackEvent('sdxl', 1); // Using SDXL pricing for Composite
        return Array.isArray(output) ? output[0] : output;
    }

    // --- VIDEO GENERATION ---
    public async generateVideo(prompt: string, imageUrl?: string): Promise<{ url?: string, type: 'AI' | 'SYNTHETIC' | 'APPROVAL_REQUIRED' }> {

        // 0. Check for Advanced Models (Veo 3 / NanoBanana)
        const advancedModels = [
            { id: this.config?.veoModelId, name: 'Google Veo 3.1' },
            { id: this.config?.nanoBananaModelId, name: 'NanoBanana Pro' }
        ];

        for (const model of advancedModels) {
            if (model.id && this.config?.replicateKey) {
                try {
                    console.log(`[MEDIA] Attempting Video via ${model.name} (${model.id})...`);
                    const startResp = await fetch('https://api.replicate.com/v1/predictions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.config.replicateKey}`
                        },
                        body: JSON.stringify({
                            version: model.id, // Using the configured ID directly
                            input: {
                                prompt: prompt,
                                image: imageUrl, // Some models use 'image', some 'input_image'. We'll send both for compatibility if unsure, or just map it.
                                input_image: imageUrl,
                                video_length: "14_frames_with_svd_xt", // SVD param, might be ignored by others
                                frames_per_second: 24
                            }
                        })
                    });

                    const startData = await startResp.json();
                    if (startData.error) throw new Error(startData.error);

                    const predictionId = startData.id;
                    let status = startData.status;
                    let output = null;

                    while (status !== 'succeeded' && status !== 'failed') {
                        await new Promise(r => setTimeout(r, 2000));
                        const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                            headers: { 'Authorization': `Token ${this.config.replicateKey}` }
                        });
                        const pollData = await pollResp.json();
                        status = pollData.status;
                        if (status === 'succeeded') output = pollData.output;
                    }

                    if (output) {
                        // Track Cost (Video)
                        costEstimator.trackEvent(model.id.includes('veo') ? 'google-veo-3' : 'svd-xt', 2); // Est 2 seconds or 1 generation unit
                        return { url: output, type: 'AI' };
                    }

                } catch (e) {
                    console.warn(`[MEDIA] ${model.name} failed, trying next...`, e);
                }
            }
        }

        // 1. Try Replicate (Standard SVD)
        if (this.config?.replicateKey) {
            try {
                console.log("[MEDIA] Attempting AI Video Generation via Replicate (SVD)...");
                // Using Stable Video Diffusion (SVD)
                const startResp = await fetch('https://api.replicate.com/v1/predictions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.config.replicateKey}`
                    },
                    body: JSON.stringify({
                        version: "3f0457e4619daac51203dedb472816f3afc54423a976c6dd956972911b4278cc", // SVD
                        input: {
                            input_image: imageUrl, // SVD takes an image
                            video_length: "14_frames_with_svd_xt",
                            sizing_strategy: "maintain_aspect_ratio",
                            frames_per_second: 6,
                            motion_bucket_id: 127,
                            cond_aug: 0.02
                        }
                    })
                });

                const startData = await startResp.json();
                if (startData.error) throw new Error(startData.error);

                // Check for credit/billing errors specifically if possible, but generic error catch works too

                const predictionId = startData.id;
                let status = startData.status;
                let output = null;

                while (status !== 'succeeded' && status !== 'failed') {
                    await new Promise(r => setTimeout(r, 2000));
                    const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                        headers: { 'Authorization': `Token ${this.config.replicateKey}` }
                    });
                    const pollData = await pollResp.json();
                    status = pollData.status;
                    if (status === 'succeeded') output = pollData.output;
                }

                if (output) return { url: output, type: 'AI' };

            } catch (e) {
                console.warn("[MEDIA] Replicate Video failed, trying next provider:", e);
            }
        }

        // 2. Try Imagine Art (Fallback Tier)
        // 2. Try Imagine Art (Real Implementation)
        const imagineKey = this.config?.imagineArtKey || 'vk-ydnMcZW95FxGvP43jFB9ZDulKwta2oDIq1cIMz324PLin22Fc';

        if (imagineKey) {
            try {
                console.log("[MEDIA] Attempting Video via Imagine Art (Real)...");
                const iaResp = await fetch('https://api.imagineapi.dev/v1/video/generation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${imagineKey}`
                    },
                    body: JSON.stringify({
                        prompt: prompt,
                        style: "cinematic",
                        aspect_ratio: "16:9",
                        frames: 24
                    })
                });

                if (iaResp.ok) {
                    const iaData = await iaResp.json();
                    if (iaData.data?.url) {
                        costEstimator.trackEvent('imagine-art-video', 5);
                        return { url: iaData.data.url, type: 'AI' };
                    }
                } else {
                    const err = await iaResp.text();
                    console.warn("[MEDIA] Imagine Art Video Error:", err);
                }
            } catch (e) {
                console.warn("[MEDIA] Imagine Art Video failed, trying next...", e);
            }
        }

        // 3. Fallback: Request Approval for Synthetic Mode
        // We don't just auto-run it. We ask the user.
        return { type: 'APPROVAL_REQUIRED' };
    }
    // --- GOD MODE: REAL-HYBRID PIPELINE ---

    /**
     * Step 1: Generate Background using Flux.1 (SOTA Photorealism)
     * Optionally uses an 'anchorImage' (Unsplash) to guide the structure/composition.
     */
    public async generateBackgroundFlux(prompt: string, anchorImage?: string): Promise<string> {
        // CLIENT-SIDE PROXY: If running in browser, delegate to server to avoid CORS
        if (typeof window !== 'undefined') {
            const apiKey = localStorage.getItem('SILHOUETTE_API_KEY') || 'system-override';
            const response = await fetch('/v1/media/generate-background', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                },
                body: JSON.stringify({ prompt, anchorImage })
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.error || "Background Generation Failed");
            return data.url;
        }

        if (!this.config?.replicateKey) throw new Error("Missing Replicate Key for Flux.");

        // Flux.1 Dev (Black Forest Labs)
        const modelId = "black-forest-labs/flux-dev";
        console.log(`[MEDIA] Generating Background via Flux.1 (${anchorImage ? 'Img2Img' : 'Txt2Img'})...`);

        const input: any = {
            prompt: prompt + ", photorealistic, 8k, highly detailed, cinematic lighting",
            guidance: 3.5,
            aspect_ratio: "16:9",
            output_format: "jpg",
            output_quality: 90
        };

        if (anchorImage) {
            input.image = anchorImage;
            input.prompt_strength = 0.85;
        }

        const prediction = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${this.config.replicateKey}`
            },
            body: JSON.stringify({
                version: "117b6422977496c2055ca14838a1568230ac5ca8e325c5f6aa7277a2e66d2d8f", // Flux Dev Version Hash
                input: input
            })
        });

        const data = await prediction.json();
        if (data.error) throw new Error(data.error);

        // Poll
        let status = data.status;
        let output = null;
        while (status !== 'succeeded' && status !== 'failed') {
            await new Promise(r => setTimeout(r, 2000));
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
                headers: { 'Authorization': `Token ${this.config.replicateKey}` }
            });
            const pData = await poll.json();
            status = pData.status;
            if (status === 'succeeded') output = pData.output;
            else if (status === 'failed') throw new Error("Replicate Generation failed.");
        }

        return Array.isArray(output) ? output[0] : output;

        // Track Cost
        costEstimator.trackEvent('flux-dev', 1);

        return Array.isArray(output) ? output[0] : output;
    }

    private async runReplicate(version: string, input: any): Promise<any> {
        if (!this.config?.replicateKey) throw new Error("Missing Replicate Key");

        const prediction = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${this.config.replicateKey}`
            },
            body: JSON.stringify({
                version: version,
                input: input
            })
        });

        const data = await prediction.json();
        if (data.error) throw new Error(data.error);

        // Poll
        let status = data.status;
        let output = null;
        while (status !== 'succeeded' && status !== 'failed') {
            await new Promise(r => setTimeout(r, 2000));
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
                headers: { 'Authorization': `Token ${this.config.replicateKey}` }
            });
            const pData = await poll.json();
            status = pData.status;
            if (status === 'succeeded') output = pData.output;
            else if (status === 'failed') throw new Error("Replicate Generation failed.");
        }

        return output;
    }
    /**
     * Step 3: Relight using IC-Light (Consistent Lighting)
     * Takes the composite (Product on Flux Background) and harmonizes the lighting.
     */
    public async relightImageICLight(compositeImage: string, prompt: string): Promise<string> {
        if (!this.config?.replicateKey) throw new Error("Missing Replicate Key for IC-Light.");

        console.log(`[MEDIA] Relighting via IC-Light...`);

        const prediction = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${this.config.replicateKey}`
            },
            body: JSON.stringify({
                version: "9486553a9855d71a7e27627a7c9a53d207d6074501b6dae6d428636a39759fb9", // IC-Light Version Hash
                input: {
                    subject_image: compositeImage, // The composite image
                    prompt: prompt + ", cinematic lighting, soft shadows, high contrast",
                    // IC-Light specific params
                    image_width: 1024,
                    image_height: 1024,
                    steps: 25,
                    output_format: "png"
                }
            })
        });

        const data = await prediction.json();
        if (data.error) throw new Error(data.error);

        // Poll
        let status = data.status;
        let output = null;
        while (status !== 'succeeded' && status !== 'failed') {
            await new Promise(r => setTimeout(r, 2000));
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
                headers: { 'Authorization': `Token ${this.config.replicateKey}` }
            });
            const pData = await poll.json();
            status = pData.status;
            if (status === 'succeeded') output = pData.output;
            else if (status === 'failed') throw new Error("IC-Light Relighting failed.");
        }

        // Track Cost
        costEstimator.trackEvent('sdxl', 1); // Using SDXL pricing for IC-Light (approx)
        return Array.isArray(output) ? output[0] : output;
    }

    /**
     * Step 4: Upscale (Real-ESRGAN)
     * Upscales the final image to 4K.
     */
    public async upscaleImage(imageUrl: string, scale: number = 4): Promise<string> {
        if (!this.config?.replicateKey) throw new Error("Missing Replicate Key for Upscale.");
        console.log(`[MediaService] Upscaling image ${scale}x...`);

        // Replicate: real-esrgan (nightmareai)
        const output = await this.runReplicate("42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b", {
            image: imageUrl,
            scale: scale,
            face_enhance: true
        });


        // Track Cost
        costEstimator.trackEvent('replicate-upscaler', 1);

        return output as string;
    }

    /**
     * Orchestrator: Runs the full Real-Hybrid Pipeline
     */
    public async generateRealHybridComposite(
        productImage: string,
        anchorImage: string | undefined,
        prompt: string
    ): Promise<{ background: string, composite: string, relit: string }> {

        // 1. Generate Background (Flux)
        const background = await this.generateBackgroundFlux(prompt, anchorImage);

        // 2. Composite (NanoBanana)
        const composite = await this.generateComposite(background, `product placement: ${prompt}`, { strength: 0.6 });

        // 3. Relight (IC-Light)
        const relit = await this.relightImageICLight(composite, prompt);

        return { background, composite, relit };
    }

    /**
     * Generic Relight: Composites subject onto background then relights.
     */
    public async relightImage(subjectUrl: string, backgroundUrl: string, prompt: string): Promise<string> {
        // 1. Composite
        const composite = await this.generateComposite(backgroundUrl, `product placement: ${prompt}`, { strength: 0.6 });

        // 2. Relight
        const relit = await this.relightImageICLight(composite, prompt);

        return relit;
    }

}

export const mediaService = new MediaService({});
