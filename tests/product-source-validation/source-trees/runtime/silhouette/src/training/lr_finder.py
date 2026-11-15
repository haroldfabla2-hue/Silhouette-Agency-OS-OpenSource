"""
NANOSILHOUETTE - Learning Rate Finder
======================================
Implements automatic learning rate finding:
- LR Range Test (Leslie Smith)
- 1cycle scheduling
- Warmup with cosine decay
"""
import math
import torch
import torch.nn as nn
from torch.optim import Optimizer
from torch.optim.lr_scheduler import LRScheduler
from typing import Optional, List, Tuple, Callable
from dataclasses import dataclass
import copy


@dataclass
class LRFinderConfig:
    """Configuration for LR finder."""
    start_lr: float = 1e-7
    end_lr: float = 10.0
    num_steps: int = 100
    smooth_factor: float = 0.05
    divergence_threshold: float = 4.0


class LRFinder:
    """
    Learning Rate Finder using LR Range Test.
    
    Helps find optimal learning rate by gradually increasing LR
    and monitoring loss.
    """
    
    def __init__(
        self,
        model: nn.Module,
        optimizer: Optimizer,
        criterion: Callable,
        device: str = "cuda",
        config: Optional[LRFinderConfig] = None
    ):
        self.model = model
        self.optimizer = optimizer
        self.criterion = criterion
        self.device = device
        self.config = config or LRFinderConfig()
        
        # Store results
        self.learning_rates: List[float] = []
        self.losses: List[float] = []
        
        # Save initial state
        self._initial_model_state = copy.deepcopy(model.state_dict())
        self._initial_optimizer_state = copy.deepcopy(optimizer.state_dict())
    
    def range_test(
        self,
        train_loader,
        accumulation_steps: int = 1
    ) -> Tuple[float, float]:
        """
        Run LR range test.
        
        Args:
            train_loader: Training data loader
            accumulation_steps: Gradient accumulation steps
        
        Returns:
            Tuple of (suggested_lr, max_lr)
        """
        self.model.train()
        
        # Calculate LR multiplier
        lr_mult = (self.config.end_lr / self.config.start_lr) ** (1 / self.config.num_steps)
        current_lr = self.config.start_lr
        
        # Set initial LR
        for param_group in self.optimizer.param_groups:
            param_group['lr'] = current_lr
        
        best_loss = float('inf')
        smoothed_loss = 0
        step = 0
        
        data_iter = iter(train_loader)
        
        print(f"[LR Finder] Starting range test from {self.config.start_lr:.2e} to {self.config.end_lr:.2e}")
        
        while step < self.config.num_steps:
            try:
                batch = next(data_iter)
            except StopIteration:
                data_iter = iter(train_loader)
                batch = next(data_iter)
            
            # Forward pass
            if isinstance(batch, dict):
                input_ids = batch['input_ids'].to(self.device)
                labels = batch.get('labels', input_ids).to(self.device)
            else:
                input_ids = batch[0].to(self.device)
                labels = batch[1].to(self.device) if len(batch) > 1 else batch[0].to(self.device)
            
            outputs = self.model(input_ids, labels=labels)
            loss = outputs['loss'] if isinstance(outputs, dict) else outputs
            loss = loss / accumulation_steps
            
            # Backward
            loss.backward()
            
            if (step + 1) % accumulation_steps == 0:
                self.optimizer.step()
                self.optimizer.zero_grad()
            
            # Track loss
            current_loss = loss.item() * accumulation_steps
            
            if step == 0:
                smoothed_loss = current_loss
            else:
                smoothed_loss = (
                    self.config.smooth_factor * current_loss + 
                    (1 - self.config.smooth_factor) * smoothed_loss
                )
            
            self.learning_rates.append(current_lr)
            self.losses.append(smoothed_loss)
            
            # Check for divergence
            if smoothed_loss > best_loss * self.config.divergence_threshold:
                print(f"[LR Finder] Stopping - loss diverged at LR={current_lr:.2e}")
                break
            
            if smoothed_loss < best_loss:
                best_loss = smoothed_loss
            
            # Update LR
            current_lr *= lr_mult
            for param_group in self.optimizer.param_groups:
                param_group['lr'] = current_lr
            
            step += 1
            
            if step % 20 == 0:
                print(f"[LR Finder] Step {step}/{self.config.num_steps}, LR={current_lr:.2e}, Loss={smoothed_loss:.4f}")
        
        # Restore initial state
        self.model.load_state_dict(self._initial_model_state)
        self.optimizer.load_state_dict(self._initial_optimizer_state)
        
        # Find suggested LR
        suggested_lr, max_lr = self._find_optimal_lr()
        
        print(f"[LR Finder] Suggested LR: {suggested_lr:.2e} (Max: {max_lr:.2e})")
        
        return suggested_lr, max_lr
    
    def _find_optimal_lr(self) -> Tuple[float, float]:
        """Find optimal LR from collected data."""
        if len(self.losses) < 3:
            return self.config.start_lr, self.config.end_lr / 10
        
        # Find LR with steepest negative gradient (fastest decrease)
        gradients = []
        for i in range(1, len(self.losses)):
            gradient = (self.losses[i] - self.losses[i-1]) / (
                math.log(self.learning_rates[i]) - math.log(self.learning_rates[i-1])
            )
            gradients.append(gradient)
        
        # Find minimum gradient (steepest descent)
        min_gradient_idx = gradients.index(min(gradients))
        
        # Suggested LR is slightly before the minimum
        suggested_idx = max(0, min_gradient_idx - 2)
        suggested_lr = self.learning_rates[suggested_idx]
        
        # Max LR is at the minimum loss point
        min_loss_idx = self.losses.index(min(self.losses))
        max_lr = self.learning_rates[min_loss_idx]
        
        return suggested_lr, max_lr
    
    def plot(self, log_scale: bool = True):
        """Plot LR vs Loss (requires matplotlib)."""
        try:
            import matplotlib.pyplot as plt
            
            plt.figure(figsize=(10, 6))
            if log_scale:
                plt.semilogx(self.learning_rates, self.losses)
            else:
                plt.plot(self.learning_rates, self.losses)
            
            plt.xlabel('Learning Rate')
            plt.ylabel('Loss')
            plt.title('LR Range Test')
            plt.grid(True)
            plt.savefig('lr_finder_plot.png')
            plt.close()
            
            print("[LR Finder] Plot saved to lr_finder_plot.png")
        except ImportError:
            print("[LR Finder] matplotlib not available for plotting")


