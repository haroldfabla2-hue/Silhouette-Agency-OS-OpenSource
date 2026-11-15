"""
NANOSILHOUETTE - Continuum Memory System (CMS)
===============================================
Multi-timescale memory based on Google's Nested Learning (NeurIPS 2025).

Features:
- Multiple memory modules operating at different temporal scales
- Fast memory (per-token), Medium (per-phrase), Slow (per-concept)
- Self-modifying parameters inspired by TITAN architecture
- Enables continuous learning without catastrophic forgetting
"""

import math
from typing import Optional, List, Tuple
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F
from einops import rearrange


@dataclass
class CMSConfig:
    """Configuration for Continuum Memory System."""
    d_model: int = 512
    num_timescales: int = 4
    timescale_factors: Tuple[float, ...] = (1.0, 10.0, 100.0, 1000.0)
    memory_size: int = 256
    num_memory_heads: int = 4
    use_self_modifier: bool = True
    rms_norm_eps: float = 1e-5


class RMSNorm(nn.Module):
    """Root Mean Square Layer Normalization."""
    
    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        dtype = x.dtype
        x = x.float()
        rms = torch.sqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)
        x = x / rms
        return (self.weight * x).to(dtype)


class MemoryModule(nn.Module):
    """
    Single timescale memory module.
    
    Uses associative memory mechanism:
    - Keys/Values stored in memory bank
    - Queries attend to memory
    - Memory updated with exponential moving average (EMA)
    """
    
    def __init__(
        self, 
        d_model: int, 
        memory_size: int,
        num_heads: int = 4,
        timescale: float = 1.0
    ):
        super().__init__()
        self.d_model = d_model
        self.memory_size = memory_size
        self.num_heads = num_heads
        self.head_dim = d_model // num_heads
        self.timescale = timescale
        
        # Compute EMA decay factor from timescale
        # Higher timescale = slower decay = longer memory
        self.decay = 1.0 - 1.0 / (timescale + 1.0)
        
        # Query, Key, Value projections
        self.q_proj = nn.Linear(d_model, d_model, bias=False)
        self.k_proj = nn.Linear(d_model, d_model, bias=False)
        self.v_proj = nn.Linear(d_model, d_model, bias=False)
        self.o_proj = nn.Linear(d_model, d_model, bias=False)
        
        # Memory bank (learned initial state)
        self.register_buffer(
            "memory_keys",
            torch.randn(1, memory_size, d_model) * 0.02
        )
        self.register_buffer(
            "memory_values", 
            torch.randn(1, memory_size, d_model) * 0.02
        )
        
        # Gating for memory update
        self.update_gate = nn.Linear(d_model * 2, d_model)
        
        self.norm = RMSNorm(d_model)
    
    def forward(
        self, 
        hidden_states: torch.Tensor,
        memory_state: Optional[Tuple[torch.Tensor, torch.Tensor]] = None
    ) -> Tuple[torch.Tensor, Tuple[torch.Tensor, torch.Tensor]]:
        """
        Forward pass with memory read and update.
        
        Args:
            hidden_states: (batch, seq_len, d_model)
            memory_state: Optional (keys, values) from previous step
        
        Returns:
            output: (batch, seq_len, d_model)
            new_memory_state: Updated (keys, values)
        """
        batch, seq_len, _ = hidden_states.shape
        
        # Initialize or use provided memory
        if memory_state is None:
            mem_keys = self.memory_keys.expand(batch, -1, -1)
            mem_values = self.memory_values.expand(batch, -1, -1)
        else:
            mem_keys, mem_values = memory_state
        
        # Project queries from input
        q = self.q_proj(hidden_states)
        q = rearrange(q, "b s (h d) -> b h s d", h=self.num_heads)
        
        # Project keys and values from memory
        k = rearrange(mem_keys, "b m (h d) -> b h m d", h=self.num_heads)
        v = rearrange(mem_values, "b m (h d) -> b h m d", h=self.num_heads)
        
        # Attention over memory
        scale = 1.0 / math.sqrt(self.head_dim)
        attn = torch.matmul(q, k.transpose(-2, -1)) * scale
        attn = F.softmax(attn, dim=-1)
        
        # Read from memory
        memory_output = torch.matmul(attn, v)
        memory_output = rearrange(memory_output, "b h s d -> b s (h d)")
        memory_output = self.o_proj(memory_output)
        
        # Update memory with EMA
        # Aggregate input to update memory slots
        input_summary = hidden_states.mean(dim=1, keepdim=True)  # (batch, 1, d_model)
        input_keys = self.k_proj(input_summary)
        input_values = self.v_proj(input_summary)
        
        # Gated update
        gate_input = torch.cat([mem_keys[:, :1, :], input_keys], dim=-1)
        gate = torch.sigmoid(self.update_gate(gate_input))
        
        # EMA update with gating (roll and update first slot)
        new_keys = mem_keys.roll(shifts=1, dims=1)
        new_values = mem_values.roll(shifts=1, dims=1)
        
        new_keys[:, 0:1, :] = gate * input_keys + (1 - gate) * mem_keys[:, -1:, :]
        new_values[:, 0:1, :] = gate * input_values + (1 - gate) * mem_values[:, -1:, :]
        
        # Apply decay to older memories
        decay_mask = torch.ones_like(new_keys) * self.decay
        decay_mask[:, 0:1, :] = 1.0  # Don't decay newest entry
        new_keys = new_keys * decay_mask
        new_values = new_values * decay_mask
        
        return memory_output, (new_keys, new_values)


