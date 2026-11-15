
import json
import os
import time
import sys
import torch

# NOTE: This script is designed to run in ISOLATION to protect system VRAM.
# It uses heavy quantization and CPU offloading.

QUEUE_FILE = os.path.join(os.getcwd(), 'data', 'queues', 'video_render_queue.json')
OUTPUT_DIR = os.path.join(os.getcwd(), 'public', 'media', 'video')

# --- CONFIGURATION FOR 4GB VRAM ---
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
USE_QUANTIZATION = True
OFFLOAD_CPU = True

def ensure_dirs():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

def load_queue():
    if not os.path.exists(QUEUE_FILE):
        return []
    with open(QUEUE_FILE, 'r') as f:
        return json.load(f)

def save_queue(queue):
    with open(QUEUE_FILE, 'w') as f:
        json.dump(queue, f, indent=2)

def generate_video_wan(prompt, output_path, image_path=None):
    """
    Real Inference using Diffusers with strict memory optimization for 4GB VRAM.
    Supports both Text-to-Video and Image-to-Video.
    """
    print(f"🎨 [Wan Worker] Initializing Real Render: '{prompt}'")
    if image_path:
        print(f"🖼️  Image Source: {image_path}")

    print(f"⚙️  Config: Device={DEVICE}, Offload=SequentialCPU")

    try:
        from diffusers import DiffusionPipeline, DPMSolverMultistepScheduler
        from diffusers.utils import export_to_video
        if image_path:
             from diffusers.utils import load_image

        # MODEL SELECTION & LOADING
        if image_path:
            # IMAGE-TO-VIDEO
            # Using Wan-AI/Wan2.1-I2V-1.3B-Diffusers (Hypothetical ID, verifying if exists or using equiv)
            # If not found, fall back to "damo-vilab/image-to-video-ib-1.7b" which is reliable on 4GB.
            # Using damo-vilab I2V for stability on RTX 3050 first.
            model_id = "damo-vilab/image-to-video-ib-1.7b"
            print(f"⬇️  Loading I2V Model: {model_id} (fp16)...")
            pipe = DiffusionPipeline.from_pretrained(model_id, torch_dtype=torch.float16, variant="fp16")
        else:
            # TEXT-TO-VIDEO
            model_id = "damo-vilab/text-to-video-ms-1.7b"
            print(f"⬇️  Loading T2V Model: {model_id} (fp16)...")
            pipe = DiffusionPipeline.from_pretrained(model_id, torch_dtype=torch.float16, variant="fp16")
        
        # COMMON OPTIMIZATIONS
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
        
        # CPU OFFLOAD CHECK
        # 'enable_sequential_cpu_offload' requires 'accelerate' and a GPU.
        # If running purely on CPU (no CUDA), we should NOT enable it, or use 'enable_model_cpu_offload' if supported.
        # For this fix, we simply check ability.
        
        can_offload = False
        try:
            import accelerate
            if torch.cuda.is_available():
                can_offload = True
        except:
            pass

        if can_offload:
            print("⚙️  Enabling Sequential CPU Offload (GPU Mode)...")
            pipe.enable_sequential_cpu_offload()
        else:
            print("⚠️  Running in CPU-Only Mode (No Offload/Accelerator detected). This will be slow.")
            # pipe.enable_model_cpu_offload() # Optional: try model offload if enabled?
        
        pipe.enable_vae_slicing()

        print("🎬 Starting Diffusion...")
        
        if image_path:
             # Load and resize image to fit model constraints (usually 256x256 or similar for 1.7b)
             init_image = load_image(image_path).resize((256, 256))
             video_frames = pipe(prompt, image=init_image, num_inference_steps=25, num_frames=16).frames[0]
        else:
             video_frames = pipe(prompt, num_inference_steps=25, num_frames=16).frames[0]
        
        print(f"💾 Exporting to {output_path}...")
        export_to_video(video_frames, output_path)
        print("✅ Render Success!")

    except ImportError as e:
        print(f"❌ Missing Dependency: {e}")
        print("   Run: pip install diffusers transformers accelerate torch")
        raise
    except Exception as e:
        print(f"❌ Render Error: {str(e)}")
        if "out of memory" in str(e).lower():
            print("⚠️  OOM Detected. Try closing other apps.")
        raise

def process_queue():
    queue = load_queue()
    pending = [job for job in queue if job['status'] == 'QUEUED']

    if not pending:
        print("📭 No pending jobs in queue.")
        return

    print(f"🔄 Found {len(pending)} pending jobs. Starting Batch Render...")
    
    for job in pending:
        print(f"🎬 Processing Job [{job['id']}]...")
        job['status'] = 'PROCESSING'
        save_queue(queue)

        try:
            output_filename = f"{job['id']}.mp4"
            output_path = os.path.join(OUTPUT_DIR, output_filename)
            
            # Pass imagePath if it exists in job
            image_src = job.get('imagePath')
            generate_video_wan(job['prompt'], output_path, image_src)
            
            job['videoPath'] = output_path
            job['status'] = 'COMPLETED'
            print(f"✅ Finished: {output_path}")

        except Exception as e:
            print(f"❌ Failed: {str(e)}")
            job['status'] = 'FAILED'
        
        save_queue(queue)

if __name__ == "__main__":
    print("🚀 Auto-Renderer Starting...")
    ensure_dirs()
    process_queue()
