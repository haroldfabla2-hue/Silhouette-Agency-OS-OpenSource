#!/usr/bin/env python3
"""
Smart PyTorch & Dependencies Installer for Silhouette Agency OS

Detects GPU hardware and installs the correct PyTorch variant:
  - NVIDIA -> PyTorch + CUDA
  - AMD    -> PyTorch + ROCm
  - Apple  -> PyTorch + MPS (default pip)
  - None   -> PyTorch CPU-only

Usage:
    python scripts/setup_torch.py              # Detect and install
    python scripts/setup_torch.py --dry-run    # Show what would be installed
"""

import subprocess
import sys
import os

# Add scripts directory to path so we can import detect_gpu
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_gpu import detect_gpu, get_install_recommendations


def run_pip(args, dry_run=False):
    """Run a pip command."""
    cmd = [sys.executable, "-m", "pip"] + args
    cmd_str = " ".join(cmd)

    if dry_run:
        print(f"  [DRY RUN] {cmd_str}")
        return True

    print(f"  $ {cmd_str}")
    result = subprocess.run(cmd)
    return result.returncode == 0


def install_requirements(req_file, skip_packages=None, dry_run=False):
    """Install a requirements.txt, skipping incompatible packages."""
    if not os.path.exists(req_file):
        print(f"  Skipping {req_file} (not found)")
        return

    skip = set(p.lower() for p in (skip_packages or []))

    with open(req_file) as f:
        lines = f.readlines()

    filtered = []
    for line in lines:
        line_stripped = line.strip()
        # Skip comments, empty lines
        if not line_stripped or line_stripped.startswith("#"):
            continue
        # Extract package name (before any version specifier)
        pkg_name = line_stripped.split(">=")[0].split("==")[0].split("[")[0].split(";")[0].strip().lower()
        if pkg_name in skip:
            print(f"  Skipping {pkg_name} (incompatible with detected GPU)")
            continue
        # Skip torch/torchvision/torchaudio - we install those separately
        if pkg_name in ("torch", "torchvision", "torchaudio"):
            continue
        filtered.append(line_stripped)

    if filtered:
        if dry_run:
            print(f"  [DRY RUN] pip install {' '.join(filtered)}")
        else:
            run_pip(["install"] + filtered)


def main():
    dry_run = "--dry-run" in sys.argv

    print()
    print("=" * 55)
    print("  SILHOUETTE OS - Smart Dependency Installer")
    print("=" * 55)
    print()

    # Step 1: Detect GPU
    print("[1/3] Detecting GPU hardware...")
    gpu_info = detect_gpu()
    recommendations = get_install_recommendations(gpu_info)

    vendor_labels = {
        "nvidia": "NVIDIA",
        "amd": "AMD",
        "intel": "Intel",
        "apple": "Apple Silicon",
        "none": "CPU Only",
    }
    print(f"  Detected: {vendor_labels.get(gpu_info.vendor, gpu_info.vendor)} - {gpu_info.name}")
    print(f"  Backend:  {gpu_info.torch_backend}")
    print()

    for warning in recommendations["warnings"]:
        print(f"  WARNING: {warning}")

    # Step 2: Install PyTorch with correct backend
    print()
    print("[2/3] Installing PyTorch...")
    torch_cmd = recommendations["torch_install"]
    # Parse the pip install command
    parts = torch_cmd.replace("pip install ", "").split()
    pip_args = ["install"]
    packages = []
    i = 0
    while i < len(parts):
        if parts[i] == "--index-url" and i + 1 < len(parts):
            pip_args.extend(["--index-url", parts[i + 1]])
            i += 2
        else:
            packages.append(parts[i])
            i += 1
    pip_args.extend(packages)
    run_pip(pip_args, dry_run=dry_run)

    # Step 3: Install remaining requirements
    print()
    print("[3/3] Installing project dependencies...")
    skip = recommendations["skip_packages"]
    # Also skip torch variants since we already installed them
    skip_all = skip + ["torch", "torchvision", "torchaudio"]

    # Find project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    req_files = [
        os.path.join(project_root, "silhouette", "requirements.txt"),
        os.path.join(project_root, "voice_engine", "requirements.txt"),
        os.path.join(project_root, "reasoning_engine", "requirements.txt"),
        os.path.join(project_root, "scripts", "render", "requirements.txt"),
    ]

    for req_file in req_files:
        rel_path = os.path.relpath(req_file, project_root)
        print(f"\n  Installing from {rel_path}...")
        install_requirements(req_file, skip_packages=skip_all, dry_run=dry_run)

    # Install extra packages for this GPU
    if recommendations["extra_packages"]:
        print(f"\n  Installing GPU-specific extras...")
        run_pip(["install"] + recommendations["extra_packages"], dry_run=dry_run)

    print()
    print("=" * 55)
    print("  Installation complete!")
    print(f"  Device config: {recommendations['device_config'].get('device', 'cpu')}")
    print("=" * 55)
    print()


if __name__ == "__main__":
    main()