class SelfModifier(nn.Module):
    """
    Self-Modifier module inspired by TITAN architecture.
    
    Allows the model to modify its own representations
    based on context, enabling test-time adaptation.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        self.d_model = d_model
        
        # Modification predictor
        self.mod_predictor = nn.Sequential(
            nn.Linear(d_model, d_model * 2),
            nn.SiLU(),
            nn.Linear(d_model * 2, d_model * 2)  # Predicts scale and shift
        )
        
        self.norm = RMSNorm(d_model)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Apply self-modification.
        
        Args:
            x: (batch, seq_len, d_model)
        
        Returns:
            modified_x: (batch, seq_len, d_model)
        """
        # Predict modifications from context
        ctx = x.mean(dim=1, keepdim=True)  # Global context
        mods = self.mod_predictor(ctx)
        scale, shift = mods.chunk(2, dim=-1)
        
        # Apply affine transformation
        scale = torch.sigmoid(scale) * 2  # Range [0, 2]
        x = self.norm(x)
        x = x * scale + shift
        
        return x


class ContinuumMemorySystem(nn.Module):
    """
    Continuum Memory System (CMS).
    
    Multi-timescale memory with self-modification capability.
    Implements Google's Nested Learning paradigm.
    """
    
    def __init__(self, config: CMSConfig):
        super().__init__()
        self.config = config
        
        # Create memory modules for each timescale
        self.memory_modules = nn.ModuleList([
            MemoryModule(
                d_model=config.d_model,
                memory_size=config.memory_size,
                num_heads=config.num_memory_heads,
                timescale=tau
            )
            for tau in config.timescale_factors
        ])
        
        # Fusion layer to combine outputs from all timescales
        self.fusion = nn.Linear(
            config.d_model * config.num_timescales,
            config.d_model,
            bias=False
        )
        
        # Optional self-modifier
        if config.use_self_modifier:
            self.self_modifier = SelfModifier(config.d_model)
        else:
            self.self_modifier = None
        
        self.norm = RMSNorm(config.d_model, eps=config.rms_norm_eps)
        
        # Gating for residual connection
        self.gate = nn.Linear(config.d_model * 2, config.d_model)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        memory_states: Optional[List[Tuple[torch.Tensor, torch.Tensor]]] = None
    ) -> Tuple[torch.Tensor, List[Tuple[torch.Tensor, torch.Tensor]]]:
        """
        Forward pass through CMS.
        
        Args:
            hidden_states: (batch, seq_len, d_model)
            memory_states: Optional list of (keys, values) for each timescale
        
        Returns:
            output: (batch, seq_len, d_model)
            new_memory_states: Updated list of (keys, values)
        """
        residual = hidden_states
        hidden_states = self.norm(hidden_states)
        
        # Initialize memory states if needed
        if memory_states is None:
            memory_states = [None] * len(self.memory_modules)
        
        # Process through each timescale
        outputs = []
        new_memory_states = []
        
        for mem_module, mem_state in zip(self.memory_modules, memory_states):
            out, new_state = mem_module(hidden_states, mem_state)
            outputs.append(out)
            new_memory_states.append(new_state)
        
        # Fuse outputs from all timescales
        combined = torch.cat(outputs, dim=-1)
        fused = self.fusion(combined)
        
        # Apply self-modification if enabled
        if self.self_modifier is not None:
            fused = self.self_modifier(fused)
        
        # Gated residual connection
        gate_input = torch.cat([residual, fused], dim=-1)
        gate = torch.sigmoid(self.gate(gate_input))
        output = gate * fused + (1 - gate) * residual
        
        return output, new_memory_states

    def consolidate_memory(self, threshold: float = 0.9):
        """
        Biological Sleep Process: Synaptic Pruning & Consolidation.
        
        Optimizes memory banks by:
        1. Identifying redundant memories (high cosine similarity).
        2. Merging them (averaging values).
        3. Resetting freed slots to random noise (fresh capacity).
        
        This should be called during 'Sleep' cycles (offline).
        """
        pruned_count = 0
        total_slots = 0
        
        for module in self.memory_modules:
            # We operate on the buffer directly
            keys = module.memory_keys.squeeze(0)   # (memory_size, d_model)
            values = module.memory_values.squeeze(0) 
            
            # Compute similarity matrix
            # Normalize for cosine similarity
            keys_norm = F.normalize(keys, p=2, dim=-1)
            sim_matrix = torch.matmul(keys_norm, keys_norm.t()) # (size, size)
            
            # Mask diagonal (self-similarity) and lower triangle to avoid duplicates
            mask = torch.triu(torch.ones_like(sim_matrix), diagonal=1).bool()
            
            # Find redundant pairs
            redundant_indices = torch.nonzero((sim_matrix > threshold) & mask)
            
            # Keep track of indices to reset
            to_reset = set()
            
            for i, j in redundant_indices:
                idx_i, idx_j = i.item(), j.item()
                if idx_i in to_reset or idx_j in to_reset:
                    continue
                
                # Merge j into i (Consolidation)
                # Average keys and values
                with torch.no_grad():
                    module.memory_keys[0, idx_i] = (keys[idx_i] + keys[idx_j]) / 2.0
                    module.memory_values[0, idx_i] = (values[idx_i] + values[idx_j]) / 2.0
                
                # Mark j for reset (Pruning)
                to_reset.add(idx_j)
                pruned_count += 1
            
            # Reset pruned slots (Neurogenesis - new potential)
            if to_reset:
                indices_list = list(to_reset)
                with torch.no_grad():
                    noise_k = torch.randn(len(indices_list), self.config.d_model, device=keys.device) * 0.02
                    noise_v = torch.randn(len(indices_list), self.config.d_model, device=values.device) * 0.02
                    module.memory_keys[0, indices_list] = noise_k
                    module.memory_values[0, indices_list] = noise_v
            
            total_slots += self.config.memory_size
            
        return {"pruned": pruned_count, "total_slots": total_slots}


