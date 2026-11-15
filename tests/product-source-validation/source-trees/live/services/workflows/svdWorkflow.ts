import { ComfyWorkflow } from '../../types';

export const SVD_WORKFLOW: ComfyWorkflow = {
    "3": {
        "inputs": {
            "seed": 0,
            "steps": 20,
            "cfg": 2.5,
            "sampler_name": "euler",
            "scheduler": "karras",
            "denoise": 1.0,
            "model": [
                "15",
                0
            ],
            "positive": [
                "12",
                0
            ],
            "negative": [
                "12",
                1
            ],
            "latent_image": [
                "12",
                2
            ]
        },
        "class_type": "KSampler",
        "_meta": {
            "title": "KSampler"
        }
    },
    "8": {
        "inputs": {
            "samples": [
                "3",
                0
            ],
            "vae": [
                "15",
                2
            ]
        },
        "class_type": "VAEDecode",
        "_meta": {
            "title": "VAE Decode"
        }
    },
    "10": {
        "inputs": {
            "filename_prefix": "SVD_Img2Vid",
            "fps": 8,
            "lossless": false,
            "quality": 85,
            "method": "default",
            "images": [
                "8",
                0
            ]
        },
        "class_type": "SaveAnimatedWEBP",
        "_meta": {
            "title": "SaveAnimatedWEBP"
        }
    },
    "12": {
        "inputs": {
            "width": 1024,
            "height": 576,
            "video_frames": 25,
            "motion_bucket_id": 127,
            "fps": 6,
            "augmentation_level": 0.0,
            "clip_vision": [
                "15",
                1
            ],
            "init_image": [
                "14",
                0
            ],
            "vae": [
                "15",
                2
            ]
        },
        "class_type": "SVD_img2vid_Conditioning",
        "_meta": {
            "title": "SVD_img2vid_Conditioning"
        }
    },
    "14": {
        "inputs": {
            "image": "input_image.png",
            "upload": "image"
        },
        "class_type": "LoadImage",
        "_meta": {
            "title": "Load Image"
        }
    },
    "15": {
        "inputs": {
            "ckpt_name": "svd_xt.safetensors"
        },
        "class_type": "ImageOnlyCheckpointLoader",
        "_meta": {
            "title": "ImageOnlyCheckpointLoader"
        }
    }
};