class OneCycleLR(LRScheduler):
    """
    1cycle learning rate scheduler.
    
    Implements Leslie Smith's 1cycle policy for super-convergence.
    """
    
    def __init__(
        self,
        optimizer: Optimizer,
        max_lr: float,
        total_steps: int,
        pct_start: float = 0.3,
        div_factor: float = 25.0,
        final_div_factor: float = 1e4,
        anneal_strategy: str = 'cos',
        last_epoch: int = -1
    ):
        self.max_lr = max_lr
        self.total_steps = total_steps
        self.pct_start = pct_start
        self.div_factor = div_factor
        self.final_div_factor = final_div_factor
        self.anneal_strategy = anneal_strategy
        
        self.initial_lr = max_lr / div_factor
        self.min_lr = self.initial_lr / final_div_factor
        
        super().__init__(optimizer, last_epoch)
    
    def get_lr(self):
        step = self.last_epoch
        
        if step < self.total_steps * self.pct_start:
            # Warmup phase
            pct = step / (self.total_steps * self.pct_start)
            lr = self._anneal(self.initial_lr, self.max_lr, pct)
        else:
            # Annealing phase
            pct = (step - self.total_steps * self.pct_start) / (
                self.total_steps * (1 - self.pct_start)
            )
            lr = self._anneal(self.max_lr, self.min_lr, pct)
        
        return [lr for _ in self.base_lrs]
    
    def _anneal(self, start: float, end: float, pct: float) -> float:
        if self.anneal_strategy == 'cos':
            return end + (start - end) * (1 + math.cos(math.pi * pct)) / 2
        elif self.anneal_strategy == 'linear':
            return start + (end - start) * pct
        else:
            raise ValueError(f"Unknown anneal strategy: {self.anneal_strategy}")


class WarmupCosineScheduler(LRScheduler):
    """
    Warmup with cosine annealing scheduler.
    
    Common scheduler for transformer training.
    """
    
    def __init__(
        self,
        optimizer: Optimizer,
        warmup_steps: int,
        total_steps: int,
        min_lr_ratio: float = 0.1,
        last_epoch: int = -1
    ):
        self.warmup_steps = warmup_steps
        self.total_steps = total_steps
        self.min_lr_ratio = min_lr_ratio
        
        super().__init__(optimizer, last_epoch)
    
    def get_lr(self):
        step = self.last_epoch
        
        if step < self.warmup_steps:
            # Linear warmup
            return [
                base_lr * step / max(1, self.warmup_steps)
                for base_lr in self.base_lrs
            ]
        else:
            # Cosine annealing
            progress = (step - self.warmup_steps) / max(
                1, self.total_steps - self.warmup_steps
            )
            cosine_decay = 0.5 * (1 + math.cos(math.pi * progress))
            decay = self.min_lr_ratio + (1 - self.min_lr_ratio) * cosine_decay
            
            return [base_lr * decay for base_lr in self.base_lrs]


def find_lr(
    model: nn.Module,
    train_loader,
    optimizer: Optional[Optimizer] = None,
    criterion: Optional[Callable] = None,
    device: str = "cuda"
) -> float:
    """
    Convenience function to find optimal learning rate.
    
    Args:
        model: The model to train
        train_loader: Training data loader
        optimizer: Optional optimizer (created if not provided)
        criterion: Optional loss function
        device: Device to use
    
    Returns:
        Suggested learning rate
    """
    if optimizer is None:
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-7)
    
    if criterion is None:
        criterion = nn.CrossEntropyLoss()
    
    finder = LRFinder(model, optimizer, criterion, device)
    suggested_lr, _ = finder.range_test(train_loader)
    
    return suggested_lr


if __name__ == "__main__":
    print("Testing LR Finder...")
    
    # Mock model and data
    model = nn.Sequential(
        nn.Linear(100, 50),
        nn.ReLU(),
        nn.Linear(50, 10)
    )
    
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-7)
    criterion = nn.CrossEntropyLoss()
    
    # Mock data loader
    class MockDataLoader:
        def __iter__(self):
            for _ in range(200):
                x = torch.randn(32, 100)
                y = torch.randint(0, 10, (32,))
                yield x, y
    
    # Test WarmupCosine scheduler
    scheduler = WarmupCosineScheduler(
        optimizer, warmup_steps=100, total_steps=1000
    )
    
    lrs = []
    for _ in range(1000):
        lrs.append(scheduler.get_last_lr()[0])
        scheduler.step()
    
    print(f"Warmup LRs: start={lrs[0]:.2e}, peak={max(lrs):.2e}, end={lrs[-1]:.2e}")
    
    print("✅ LR Finder test passed!")