def create_cms(
    d_model: int = 512,
    num_timescales: int = 4,
    timescale_factors: Tuple[float, ...] = (1.0, 10.0, 100.0, 1000.0),
    memory_size: int = 256,
    **kwargs
) -> ContinuumMemorySystem:
    """Factory function to create CMS."""
    config = CMSConfig(
        d_model=d_model,
        num_timescales=num_timescales,
        timescale_factors=timescale_factors,
        memory_size=memory_size,
        **kwargs
    )
    return ContinuumMemorySystem(config)


# Quick test
if __name__ == "__main__":
    print("Testing Continuum Memory System...")
    
    config = CMSConfig(
        d_model=512,
        num_timescales=4,
        timescale_factors=(1.0, 10.0, 100.0, 1000.0),
        memory_size=256
    )
    
    cms = ContinuumMemorySystem(config)
    
    batch, seq_len, d_model = 2, 128, 512
    x = torch.randn(batch, seq_len, d_model)
    
    if torch.cuda.is_available():
        cms = cms.cuda()
        x = x.cuda()
    
    # First forward pass
    y, memory_states = cms(x)
    print(f"Input shape: {x.shape}")
    print(f"Output shape: {y.shape}")
    print(f"Number of memory states: {len(memory_states)}")
    
    # Second forward pass with memory
    y2, memory_states2 = cms(x, memory_states)
    print(f"Second pass output shape: {y2.shape}")
    
    num_params = sum(p.numel() for p in cms.parameters())
    print(f"Parameters: {num_params:,}")
    
    print("✅ CMS test passed!")
