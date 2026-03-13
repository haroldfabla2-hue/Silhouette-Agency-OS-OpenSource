#!/usr/bin/env python3
"""
GPU Hardware Detection for Silhouette Agency OS
Detects GPU vendor and capabilities to install correct drivers/packages.

Usage:
    python scripts/detect_gpu.py          # Human-readable output
    python scripts/detect_gpu.py --json   # Machine-readable JSON output

Supported vendors: NVIDIA, AMD, Intel, CPU-only
"""

import subprocess
import platform
import json
import sys
import os
import re


class GPUInfo:
    """Detected GPU information."""
    def __init__(self):
        self.vendor = "none"        # "nvidia", "amd", "intel", "none"
        self.name = "Unknown"
        self.vram_mb = 0
        self.driver_version = ""
        self.cuda_available = False
        self.cuda_version = ""
        self.rocm_available = False
        self.rocm_version = ""
        self.torch_backend = "cpu"  # "cuda", "rocm", "cpu"
        self.torch_index_url = ""   # PyTorch install URL

    def to_dict(self):
        return {
            "vendor": self.vendor,
            "name": self.name,
            "vram_mb": self.vram_mb,
            "driver_version": self.driver_version,
            "cuda_available": self.cuda_available,
            "cuda_version": self.cuda_version,
            "rocm_available": self.rocm_available,
            "rocm_version": self.rocm_version,
            "torch_backend": self.torch_backend,
            "torch_index_url": self.torch_index_url,
            "device": self._get_device_string(),
            "platform": platform.system().lower(),
        }

    def _get_device_string(self):
        """Returns the torch device string to use."""
        if self.vendor == "nvidia" and self.cuda_available:
            return "cuda"
        elif self.vendor == "amd" and self.rocm_available:
            return "cuda"  # ROCm uses the same 'cuda' API in PyTorch
        else:
            return "cpu"


