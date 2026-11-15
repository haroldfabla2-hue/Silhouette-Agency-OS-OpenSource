"""
NANOSILHOUETTE - Deep Optimizer
================================
Based on Google's Nested Learning / Hope architecture (NeurIPS 2025).

Key concepts:
- Internal optimizer that learns to optimize
- Uses L2 regression instead of dot-product similarity
- Self-modifying parameters during inference
- Enables test-time adaptation
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Optional, Dict
from dataclasses import dataclass


@dataclass
class DeepOptimizerConfig:
    d_model: int = 512
    optimizer_hidden_dim: int = 256
    num_optimizer_steps: int = 3
    learning_rate_scale: float = 0.01
    use_momentum: bool = True
    momentum_decay: float = 0.9


class ParameterPredictor(nn.Module):
    """
    Predicts parameter updates based on gradients and state.
    
    Like a learned optimizer, but runs during forward pass.
    """
    def __init__(self, param_dim: int, hidden_dim: int):
        super().__init__()
        
        # Input: concatenated [param, grad, momentum]
        input_dim = param_dim * 3
        
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, param_dim)
        )
        
        # Scale output to be small updates
        self.scale = nn.Parameter(torch.tensor(0.01))
    
    def forward(
        self, 
        params: torch.Tensor,
        grads: torch.Tensor,
        momentum: torch.Tensor
    ) -> torch.Tensor:
        """Predict parameter update."""
        x = torch.cat([params, grads, momentum], dim=-1)
        delta = self.net(x) * self.scale
        return delta


class InternalObjective(nn.Module):
    """
    Internal objective for self-optimization.
    
    Uses L2 regression loss instead of dot-product.
    """
    def __init__(self, d_model: int, hidden_dim: int):
        super().__init__()
        
        # Context encoder
        self.context_encoder = nn.Sequential(
            nn.Linear(d_model, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
        
        # Target predictor
        self.target_predictor = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, d_model)
        )
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        target_states: torch.Tensor
    ) -> torch.Tensor:
        """
        Compute L2 regression objective.
        
        Args:
            hidden_states: Current states (batch, seq, d_model)
            target_states: Target states (batch, seq, d_model)
        
        Returns:
            loss: L2 loss value
        """
        # Encode context
        context = self.context_encoder(hidden_states)
        
        # Predict target
        prediction = self.target_predictor(context)
        
        # L2 loss
        loss = F.mse_loss(prediction, target_states)
        
        return loss


class DeepOptimizer(nn.Module):
    """
    Deep Optimizer module from Hope architecture.
    
    Runs internal optimization steps during forward pass,
    allowing the model to adapt at test time.
    """
    def __init__(self, config: DeepOptimizerConfig):
        super().__init__()
        self.config = config
        
        # Learnable "fast weights" that get updated
        self.fast_weights = nn.Parameter(
            torch.randn(1, 1, config.d_model) * 0.02
        )
        
        # Parameter predictor (learned optimizer)
        self.param_predictor = ParameterPredictor(
            param_dim=config.d_model,
            hidden_dim=config.optimizer_hidden_dim
        )
        
        # Internal objective
        self.objective = InternalObjective(
            d_model=config.d_model,
            hidden_dim=config.optimizer_hidden_dim
        )
        
        # Momentum buffer (registered as buffer, not parameter)
        self.register_buffer(
            "momentum_buffer",
            torch.zeros(1, 1, config.d_model)
        )
        
        # Output projection
        self.output_proj = nn.Linear(config.d_model * 2, config.d_model)
        
        # Layer norm
        self.norm = nn.LayerNorm(config.d_model)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        target_states: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        """
        Forward pass with internal optimization.
        
        Args:
            hidden_states: Input (batch, seq, d_model)
            target_states: Optional targets for training
        
        Returns:
            output: Modified hidden states
            info: Dictionary with optimization info
        """
        batch, seq_len, d_model = hidden_states.shape
        
        # Expand fast weights for batch
        fast_weights = self.fast_weights.expand(batch, seq_len, -1)
        
        # Initialize momentum
        if self.momentum_buffer.shape[0] != batch:
            momentum = torch.zeros_like(fast_weights)
        else:
            momentum = self.momentum_buffer.expand(batch, seq_len, -1)
        
        # Internal optimization loop
        optimization_losses = []
        
        for step in range(self.config.num_optimizer_steps):
            # Compute "gradient" via internal objective
            with torch.enable_grad():
                fast_weights_grad = fast_weights.detach().requires_grad_(True)
                
                if target_states is not None:
                    target = target_states
                else:
                    # Self-supervised: predict next token representation
                    target = hidden_states.roll(-1, dims=1)
                
                loss = self.objective(
                    hidden_states + fast_weights_grad,
                    target
                )
                
                # Compute gradient
                grad = torch.autograd.grad(
                    loss, fast_weights_grad,
                    create_graph=self.training
                )[0]
            
            optimization_losses.append(loss.detach())
            
            # Update momentum
            if self.config.use_momentum:
                momentum = (
                    self.config.momentum_decay * momentum +
                    (1 - self.config.momentum_decay) * grad
                )
            else:
                momentum = grad
            
            # Predict parameter update using learned optimizer
            delta = self.param_predictor(fast_weights, grad, momentum)
            
            # Apply update
            fast_weights = fast_weights - self.config.learning_rate_scale * delta
        
        # Combine original hidden states with optimized fast weights
        combined = torch.cat([hidden_states, fast_weights], dim=-1)
        output = self.output_proj(combined)
        output = self.norm(output + hidden_states)  # Residual
        
        # Collect info
        info = {
            "optimization_losses": torch.stack(optimization_losses),
            "final_loss": optimization_losses[-1] if optimization_losses else None
        }
        
        return output, info


class HopeBlock(nn.Module):
    """
    Hope Block: Combines CMS with Deep Optimizer.
    
    This is the self-modifying recurrent block from the Hope architecture.
    """
    def __init__(self, config: DeepOptimizerConfig):
        super().__init__()
        
        self.deep_optimizer = DeepOptimizer(config)
        
        # Additional self-attention for context
        self.self_attn = nn.MultiheadAttention(
            config.d_model,
            num_heads=8,
            dropout=0.0,
            batch_first=True
        )
        
        self.norm1 = nn.LayerNorm(config.d_model)
        self.norm2 = nn.LayerNorm(config.d_model)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        target_states: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        # Self-attention for context
        residual = hidden_states
        hidden_states = self.norm1(hidden_states)
        hidden_states, _ = self.self_attn(
            hidden_states, hidden_states, hidden_states
        )
        hidden_states = residual + hidden_states
        
        # Deep optimization
        hidden_states = self.norm2(hidden_states)
        output, info = self.deep_optimizer(hidden_states, target_states)
        
        return output, info


def create_deep_optimizer(
    d_model: int = 512,
    optimizer_hidden_dim: int = 256,
    num_optimizer_steps: int = 3
) -> DeepOptimizer:
    """Factory function for Deep Optimizer."""
    config = DeepOptimizerConfig(
        d_model=d_model,
        optimizer_hidden_dim=optimizer_hidden_dim,
        num_optimizer_steps=num_optimizer_steps
    )
    return DeepOptimizer(config)


if __name__ == "__main__":
    print("Testing Deep Optimizer...")
    
    config = DeepOptimizerConfig(
        d_model=512,
        optimizer_hidden_dim=256,
        num_optimizer_steps=3
    )
    
    optimizer = DeepOptimizer(config)
    
    batch, seq_len, d_model = 2, 64, 512
    x = torch.randn(batch, seq_len, d_model)
    target = torch.randn(batch, seq_len, d_model)
    
    if torch.cuda.is_available():
        optimizer = optimizer.cuda()
        x = x.cuda()
        target = target.cuda()
    
    output, info = optimizer(x, target)
    print(f"Input: {x.shape}")
    print(f"Output: {output.shape}")
    print(f"Optimization losses: {info['optimization_losses']}")
    
    params = sum(p.numel() for p in optimizer.parameters())
    print(f"Parameters: {params:,}")
    
    print("✅ Deep Optimizer test passed!")
