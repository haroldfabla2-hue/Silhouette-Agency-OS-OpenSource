"""
NANOSILHOUETTE - Trainer
Complete training loop with mixed precision, gradient accumulation, and logging.
"""
import os
import time
import math
import torch
import torch.nn as nn
from torch.amp import autocast, GradScaler
from typing import Optional, Dict, Any
from dataclasses import dataclass
from tqdm import tqdm

try:
    import wandb
    WANDB_AVAILABLE = True
except ImportError:
    WANDB_AVAILABLE = False


@dataclass
class TrainerConfig:
    # Optimization
    learning_rate: float = 3e-4
    weight_decay: float = 0.1
    adam_beta1: float = 0.9
    adam_beta2: float = 0.95
    adam_epsilon: float = 1e-8
    max_grad_norm: float = 1.0
    
    # Schedule
    warmup_steps: int = 1000
    num_training_steps: int = 100000
    lr_scheduler_type: str = "cosine"
    
    # Batching
    gradient_accumulation_steps: int = 8
    
    # Precision
    mixed_precision: bool = True
    
    # Logging
    logging_steps: int = 10
    eval_steps: int = 500
    save_steps: int = 1000
    
    # Paths
    output_dir: str = "./checkpoints"
    
    # Wandb
    use_wandb: bool = False
    wandb_project: str = "silhouette"


