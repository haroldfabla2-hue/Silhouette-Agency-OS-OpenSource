
import { ComfyWorkflow } from '../../types';

export const ANIMATEDIFF_LIGHTNING_WORKFLOW: ComfyWorkflow = {
    "1": {
        "inputs": {
            "ckpt_name": "dreamshaper_8_pruned.safetensors"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": {
            "title": "Load Checkpoint (DreamShaper)"
        }
    },
    "2": {
        "inputs": {
            "vae_name": "taesd"
        },
        "class_type": "VAELoader",
        "_meta": {
            "title": "Load VAE"
        }
    },
    "3": {
        "inputs": {
            "text": "masterpiece, best quality, animated, motion, 4k", // Placeholder
            "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
            "title": "Positive Prompt"
        }
    },
    "4": {
        "inputs": {
            "text": "bad quality, worst quality, low res, static, watermark",
            "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
            "title": "Negative Prompt"
        }
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
        "_meta": {
            "title": "AnimateDiff Loader"
        }
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
        "_meta": {
            "title": "Context Options"
        }
    },
    "7": {
        "inputs": {
            "seed": 0, // Will be randomized
            "steps": 4, // Lightning needs 4-8 steps
            "cfg": 1.5, // Lightning needs low CFG (1.0 - 2.0)
            "sampler_name": "euler", // Lightning works best with Euler/Euler_Ancestral
            "scheduler": "sgm_uniform",
            "denoise": 1,
            "model": ["5", 0],
            "positive": ["3", 0],
            "negative": ["4", 0],
            "latent_image": ["8", 0]
        },
        "class_type": "KSampler",
        "_meta": {
            "title": "KSampler (Lightning)"
        }
    },
    "8": {
        "inputs": {
            "width": 512,
            "height": 512,
            "batch_size": 16 // 16 frames standard
        },
        "class_type": "EmptyLatentImage",
        "_meta": {
            "title": "Empty Latent (Video)"
        }
    },
    "9": {
        "inputs": {
            "samples": ["7", 0],
            "vae": ["2", 0]
        },
        "class_type": "VAEDecode",
        "_meta": {
            "title": "VAE Decode"
        }
    },
    "10": {
        "inputs": {
            "filename_prefix": "AnimateDiff_Lightning",
            "fps": 12,
            "lossless": false,
            "quality": 85,
            "method": "default",
            "images": ["9", 0]
        },
        "class_type": "SaveAnimatedWEBP",
        "_meta": {
            "title": "Save WebP"
        }
    }
};
