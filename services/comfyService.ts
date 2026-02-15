import axios from 'axios';
import path from 'path';
import { systemBus } from './systemBus';
import { SystemProtocol, ComfyWorkflow, ComfyNode } from '../types';
import { ANIMATEDIFF_LIGHTNING_WORKFLOW } from './workflows/animateDiffLightning';
import { SVD_WORKFLOW } from './workflows/svdWorkflow';
import { ANIMATEDIFF_VID2VID_WORKFLOW } from './workflows/animateDiffVid2Video'; // [Phase 7]
import * as fs from 'fs';

interface PromptResponse {
    prompt_id: string;
    number: number;
    node_errors: any;
}

export type VisualEngine = 'WAN' | 'ANIMATEDIFF' | 'SVD' | 'VID2VID';

export class ComfyService {
    private baseUrl = 'http://127.0.0.1:8188';
    private clientId = 'silhouette-agent-001';

    constructor() {
        // We could validate connection on startup
    }

    /**
     * Checks if ComfyUI is reachable
     */
    public async isAvailable(): Promise<boolean> {
        try {
            await axios.get(`${this.baseUrl}/system_stats`);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Queues a workflow for execution
     */
    public async queuePrompt(workflow: ComfyWorkflow): Promise<string> {
        try {
            const response = await axios.post<PromptResponse>(`${this.baseUrl}/prompt`, {
                prompt: workflow,
                client_id: this.clientId
            });

            if (response.data.node_errors && Object.keys(response.data.node_errors).length > 0) {
                console.error("❌ ComfyUI Node Errors:", JSON.stringify(response.data.node_errors, null, 2));
                throw new Error("Workflow validation failed in ComfyUI.");
            }

            return response.data.prompt_id;
        } catch (error: any) {
            if (error.response) {
                console.error("❌ ComfyUI API Error:", JSON.stringify(error.response.data, null, 2));
            } else {
                console.error("❌ Failed to queue prompt:", error.message);
            }
            throw error;
        }
    }

    /**
     * Generates a video using the Wan model via ComfyUI
     * @param prompt Text prompt for the video
     * @returns Path to the generated video (relative to output) or null
     */
    private async injectInputAsset(sourcePath: string): Promise<string> {
        // 1. Resolve ComfyUI Input Directory
        const comfyInputRoot = path.resolve(process.cwd(), 'ComfyUI/ComfyUI/input');

        // 2. Generate Unique Filename for ComfyUI
        const ext = path.extname(sourcePath);
        const filename = `injected_${Date.now()}_${path.basename(sourcePath)}`;
        const targetPath = path.join(comfyInputRoot, filename);

        // 3. Copy file (Robust Local Injection)
        await fs.promises.copyFile(sourcePath, targetPath);
        console.log(`[ComfyService] 💉 Asset injected to Input: ${filename}`);

        return filename;
    }

    public async generateVideo(promptOrPath: string, engine: VisualEngine = 'WAN', inputAsset?: string): Promise<string> {
        if (!await this.isAvailable()) {
            throw new Error("Visual Cortex (ComfyUI) is offline.");
        }

        console.log(`[ComfyService] 🎨 Generando visual con Motor: ${engine}`);

        let workflow: ComfyWorkflow;
        let promptId: string;

        // [Phase 7] Robust Engine Switching
        if (engine === 'ANIMATEDIFF') {
            console.log(`[ComfyService] 📝 Prompt: "${promptOrPath}"`);
            workflow = this.getAnimateDiffWorkflow(promptOrPath);
        } else if (engine === 'SVD') {
            const asset = inputAsset || promptOrPath; // Support passing asset in 3rd arg or 1st arg
            console.log(`[ComfyService] 🖼️ Input Image (SVD): "${asset}"`);
            const injectedFilename = await this.injectInputAsset(asset);
            workflow = this.getSvdWorkflow(injectedFilename);
        } else if (engine === 'VID2VID') {
            // "Wason" Pipeline
            const asset = inputAsset || promptOrPath;
            console.log(`[ComfyService] 📹 Input Asset (Vid2Vid): "${asset}"`);
            const injectedFilename = await this.injectInputAsset(asset);
            workflow = this.getVid2VidWorkflow(injectedFilename, "Transform this video, high quality, 4k");
        } else {
            console.log(`[ComfyService] 📝 Prompt: "${promptOrPath}"`);
            workflow = this.getWanWorkflow(promptOrPath);
        }

        // 2. Queue the job
        promptId = await this.queuePrompt(workflow);
        console.log(`[ComfyService] ⏳ Job Queued: ${promptId}`);

        // 3. Poll for completion
        return await this.waitForResult(promptId);
    }

    private getAnimateDiffWorkflow(userPrompt: string): ComfyWorkflow {
        // Deep clone to avoid mutating the const
        const workflow = JSON.parse(JSON.stringify(ANIMATEDIFF_LIGHTNING_WORKFLOW));

        // Inject user prompt
        workflow["3"].inputs.text = userPrompt;

        // Optional: We could inject negative prompts or seeds here
        workflow["7"].inputs.seed = Math.floor(Math.random() * 1000000000);

        return workflow;
    }

    private getSvdWorkflow(filename: string): ComfyWorkflow {
        const workflow = JSON.parse(JSON.stringify(SVD_WORKFLOW));

        // Dynamic Seed
        workflow["3"].inputs.seed = Math.floor(Math.random() * 1000000000);

        // Inject Input Image Filename (ComfyUI looks in 'input' folder by default)
        workflow["14"].inputs.image = filename;

        return workflow;
    }

    private getVid2VidWorkflow(filename: string, prompt: string): ComfyWorkflow {
        const workflow = JSON.parse(JSON.stringify(ANIMATEDIFF_VID2VID_WORKFLOW));

        // 1. Inject Asset
        workflow["11"].inputs.image = filename;

        // 2. Inject Prompt
        workflow["3"].inputs.text = prompt;

        // 3. Randomize Seed
        workflow["7"].inputs.seed = Math.floor(Math.random() * 1000000000);

        return workflow;
    }

    /**
     * Polls history until the prompt is done
     */
    private async waitForResult(promptId: string): Promise<string> {
        // RTX 3050 takes ~10-15 mins for Wan 2.1. 
        // Polling every 1s. Timeout = 20 mins (1200s).
        let attempts = 0;
        const maxAttempts = 1200; // 20 minutes (Wan is slower)

        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const historyRes = await axios.get(`${this.baseUrl}/history/${promptId}`);
                const history = historyRes.data[promptId];

                // Debug log every 5 seconds
                if (attempts % 5 === 0) {
                    process.stdout.write('.'); // Compact keep-alive
                }

                if (history?.status?.completed) {
                    console.log("\n[ComfyService] ✅ Job Completed in ComfyUI.");
                    // Success! Found output
                    const outputs = history.outputs;

                    // Log outputs for debugging
                    console.log("Outputs detected:", JSON.stringify(outputs, null, 2));

                    // Iterate to find 'gifs' or 'images' or 'videos'
                    for (const nodeId of Object.keys(outputs)) {
                        const nodeOutput = outputs[nodeId];
                        // Check for images (GIFs/WebP count as images in Comfy API usually) or videos
                        const files = nodeOutput.images || nodeOutput.gifs || nodeOutput.videos;

                        if (files && files.length > 0) {
                            const filename = files[0].filename;
                            const subfolder = files[0].subfolder;

                            // ComfyUI default output dir
                            // Fix: Use process.cwd() instead of __dirname to avoid ESM issues
                            const comfyOutputRoot = path.resolve(process.cwd(), 'ComfyUI/ComfyUI/output');

                            // Handle subfolders if ComfyUI is configured to use them (e.g. by date)
                            const sourcePath = subfolder
                                ? path.join(comfyOutputRoot, subfolder, filename)
                                : path.join(comfyOutputRoot, filename);

                            // Validate existence before moving to avoid uncaught errors
                            try {
                                await import('fs/promises').then(fs => fs.access(sourcePath));
                            } catch (e) {
                                console.warn(`\n[ComfyService] ⚠️ File reported by API not found on disk: ${sourcePath}`);
                                continue; // Skip to next output if valid
                            }

                            // 2. Organize via MediaManager
                            const { mediaManager } = await import('./mediaManager');

                            // Determine MediaType
                            const ext = path.extname(filename).toLowerCase();
                            let mediaType: 'video' | 'image' = 'image';
                            if (['.mp4', '.mov', '.gif', '.webp'].includes(ext)) mediaType = 'video';

                            const organizedPath = await mediaManager.organizeAsset(sourcePath, mediaType, `job_${promptId}`);
                            console.log(`[ComfyService] ✅ Asset organized: ${organizedPath}`);
                            return organizedPath;
                        }
                    }

                    // ROBUSTNESS: If we reach here, the job is marked 'completed' but no recognizable file was found.
                    // We must NOT continue polling, as the status will not change. We must fail to allow upstream handling.
                    console.error("[ComfyService] ❌ Job completed but no usable output (images/gifs/videos) was found.");
                    console.debug("Full History Object:", JSON.stringify(history, null, 2));
                    throw new Error("ComfyUI completed workflow but produced no detectable output files.");
                }
            } catch (e: any) {
                // Critical errors must break the loop
                if (e.message && (e.message.includes("ComfyUI completed") || e.message.includes("Asset organized"))) {
                    throw e;
                }
                // Log other errors for debugging (don't silence them)
                console.warn("[ComfyService] ⚠️ Polling Warning:", e.message);
                if (e.response) {
                    // Check for 404s or other API issues
                    console.warn("API Status:", e.response.status);
                }
            }
            attempts++;
        }
        throw new Error("Video generation timed out.");
    }