def _run_cmd(cmd, timeout=10):
    """Run a command and return stdout, or None on failure."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            shell=isinstance(cmd, str)
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def detect_nvidia():
    """Detect NVIDIA GPU via nvidia-smi."""
    info = GPUInfo()

    output = _run_cmd("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits")
    if output is None:
        return None

    parts = output.split("\n")[0].split(",")
    if len(parts) >= 3:
        info.vendor = "nvidia"
        info.name = parts[0].strip()
        info.vram_mb = int(parts[1].strip())
        info.driver_version = parts[2].strip()
        info.cuda_available = True
        info.torch_backend = "cuda"
        info.torch_index_url = "https://download.pytorch.org/whl/cu121"

        # Get CUDA version
        cuda_output = _run_cmd("nvidia-smi --query-gpu=driver_version --format=csv,noheader")
        nvcc_output = _run_cmd("nvcc --version")
        if nvcc_output:
            match = re.search(r"release (\d+\.\d+)", nvcc_output)
            if match:
                info.cuda_version = match.group(1)
        else:
            # Infer from driver version
            smi_full = _run_cmd("nvidia-smi")
            if smi_full:
                match = re.search(r"CUDA Version:\s*(\d+\.\d+)", smi_full)
                if match:
                    info.cuda_version = match.group(1)

        return info
    return None


def detect_amd():
    """Detect AMD GPU via rocm-smi or lspci."""
    info = GPUInfo()
    system = platform.system().lower()

    # Try rocm-smi first (Linux with ROCm installed)
    output = _run_cmd("rocm-smi --showproductname")
    if output and "GPU" in output:
        info.vendor = "amd"
        info.rocm_available = True
        info.torch_backend = "rocm"
        info.torch_index_url = "https://download.pytorch.org/whl/rocm6.1"

        # Extract GPU name
        for line in output.split("\n"):
            if "Card" in line or "GPU" in line:
                # Try to extract the model name
                parts = line.split(":")
                if len(parts) >= 2:
                    info.name = parts[-1].strip()
                    break

        # Get ROCm version
        rocm_ver = _run_cmd("rocm-smi --showdriverversion")
        if rocm_ver:
            for line in rocm_ver.split("\n"):
                if "Driver" in line:
                    parts = line.split(":")
                    if len(parts) >= 2:
                        info.driver_version = parts[-1].strip()

        rocm_path = os.environ.get("ROCM_PATH", "/opt/rocm")
        version_file = os.path.join(rocm_path, ".info", "version")
        if os.path.exists(version_file):
            with open(version_file) as f:
                info.rocm_version = f.read().strip()

        # Get VRAM
        vram_output = _run_cmd("rocm-smi --showmeminfo vram")
        if vram_output:
            for line in vram_output.split("\n"):
                if "Total" in line:
                    match = re.search(r"(\d+)", line)
                    if match:
                        # rocm-smi reports in bytes typically
                        vram_bytes = int(match.group(1))
                        if vram_bytes > 1_000_000:
                            info.vram_mb = vram_bytes // (1024 * 1024)
                        else:
                            info.vram_mb = vram_bytes  # already in MB

        return info

    # Fallback: detect via lspci (Linux only)
    if system == "linux":
        lspci = _run_cmd("lspci")
        if lspci:
            for line in lspci.split("\n"):
                if "VGA" in line or "3D" in line or "Display" in line:
                    lower = line.lower()
                    if "amd" in lower or "radeon" in lower or "advanced micro" in lower:
                        info.vendor = "amd"
                        info.name = line.split(":")[-1].strip()
                        info.torch_backend = "rocm"
                        info.torch_index_url = "https://download.pytorch.org/whl/rocm6.1"
                        # ROCm not installed but AMD GPU detected
                        info.rocm_available = False
                        return info

    # Fallback: Windows - check via wmic/PowerShell
    if system == "windows":
        ps_cmd = 'powershell -Command "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"'
        output = _run_cmd(ps_cmd)
        if output:
            for line in output.split("\n"):
                lower = line.lower()
                if "amd" in lower or "radeon" in lower:
                    info.vendor = "amd"
                    info.name = line.strip()
                    # AMD on Windows - DirectML is the best option
                    info.torch_backend = "cpu"  # ROCm not well supported on Windows
                    info.torch_index_url = ""
                    return info

    return None


def detect_intel():
    """Detect Intel GPU (Arc/Xe/integrated)."""
    info = GPUInfo()
    system = platform.system().lower()

    if system == "linux":
        lspci = _run_cmd("lspci")
        if lspci:
            for line in lspci.split("\n"):
                if "VGA" in line or "3D" in line or "Display" in line:
                    lower = line.lower()
                    if "intel" in lower:
                        info.vendor = "intel"
                        info.name = line.split(":")[-1].strip()
                        # Check if it's Arc (discrete) vs integrated
                        if "arc" in lower:
                            info.torch_backend = "cpu"  # XPU support still experimental
                            info.torch_index_url = ""
                        else:
                            info.torch_backend = "cpu"
                            info.torch_index_url = ""
                        return info

    if system == "windows":
        ps_cmd = 'powershell -Command "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"'
        output = _run_cmd(ps_cmd)
        if output:
            for line in output.split("\n"):
                lower = line.lower()
                if "intel" in lower:
                    info.vendor = "intel"
                    info.name = line.strip()
                    info.torch_backend = "cpu"
                    info.torch_index_url = ""
                    return info

    return None


def detect_macos_gpu():
    """Detect macOS GPU (Apple Silicon MPS or AMD discrete)."""
    info = GPUInfo()

    if platform.system() != "Darwin":
        return None

    output = _run_cmd("system_profiler SPDisplaysDataType")
    if not output:
        return None

    # Check for Apple Silicon (M1/M2/M3/M4)
    if "Apple" in output:
        info.vendor = "apple"
        match = re.search(r"Chipset Model:\s*(.+)", output)
        if match:
            info.name = match.group(1).strip()
        info.torch_backend = "mps"
        info.torch_index_url = ""  # Default PyTorch includes MPS
        # Unified memory - report system RAM
        mem_output = _run_cmd("sysctl -n hw.memsize")
        if mem_output:
            info.vram_mb = int(mem_output) // (1024 * 1024)
        return info

    # Check for AMD discrete on Intel Mac
    if "AMD" in output or "Radeon" in output:
        info.vendor = "amd"
        match = re.search(r"Chipset Model:\s*(.+)", output)
        if match:
            info.name = match.group(1).strip()
        info.torch_backend = "cpu"  # No ROCm on macOS
        info.torch_index_url = ""
        vram_match = re.search(r"VRAM.*?:\s*(\d+)\s*(MB|GB)", output)
        if vram_match:
            vram_val = int(vram_match.group(1))
            if vram_match.group(2) == "GB":
                vram_val *= 1024
            info.vram_mb = vram_val
        return info

    return None


def detect_gpu():
    """
    Main detection function. Tries vendors in order of GPU compute priority.
    Returns GPUInfo with detected hardware.
    """
    # macOS special case (Apple Silicon MPS)
    if platform.system() == "Darwin":
        result = detect_macos_gpu()
        if result:
            return result

    # NVIDIA first (most common for ML)
    result = detect_nvidia()
    if result:
        return result

    # AMD second
    result = detect_amd()
    if result:
        return result

    # Intel third
    result = detect_intel()
    if result:
        return result

    # CPU-only fallback
    info = GPUInfo()
    info.vendor = "none"
    info.name = "CPU Only"
    info.torch_backend = "cpu"
    info.torch_index_url = "https://download.pytorch.org/whl/cpu"
    return info


def get_install_recommendations(gpu_info):
    """Return installation recommendations based on detected GPU."""
    rec = {
        "torch_install": "",
        "extra_packages": [],
        "skip_packages": [],
        "warnings": [],
        "device_config": {},
    }

    backend = gpu_info.torch_backend

    if backend == "cuda":
        rec["torch_install"] = f"pip install torch torchvision torchaudio --index-url {gpu_info.torch_index_url}"
        rec["extra_packages"] = ["bitsandbytes>=0.42.0"]
        rec["device_config"] = {
            "device": "cuda",
            "compile_model": True,
            "mixed_precision": "bf16" if gpu_info.vram_mb >= 8192 else "fp16",
            "max_memory_gb": round((gpu_info.vram_mb / 1024) * 0.85, 1),  # 85% headroom
        }
    elif backend == "rocm":
        rec["torch_install"] = f"pip install torch torchvision torchaudio --index-url {gpu_info.torch_index_url}"
        rec["skip_packages"] = ["bitsandbytes"]  # Not compatible with AMD
        rec["warnings"].append("bitsandbytes is not compatible with AMD GPUs - skipping")
        if not gpu_info.rocm_available:
            rec["warnings"].append("AMD GPU detected but ROCm is not installed. Install ROCm first: https://rocm.docs.amd.com/")
        rec["device_config"] = {
            "device": "cuda",  # ROCm uses CUDA API
            "compile_model": True,
            "mixed_precision": "fp16",
            "max_memory_gb": round((gpu_info.vram_mb / 1024) * 0.85, 1) if gpu_info.vram_mb > 0 else 4.0,
        }
    elif backend == "mps":
        rec["torch_install"] = "pip install torch torchvision torchaudio"
        rec["skip_packages"] = ["bitsandbytes"]
        rec["warnings"].append("Apple MPS backend: some operations may fall back to CPU")
        rec["device_config"] = {
            "device": "mps",
            "compile_model": False,  # torch.compile limited on MPS
            "mixed_precision": "fp16",
            "max_memory_gb": round((gpu_info.vram_mb / 1024) * 0.5, 1) if gpu_info.vram_mb > 0 else 8.0,
        }
    else:  # CPU
        rec["torch_install"] = f"pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
        rec["skip_packages"] = ["bitsandbytes"]
        rec["warnings"].append("No GPU detected - running in CPU-only mode (slower inference)")
        rec["device_config"] = {
            "device": "cpu",
            "compile_model": False,
            "mixed_precision": "fp32",  # No mixed precision on CPU
            "max_memory_gb": 0,
        }

    return rec


def print_report(gpu_info, recommendations):
    """Print a human-readable report."""
    print("=" * 55)
    print("  SILHOUETTE OS - GPU Hardware Detection Report")
    print("=" * 55)
    print()

    vendor_icons = {
        "nvidia": "NVIDIA",
        "amd": "AMD",
        "intel": "Intel",
        "apple": "Apple Silicon",
        "none": "No GPU",
    }

    print(f"  Platform:     {platform.system()} {platform.machine()}")
    print(f"  GPU Vendor:   {vendor_icons.get(gpu_info.vendor, gpu_info.vendor)}")
    print(f"  GPU Model:    {gpu_info.name}")

    if gpu_info.vram_mb > 0:
        vram_gb = gpu_info.vram_mb / 1024
        print(f"  VRAM:         {gpu_info.vram_mb} MB ({vram_gb:.1f} GB)")

    if gpu_info.driver_version:
        print(f"  Driver:       {gpu_info.driver_version}")

    if gpu_info.cuda_available:
        print(f"  CUDA:         {gpu_info.cuda_version or 'Available'}")

    if gpu_info.rocm_available:
        print(f"  ROCm:         {gpu_info.rocm_version or 'Available'}")

    print(f"  Torch Device: {gpu_info.torch_backend}")
    print()

    print("-" * 55)
    print("  Install Command:")
    print(f"  $ {recommendations['torch_install']}")
    print()

    if recommendations["skip_packages"]:
        print(f"  Skip packages: {', '.join(recommendations['skip_packages'])}")

    if recommendations["extra_packages"]:
        print(f"  Extra packages: {', '.join(recommendations['extra_packages'])}")

    for warning in recommendations["warnings"]:
        print(f"  WARNING: {warning}")

    print()
    print(f"  Config -> device: {recommendations['device_config'].get('device', 'cpu')}")
    print(f"  Config -> mixed_precision: {recommendations['device_config'].get('mixed_precision', 'fp32')}")
    if recommendations['device_config'].get('max_memory_gb'):
        print(f"  Config -> max_memory_gb: {recommendations['device_config']['max_memory_gb']}")
    print("=" * 55)


def main():
    gpu_info = detect_gpu()
    recommendations = get_install_recommendations(gpu_info)

    if "--json" in sys.argv:
        output = {
            "gpu": gpu_info.to_dict(),
            "recommendations": recommendations,
        }
        print(json.dumps(output, indent=2))
    else:
        print_report(gpu_info, recommendations)

    return gpu_info


if __name__ == "__main__":
    main()