class Trainer:
    """Training loop for NANOSILHOUETTE."""
    
    def __init__(
        self,
        model: nn.Module,
        train_dataloader,
        eval_dataloader=None,
        config: Optional[TrainerConfig] = None
    ):
        self.model = model
        self.train_dataloader = train_dataloader
        self.eval_dataloader = eval_dataloader
        self.config = config or TrainerConfig()
        
        # Device
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)
        
        # Optimizer
        self.optimizer = self._create_optimizer()
        
        # Scheduler
        self.scheduler = self._create_scheduler()
        
        # Mixed precision
        self.scaler = GradScaler('cuda') if self.config.mixed_precision and self.device.type == "cuda" else None
        
        # State
        self.global_step = 0
        self.epoch = 0
        
        # Logging
        if self.config.use_wandb and WANDB_AVAILABLE:
            wandb.init(project=self.config.wandb_project)
        
        # Create output dir
        os.makedirs(self.config.output_dir, exist_ok=True)
    
    def _create_optimizer(self):
        # Separate weight decay for different param groups
        decay_params = []
        no_decay_params = []
        
        for name, param in self.model.named_parameters():
            if not param.requires_grad:
                continue
            if "bias" in name or "norm" in name or "embedding" in name:
                no_decay_params.append(param)
            else:
                decay_params.append(param)
        
        param_groups = [
            {"params": decay_params, "weight_decay": self.config.weight_decay},
            {"params": no_decay_params, "weight_decay": 0.0}
        ]
        
        return torch.optim.AdamW(
            param_groups,
            lr=self.config.learning_rate,
            betas=(self.config.adam_beta1, self.config.adam_beta2),
            eps=self.config.adam_epsilon
        )
    
    def _create_scheduler(self):
        def lr_lambda(step):
            if step < self.config.warmup_steps:
                return step / max(1, self.config.warmup_steps)
            progress = (step - self.config.warmup_steps) / max(
                1, self.config.num_training_steps - self.config.warmup_steps
            )
            return 0.5 * (1.0 + math.cos(math.pi * progress))
        
        return torch.optim.lr_scheduler.LambdaLR(self.optimizer, lr_lambda)
    
    def train(self, num_epochs: int = None, max_steps: int = None):
        """Main training loop."""
        max_steps = max_steps or self.config.num_training_steps
        
        self.model.train()
        
        pbar = tqdm(total=max_steps, desc="Training")
        
        accumulation_loss = 0.0
        accumulation_steps = 0
        
        while self.global_step < max_steps:
            for batch in self.train_dataloader:
                # Move to device
                batch = {k: v.to(self.device) for k, v in batch.items()}
                
                # Forward pass
                use_amp = self.config.mixed_precision and self.scaler is not None
                with autocast(device_type=self.device.type, enabled=use_amp):
                    outputs = self.model(
                        input_ids=batch["input_ids"],
                        labels=batch["labels"]
                    )
                    loss = outputs["loss"] / self.config.gradient_accumulation_steps
                
                # Backward pass
                if self.scaler:
                    self.scaler.scale(loss).backward()
                else:
                    loss.backward()
                
                accumulation_loss += loss.item()
                accumulation_steps += 1
                
                # Optimizer step
                if accumulation_steps >= self.config.gradient_accumulation_steps:
                    if self.scaler:
                        self.scaler.unscale_(self.optimizer)
                    
                    # Gradient clipping
                    torch.nn.utils.clip_grad_norm_(
                        self.model.parameters(),
                        self.config.max_grad_norm
                    )
                    
                    if self.scaler:
                        self.scaler.step(self.optimizer)
                        self.scaler.update()
                    else:
                        self.optimizer.step()
                    
                    self.scheduler.step()
                    self.optimizer.zero_grad()
                    
                    self.global_step += 1
                    
                    # Logging
                    if self.global_step % self.config.logging_steps == 0:
                        lr = self.scheduler.get_last_lr()[0]
                        pbar.set_postfix({
                            "loss": f"{accumulation_loss:.4f}",
                            "lr": f"{lr:.2e}"
                        })
                        
                        if self.config.use_wandb and WANDB_AVAILABLE:
                            wandb.log({
                                "loss": accumulation_loss,
                                "learning_rate": lr,
                                "step": self.global_step
                            })
                    
                    # Eval
                    if self.eval_dataloader and self.global_step % self.config.eval_steps == 0:
                        self.evaluate()
                        self.model.train()
                    
                    # Save
                    if self.global_step % self.config.save_steps == 0:
                        self.save_checkpoint()
                    
                    accumulation_loss = 0.0
                    accumulation_steps = 0
                    pbar.update(1)
                
                if self.global_step >= max_steps:
                    break
        
        pbar.close()
        self.save_checkpoint("final")
        print(f"Training complete! Final step: {self.global_step}")
    
    @torch.no_grad()
    def evaluate(self) -> Dict[str, float]:
        """Evaluate on eval dataset."""
        self.model.eval()
        total_loss = 0.0
        num_batches = 0
        
        for batch in self.eval_dataloader:
            batch = {k: v.to(self.device) for k, v in batch.items()}
            outputs = self.model(input_ids=batch["input_ids"], labels=batch["labels"])
            total_loss += outputs["loss"].item()
            num_batches += 1
            
            if num_batches >= 50:  # Limit eval batches
                break
        
        avg_loss = total_loss / max(1, num_batches)
        perplexity = math.exp(min(avg_loss, 20))  # Clamp to avoid overflow
        
        print(f"Eval - Loss: {avg_loss:.4f}, Perplexity: {perplexity:.2f}")
        
        if self.config.use_wandb and WANDB_AVAILABLE:
            wandb.log({"eval_loss": avg_loss, "perplexity": perplexity})
        
        return {"loss": avg_loss, "perplexity": perplexity}
    
    def save_checkpoint(self, name: str = None):
        """Save model checkpoint."""
        name = name or f"step_{self.global_step}"
        path = os.path.join(self.config.output_dir, f"checkpoint_{name}.pt")
        
        torch.save({
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "scheduler_state_dict": self.scheduler.state_dict(),
            "global_step": self.global_step,
            "config": self.config
        }, path)
        
        print(f"Saved checkpoint: {path}")
    
    def load_checkpoint(self, path: str):
        """Load model checkpoint."""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        self.scheduler.load_state_dict(checkpoint["scheduler_state_dict"])
        self.global_step = checkpoint["global_step"]
        print(f"Loaded checkpoint from step {self.global_step}")
