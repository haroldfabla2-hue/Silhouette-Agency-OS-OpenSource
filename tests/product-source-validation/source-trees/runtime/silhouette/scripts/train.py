#!/usr/bin/env python
"""
NANOSILHOUETTE - Training Script
================================
Main entry point for training NANOSILHOUETTE models.

Usage:
    python train.py --config config/nano_config.yaml
    python train.py --variant nano --data data/train.txt
    python train.py --quick-test  # Quick sanity check
"""
import os
import sys
import argparse
import yaml
import torch

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.model import NanoSilhouetteModel
from src.model.nanosilhouette import NanoSilhouetteConfig
from src.training.trainer import Trainer, TrainerConfig
from src.training.data_loader import create_dataloader, SimpleTokenizer


def parse_args():
    parser = argparse.ArgumentParser(description="Train NANOSILHOUETTE")
    parser.add_argument("--config", type=str, help="Path to config YAML file")
    parser.add_argument("--variant", type=str, default="auto", 
                        choices=["nano", "micro", "small", "medium", "auto"])
    parser.add_argument("--data", type=str, default="data/train.txt")
    parser.add_argument("--output-dir", type=str, default="./checkpoints")
    parser.add_argument("--max-steps", type=int, default=10000)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--quick-test", action="store_true", help="Quick sanity check")
    parser.add_argument("--resume", type=str, help="Resume from checkpoint")
    return parser.parse_args()


def create_dummy_data():
    """Create dummy training data for testing."""
    os.makedirs("data", exist_ok=True)
    dummy_path = "data/dummy_train.txt"
    
    if not os.path.exists(dummy_path):
        with open(dummy_path, "w", encoding="utf-8") as f:
            # Generate some text
            text = "Hello world! This is NANOSILHOUETTE training. " * 1000
            text += "The quick brown fox jumps over the lazy dog. " * 500
            text += "Machine learning is fascinating. " * 500
            f.write(text)
        print(f"Created dummy data: {dummy_path}")
    
    return dummy_path


def main():
    args = parse_args()
    
    print("=" * 60)
    print("  NANOSILHOUETTE Training")
    print("=" * 60)
    
    # Check GPU
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"GPU: {gpu_name} ({vram:.1f} GB)")
    else:
        print("WARNING: No GPU detected, training will be slow!")
    
    # Create model
    print(f"\nCreating model (variant: {args.variant})...")
    
    if args.variant == "nano":
        config = NanoSilhouetteConfig.nano()
    elif args.variant == "micro":
        config = NanoSilhouetteConfig.micro()
    elif args.variant == "small":
        config = NanoSilhouetteConfig.small()
    elif args.variant == "medium":
        config = NanoSilhouetteConfig.medium()
    else:
        config = NanoSilhouetteConfig.auto_detect()
    
    model = NanoSilhouetteModel(config)
    
    # Quick test mode
    if args.quick_test:
        print("\n--- Quick Test Mode ---")
        data_path = create_dummy_data()
        
        tokenizer = SimpleTokenizer()
        train_loader = create_dataloader(
            data_path, tokenizer, 
            batch_size=2, max_length=128
        )
        
        trainer_config = TrainerConfig(
            learning_rate=1e-4,
            num_training_steps=20,
            logging_steps=5,
            gradient_accumulation_steps=2,
            output_dir=args.output_dir
        )
        
        trainer = Trainer(model, train_loader, config=trainer_config)
        trainer.train(max_steps=20)
        
        print("\n✅ Quick test passed! Model trains correctly.")
        return
    
    # Normal training
    if not os.path.exists(args.data):
        print(f"Data file not found: {args.data}")
        print("Creating dummy data for testing...")
        args.data = create_dummy_data()
    
    # Create data loader
    print(f"\nLoading data from: {args.data}")
    tokenizer = SimpleTokenizer()  # Replace with real tokenizer
    
    train_loader = create_dataloader(
        args.data, tokenizer,
        batch_size=args.batch_size,
        max_length=1024
    )
    
    # Create trainer
    trainer_config = TrainerConfig(
        learning_rate=args.lr,
        num_training_steps=args.max_steps,
        output_dir=args.output_dir
    )
    
    trainer = Trainer(model, train_loader, config=trainer_config)
    
    # Resume if specified
    if args.resume:
        trainer.load_checkpoint(args.resume)
    
    # Train!
    print(f"\nStarting training for {args.max_steps} steps...")
    trainer.train(max_steps=args.max_steps)
    
    print("\n✅ Training complete!")


if __name__ == "__main__":
    main()
