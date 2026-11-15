
import { ComfyWorkflow } from '../../types';

export const ANIMATEDIFF_VID2VID_WORKFLOW: ComfyWorkflow = {
    "1": {
        "inputs": {
            "ckpt_name": "dreamshaper_8_pruned.safetensors"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": { "title": "Load Checkpoint" }
    },
    "2": {
        "inputs": { "vae_name": "taesd" },
        "class_type": "VAELoader",
        "_meta": { "title": "Load VAE" }
    },
    "3": {
        "inputs": {
            "text": "masterpiece, best quality, animated, motion, 4k",
            "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode",
        "_meta": { "title": "Positive Prompt" }
    },
    "4": {
        "inputs": {
            "text": "bad quality, worst quality, low res, static, watermark",
            "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode",
        "_meta": { "title": "Negative Prompt" }
    },
    "5": {
        "inputs": {
            "model_name": "animatediff_lightning_4step_comfyui.safetensors",
            "beta_schedule": "sqrt_linear (AnimateDiff)",
            "motion_scale": 1,
            "apply_v2_models_properly": true,
            "model": ["1", 0],
            "context_options": ["6", 0]
        },
        "class_type": "ADE_AnimateDiffLoaderGen1",
        "_meta": { "title": "AnimateDiff Loader" }
    },
    "6": {
        "inputs": {
            "context_length": 16,
            "context_stride": 1,
            "context_overlap": 4,
            "context_schedule": "uniform",
            "closed_loop": false,
            "fuse_method": "flat",
            "use_on_equal_length": false,
            "start_percent": 0,
            "guarantee_steps": 1
        },
        "class_type": "ADE_AnimateDiffUniformContextOptions",
        "_meta": { "title": "Context Options" }
    },
    "11": {
        "inputs": {
            "image": "example.png", // Will be replaced by injection
            "upload": "image"
        },
        "class_type": "LoadImage",
        "_meta": { "title": "Load Input Image (Source)" }
    },
    "12": {
        "inputs": {
            "pixels": ["11", 0],
            "vae": ["2", 0]
        },
        "class_type": "VAEEncode",
        "_meta": { "title": "VAE Encode" }
    },
    "13": {
        "inputs": {
            "control_net_name": "control_v11p_sd15_openpose.pth"
        },
        "class_type": "ControlNetLoader",
        "_meta": { "title": "Load ControlNet (OpenPose)" }
    },
    "14": {
        "inputs": {
            "strength": 0.8,
            "conditioning": ["3", 0],
            "control_net": ["13", 0],
            "image": ["11", 0]
        },
        "class_type": "ControlNetApply",
        "_meta": { "title": "Apply ControlNet" }
    },
    "7": {
        "inputs": {
            "seed": 0,
            "steps": 10,
            "cfg": 1.5,
            "sampler_name": "euler",
            "scheduler": "sgm_uniform",
            "denoise": 0.6, // Lower denoise for Vid2Vid to keep structure
            "model": ["5", 0],
            "positive": ["14", 0], // Connects to ControlNet Output
            "negative": ["4", 0],
            "latent_image": ["12", 0] // Connects to VAE Encode Output
        },
        "class_type": "KSampler",
        "_meta": { "title": "KSampler" }
    },
    "9": {
        "inputs": {
            "samples": ["7", 0],
            "vae": ["2", 0]
        },
        "class_type": "VAEDecode",
        "_meta": { "title": "VAE Decode" }
    },
    "10": {
        "inputs": {
            "filename_prefix": "AnimateDiff_Vid2Vid",
            "fps": 12,
            "lossless": false,
            "quality": 85,
            "method": "default",
            "images": ["9", 0]
        },
        "class_type": "SaveAnimatedWEBP",
        "_meta": { "title": "Save WebP" }
    }
};
