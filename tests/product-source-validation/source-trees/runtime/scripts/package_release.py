#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecosystem Release Packager for Silhouette Agency OS
Alberto Farah Agency
"""

import os
import tarfile
from pathlib import Path

def create_release():
    print("="*65)
    print(" PACKAGING SILHOUETTE AGENCY OS FOR DEPLOYMENT")
    print("="*65)
    
    work_dir = Path(os.getcwd())
    output_file = work_dir / "silhouetteagency-deploy.tar.gz"
    
    # Files and folders to include
    includes = [
        "docker-compose.prod.yml",
        "Dockerfile",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vite.config.ts",
        "vitest.config.ts",
        "index.html",
        "index.css",
        "index.tsx",
        "App.tsx",
        "ARCHITECTURE.md",
        "INSTALL.md",
        "README.md",
        "cli/",
        "components/",
        "config/",
        "constants/",
        "db/",
        "docs/",
        "hooks/",
        "logo/",
        "public/",
        "reasoning_engine/",
        "sandbox/",
        "scripts/",
        "server/",
        "services/",
        "types/",
        "universalprompts/",
        "utils/",
        "voice_engine/"
    ]
    
    # Patterns to exclude to keep the package small
    excludes = [
        "__pycache__",
        "*.pyc",
        ".git",
        "node_modules",
        "dist",
        ".gemini",
        "ComfyUI",
        "ComfyUI.7z",
        "mamba-2.8b-slimpj.Q4_K_M.gguf",
        "uploads",
        "output",
        ".env",
        ".env.local",
        "silhouetteagency-deploy.tar.gz",
        "temp_pres_",
        "{"
    ]
    
    def should_exclude(path):
        path_str = str(path)
        for pattern in excludes:
            if pattern.startswith("*."):
                ext = pattern.split("*.")[1]
                if path.suffix == f".{ext}":
                    return True
            elif pattern in path_str:
                return True
        return False
        
    print("\n1. Building target file lists...")
    
    try:
        with tarfile.open(output_file, "w:gz") as tar:
            for include in includes:
                source_path = work_dir / include
                if not source_path.exists():
                    print(f"   [SKIP] {include} does not exist")
                    continue
                
                if source_path.is_file():
                    arcname = f"silhouetteagency/{include}"
                    tar.add(source_path, arcname=arcname)
                    print(f"   [ADD] File: {include}")
                else:
                    # Recursive directory walk
                    for root, dirs, files in os.walk(source_path):
                        # Filter directories to exclude on-the-fly
                        dirs[:] = [d for d in dirs if not should_exclude(Path(root) / d)]
                        
                        for file in files:
                            file_path = Path(root) / file
                            if should_exclude(file_path):
                                continue
                            
                            rel_path = file_path.relative_to(work_dir)
                            arcname = f"silhouetteagency/{rel_path}"
                            tar.add(file_path, arcname=arcname)
                            
                    print(f"   [ADD] Directory: {include}")
        
        # Verify package size
        size_bytes = output_file.stat().st_size
        size_mb = size_bytes / (1024 * 1024)
        
        print("\n" + "="*65)
        print(" SUCCESS: DEPLOYMENT PACKAGE COMPILED")
        print("="*65)
        print(f"Target Archive: {output_file}")
        print(f"Archive Size:   {size_mb:.3f} MB")
        print("\nDeploy Instructions:")
        print("1. Upload 'silhouetteagency-deploy.tar.gz' to target server.")
        print("2. Extract the file: tar -xzf silhouetteagency-deploy.tar.gz")
        print("3. Enter directory: cd silhouetteagency/")
        print("4. Copy environments: cp .env.example .env")
        print("5. Spin up stack: docker compose -f docker-compose.prod.yml up -d --build")
        print("="*65)
        return True
        
    except Exception as e:
        print(f"\nError creating package: {e}")
        return False

if __name__ == "__main__":
    create_release()
