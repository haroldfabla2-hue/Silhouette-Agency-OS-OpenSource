#!/usr/bin/env python3
"""
GPU Status Check for Silhouette Agency OS
Checks GPU availability across all supported vendors (NVIDIA, AMD, Apple, CPU).
"""

import sys
import os

# Add scripts directory to path for detect_gpu
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_gpu import detect_gpu

print(f"Python Version: {sys.version}")

# Run hardware detection
gpu = detect_gpu()

print(f"GPU Vendor: {gpu.vendor}")
print(f"GPU Model: {gpu.name}")
print(f"Torch Backend: {gpu.torch_backend}")

if gpu.vram_mb > 0:
    print(f"VRAM: {gpu.vram_mb} MB ({gpu.vram_mb / 1024:.1f} GB)")

if gpu.driver_version:
    print(f"Driver Version: {gpu.driver_version}")

# Try to import torch and verify
try:
    import torch
    print(f"\nPyTorch Version: {torch.__version__}")

    if gpu.vendor == "nvidia":
        print(f"CUDA Available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"CUDA Version: {torch.version.cuda}")
            print(f"Device Name: {torch.cuda.get_device_name(0)}")
            print(f"Current Device: {torch.cuda.current_device()}")
        else:
            print("NVIDIA GPU detected but CUDA not available in PyTorch.")
            print("Reinstall PyTorch with CUDA: python scripts/setup_torch.py")

    elif gpu.vendor == "amd":
        # ROCm uses the same torch.cuda API
        cuda_avail = torch.cuda.is_available()
        print(f"ROCm/HIP Available: {cuda_avail}")
        if cuda_avail:
            print(f"Device Name: {torch.cuda.get_device_name(0)}")
        elif gpu.rocm_available:
            print("ROCm installed but PyTorch ROCm not detected.")
            print("Reinstall PyTorch with ROCm: python scripts/setup_torch.py")
        else:
            print("AMD GPU detected but ROCm not installed.")
            print("Install ROCm: https://rocm.docs.amd.com/")

    elif gpu.vendor == "apple":
        mps_avail = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
        print(f"MPS Available: {mps_avail}")
        if mps_avail:
            print("Apple Silicon GPU acceleration is ready.")
        else:
            print("MPS not available. Ensure PyTorch >= 2.0 on macOS 12.3+")

    else:
        print("Running in CPU-only mode.")
        print("For GPU acceleration, install appropriate drivers for your hardware.")

except ImportError:
    print("\nPyTorch not installed. Run: python scripts/setup_torch.py")