    private getWanWorkflow(userPrompt: string): ComfyWorkflow {
        // Workflow calibrated from user manual test (Wan 2.1 T2V)
        return {
            "3": {
                "inputs": {
                    "seed": Math.floor(Math.random() * 1000000000000000),
                    "steps": 30,
                    "cfg": 6.0,
                    "sampler_name": "uni_pc",
                    "scheduler": "simple",
                    "denoise": 1.0,
                    "model": ["37", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["40", 0]
                },
                "class_type": "KSampler",
                "_meta": {
                    "title": "KSampler"
                }
            },
            "6": {
                "inputs": {
                    "text": userPrompt,
                    "clip": ["38", 0]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {
                    "title": "CLIP Text Encode (Positive Prompt)"
                }
            },
            "7": {
                "inputs": {
                    "text": "Overexposure, static, blurred details, subtitles, paintings, pictures, still, overall gray, worst quality, low quality, JPEG compression residue, ugly, mutilated, redundant fingers, poorly painted hands, poorly painted faces, deformed, disfigured, deformed limbs, fused fingers, cluttered background, three legs, a lot of people in the background, upside down",
                    "clip": ["38", 0]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {
                    "title": "CLIP Text Encode (Negative Prompt)"
                }
            },
            "8": {
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["39", 0]
                },
                "class_type": "VAEDecode",
                "_meta": {
                    "title": "VAEDecode"
                }
            },
            "28": {
                "inputs": {
                    "filename_prefix": "ComfyUI",
                    "fps": 16,
                    "lossless": false,
                    "quality": 90,
                    "method": "default",
                    "images": ["8", 0]
                },
                "class_type": "SaveAnimatedWEBP",
                "_meta": {
                    "title": "SaveAnimatedWEBP"
                }
            },
            "37": {
                "inputs": {
                    "unet_name": "wan2.1_t2v_1.3B_bf16.safetensors",
                    "weight_dtype": "default"
                },
                "class_type": "UNETLoader",
                "_meta": {
                    "title": "UNETLoader"
                }
            },
            "38": {
                "inputs": {
                    "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                    "type": "wan",
                    "device": "default"
                },
                "class_type": "CLIPLoader",
                "_meta": {
                    "title": "CLIPLoader"
                }
            },
            "39": {
                "inputs": {
                    "vae_name": "wan_2.1_vae.safetensors"
                },
                "class_type": "VAELoader",
                "_meta": {
                    "title": "VAELoader"
                }
            },
            "40": {
                "inputs": {
                    "width": 832,
                    "height": 480,
                    "length": 33,
                    "batch_size": 1
                },
                "class_type": "EmptyHunyuanLatentVideo",
                "_meta": {
                    "title": "EmptyHunyuanLatentVideo"
                }
            }
        };
    }
}

export const comfyService = new ComfyService();
