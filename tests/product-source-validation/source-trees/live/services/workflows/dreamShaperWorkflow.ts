/**
 * DreamShaper 8 Workflow for ComfyUI
 * Optimized for RTX 3050 (4GB VRAM)
 * Resolution: 512x512 (fits comfortably in VRAM)
 */

import { ComfyWorkflow } from '../../types';

export const DREAMSHAPER_WORKFLOW: ComfyWorkflow = {
    "3": {
        "inputs": {
            "seed": 0, // Will be randomized
            "steps": 20,
            "cfg": 7.0,
            "sampler_name": "euler_ancestral",
            "scheduler": "normal",
            "denoise": 1.0,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0]
        },
        "class_type": "KSampler",
        "_meta": { "title": "KSampler" }
    },
    "4": {
        "inputs": {
            "ckpt_name": "dreamshaper_8_pruned.safetensors"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": { "title": "Load Checkpoint" }
    },
    "5": {
        "inputs": {
            "width": 512,
            "height": 512,
            "batch_size": 1
        },
        "class_type": "EmptyLatentImage",
        "_meta": { "title": "Empty Latent Image" }
    },
    "6": {
        "inputs": {
            "text": "", // Positive prompt - will be injected
            "clip": ["4", 1]
        },
        "class_type": "CLIPTextEncode",
        "_meta": { "title": "CLIP Text Encode (Positive)" }
    },
    "7": {
        "inputs": {
            "text": "ugly, blurry, low quality, distorted, deformed, watermark, text, signature, cropped",
            "clip": ["4", 1]
        },
        "class_type": "CLIPTextEncode",
        "_meta": { "title": "CLIP Text Encode (Negative)" }
    },
    "8": {
        "inputs": {
            "samples": ["3", 0],
            "vae": ["4", 2]
        },
        "class_type": "VAEDecode",
        "_meta": { "title": "VAE Decode" }
    },
    "9": {
        "inputs": {
            "filename_prefix": "silhouette_img",
            "images": ["8", 0]
        },
        "class_type": "SaveImage",
        "_meta": { "title": "Save Image" }
    }
};

/**
 * Returns a configured DreamShaper workflow with user prompt
 */
export function getDreamShaperWorkflow(
    prompt: string,
    aspectRatio?: string,
    negativePrompt?: string
): ComfyWorkflow {
    const workflow = JSON.parse(JSON.stringify(DREAMSHAPER_WORKFLOW));

    // Inject prompt
    workflow["6"].inputs.text = prompt + ", high quality, detailed, professional";

    // Inject negative prompt if provided
    if (negativePrompt) {
        workflow["7"].inputs.text = negativePrompt;
    }

    // Randomize seed
    workflow["3"].inputs.seed = Math.floor(Math.random() * 1000000000);

    // Adjust resolution for aspect ratio (staying within 4GB VRAM limits)
    if (aspectRatio === '16:9') {
        workflow["5"].inputs.width = 640;
        workflow["5"].inputs.height = 360;
    } else if (aspectRatio === '9:16') {
        workflow["5"].inputs.width = 360;
        workflow["5"].inputs.height = 640;
    }
    // Default 1:1 stays at 512x512

    return workflow;
}
