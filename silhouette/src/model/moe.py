"""
NANOSILHOUETTE - Mixture of Experts (MoE)
==========================================
Based on Jamba architecture (AI21 Labs).
- 16 experts per layer
- Top-2 expert selection per token
- Load balancing loss for even distribution
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Optional
from dataclasses import dataclass


@dataclass
class MoEConfig:
    d_model: int = 512
    intermediate_size: int = 1376
    num_experts: int = 16
    num_experts_per_tok: int = 2
    aux_loss_coef: float = 0.01  # Load balancing coefficient


class Expert(nn.Module):
    """Single expert: SwiGLU FFN."""
    def __init__(self, d_model: int, intermediate_size: int):
        super().__init__()
        self.gate_proj = nn.Linear(d_model, intermediate_size, bias=False)
        self.up_proj = nn.Linear(d_model, intermediate_size, bias=False)
        self.down_proj = nn.Linear(intermediate_size, d_model, bias=False)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class Router(nn.Module):
    """Token-to-expert router with top-k selection."""
    def __init__(self, d_model: int, num_experts: int):
        super().__init__()
        self.gate = nn.Linear(d_model, num_experts, bias=False)
    
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        # x: (batch, seq, d_model)
        logits = self.gate(x)  # (batch, seq, num_experts)
        probs = F.softmax(logits, dim=-1)
        return logits, probs


class MoELayer(nn.Module):
    """
    Mixture of Experts Layer.
    
    Each token is routed to top-k experts.
    Outputs are weighted by router probabilities.
    """
    def __init__(self, config: MoEConfig):
        super().__init__()
        self.config = config
        self.num_experts = config.num_experts
        self.num_experts_per_tok = config.num_experts_per_tok
        
        # Experts
        self.experts = nn.ModuleList([
            Expert(config.d_model, config.intermediate_size)
            for _ in range(config.num_experts)
        ])
        
        # Router
        self.router = Router(config.d_model, config.num_experts)
        
        # For auxiliary loss
        self.aux_loss_coef = config.aux_loss_coef
    
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass.
        
        Args:
            x: (batch, seq, d_model)
        
        Returns:
            output: (batch, seq, d_model)
            aux_loss: Load balancing auxiliary loss
        """
        batch, seq_len, d_model = x.shape
        
        # Get routing probabilities
        router_logits, router_probs = self.router(x)
        
        # Select top-k experts per token
        topk_weights, topk_indices = torch.topk(
            router_probs, self.num_experts_per_tok, dim=-1
        )
        
        # Normalize weights
        topk_weights = topk_weights / topk_weights.sum(dim=-1, keepdim=True)
        
        # Compute expert outputs
        # Reshape for processing: (batch * seq, d_model)
        x_flat = x.view(-1, d_model)
        
        # Initialize output
        output = torch.zeros_like(x_flat)
        
        # Process each expert
        for expert_idx in range(self.num_experts):
            # Find tokens routed to this expert
            expert_mask = (topk_indices == expert_idx).any(dim=-1)
            expert_mask_flat = expert_mask.view(-1)
            
            if expert_mask_flat.any():
                # Get tokens for this expert
                expert_input = x_flat[expert_mask_flat]
                
                # Compute expert output
                expert_output = self.experts[expert_idx](expert_input)
                
                # Get weights for this expert
                # Find which position in top-k this expert is
                weight_mask = (topk_indices == expert_idx)
                weights = (topk_weights * weight_mask.float()).sum(dim=-1)
                weights_flat = weights.view(-1)[expert_mask_flat]
                
                # Add weighted output
                output[expert_mask_flat] += expert_output * weights_flat.unsqueeze(-1)
        
        output = output.view(batch, seq_len, d_model)
        
        # Compute auxiliary load balancing loss
        aux_loss = self._compute_aux_loss(router_probs, topk_indices)
        
        return output, aux_loss
    
    def _compute_aux_loss(
        self, 
        router_probs: torch.Tensor,
        topk_indices: torch.Tensor
    ) -> torch.Tensor:
        """
        Compute load balancing auxiliary loss.
        
        Encourages even distribution across experts.
        """
        batch, seq_len, num_experts = router_probs.shape
        
        # Fraction of tokens routed to each expert
        # One-hot encode selected experts
        expert_mask = F.one_hot(topk_indices, num_experts).float()
        expert_mask = expert_mask.sum(dim=2)  # Sum over top-k selections
        
        # Average over tokens
        tokens_per_expert = expert_mask.mean(dim=[0, 1])
        
        # Average router probability per expert
        router_prob_per_expert = router_probs.mean(dim=[0, 1])
        
        # Auxiliary loss: dot product of distributions
        # Minimized when distributions are uniform
        aux_loss = (tokens_per_expert * router_prob_per_expert).sum() * num_experts
        
        return self.aux_loss_coef * aux_loss


def create_moe_layer(
    d_model: int = 512,
    intermediate_size: int = 1376,
    num_experts: int = 16,
    num_experts_per_tok: int = 2
) -> MoELayer:
    """Factory function for MoE layer."""
    config = MoEConfig(
        d_model=d_model,
        intermediate_size=intermediate_size,
        num_experts=num_experts,
        num_experts_per_tok=num_experts_per_tok
    )
    return MoELayer(config)


if __name__ == "__main__":
    print("Testing MoE Layer...")
    
    config = MoEConfig(d_model=512, num_experts=16, num_experts_per_tok=2)
    moe = MoELayer(config)
    
    x = torch.randn(2, 64, 512)
    
    if torch.cuda.is_available():
        moe = moe.cuda()
        x = x.cuda()
    
    output, aux_loss = moe(x)
    print(f"Input: {x.shape}")
    print(f"Output: {output.shape}")
    print(f"Aux Loss: {aux_loss.item():.4f}")
    
    params = sum(p.numel() for p in moe.parameters())
    print(f"Parameters: {params:,}")
    
    print("✅ MoE test passed!")
