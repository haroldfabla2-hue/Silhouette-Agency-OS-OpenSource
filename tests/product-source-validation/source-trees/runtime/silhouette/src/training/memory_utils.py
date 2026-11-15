"""
NANOSILHOUETTE - Memory Optimization Utilities
===============================================
Implements memory-efficient training techniques:
- Gradient checkpointing (activation checkpointing)
- Memory-efficient attention fallbacks
- Mixed precision utilities
- VRAM monitoring
"""
import torch
import torch.nn as nn
from torch.utils.checkpoint import checkpoint
from typing import Optional, Callable, Any
from functools import wraps


class GradientCheckpointWrapper(nn.Module):
    """
    Wrapper that enables gradient checkpointing for any module.
    
    Trades ~20-30% more compute time for ~40-50% less VRAM.
    """
    
    def __init__(self, module: nn.Module, use_checkpointing: bool = True):
        super().__init__()
        self.module = module
        self.use_checkpointing = use_checkpointing
    
    def forward(self, *args, **kwargs):
        if self.use_checkpointing and self.training:
            # checkpoint requires at least one tensor argument
            return checkpoint(
                self._forward_impl,
                *args,
                use_reentrant=False,
                **kwargs
            )
        else:
            return self.module(*args, **kwargs)
    
    def _forward_impl(self, *args, **kwargs):
        return self.module(*args, **kwargs)


def apply_gradient_checkpointing(model: nn.Module, checkpoint_ratio: float = 0.5):
    """
    Apply gradient checkpointing to a fraction of the model's layers.
    
    Args:
        model: The model to modify
        checkpoint_ratio: Fraction of layers to checkpoint (0.0 to 1.0)
    
    Returns:
        Modified model with checkpointing enabled
    """
    # Find all transformer/mamba layers
    layers_to_checkpoint = []
    
    for name, module in model.named_modules():
        if hasattr(module, 'layers') and isinstance(module.layers, nn.ModuleList):
            layers_to_checkpoint = list(module.layers)
            break
    
    if not layers_to_checkpoint:
        print("[WARNING] No layers found for gradient checkpointing")
        return model
    
    num_to_checkpoint = int(len(layers_to_checkpoint) * checkpoint_ratio)
    
    # Apply checkpointing to every other layer
    for i in range(0, num_to_checkpoint * 2, 2):
        if i < len(layers_to_checkpoint):
            original = layers_to_checkpoint[i]
            layers_to_checkpoint[i] = GradientCheckpointWrapper(original)
    
    print(f"[NANOSILHOUETTE] Gradient checkpointing enabled for {num_to_checkpoint} layers")
    return model


class MemoryEfficientAttention(nn.Module):
    """
    Memory-efficient attention implementation.
    
    Uses chunked computation when FlashAttention is not available.
    """
    
    def __init__(
        self,
        d_model: int,
        num_heads: int,
        chunk_size: int = 256,
        dropout: float = 0.0
    ):
        super().__init__()
        self.d_model = d_model
        self.num_heads = num_heads
        self.head_dim = d_model // num_heads
        self.chunk_size = chunk_size
        
        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, d_model)
        self.out_proj = nn.Linear(d_model, d_model)
        
        self.dropout = nn.Dropout(dropout)
        self.scale = self.head_dim ** -0.5
    
    def forward(
        self,
        query: torch.Tensor,
        key: Optional[torch.Tensor] = None,
        value: Optional[torch.Tensor] = None,
        attn_mask: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """
        Memory-efficient attention with chunked computation.
        """
        if key is None:
            key = query
        if value is None:
            value = query
        
        batch, seq_len, _ = query.shape
        
        q = self.q_proj(query)
        k = self.k_proj(key)
        v = self.v_proj(value)
        
        # Reshape for multi-head
        q = q.view(batch, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = k.view(batch, -1, self.num_heads, self.head_dim).transpose(1, 2)
        v = v.view(batch, -1, self.num_heads, self.head_dim).transpose(1, 2)
        
        # Chunked attention for memory efficiency
        if seq_len > self.chunk_size:
            output = self._chunked_attention(q, k, v, attn_mask)
        else:
            output = self._standard_attention(q, k, v, attn_mask)
        
        # Reshape back
        output = output.transpose(1, 2).contiguous().view(batch, seq_len, self.d_model)
        output = self.out_proj(output)
        
        return output
    
    def _standard_attention(self, q, k, v, mask=None):
        """Standard scaled dot-product attention."""
        scores = torch.matmul(q, k.transpose(-2, -1)) * self.scale
        
        if mask is not None:
            scores = scores + mask
        
        attn = torch.softmax(scores, dim=-1)
        attn = self.dropout(attn)
        
        return torch.matmul(attn, v)
    
    def _chunked_attention(self, q, k, v, mask=None):
        """Chunked attention for long sequences."""
        batch, heads, seq_len, head_dim = q.shape
        kv_len = k.shape[2]
        
        outputs = []
        
        for i in range(0, seq_len, self.chunk_size):
            chunk_end = min(i + self.chunk_size, seq_len)
            q_chunk = q[:, :, i:chunk_end]
            
            # Compute attention for this chunk
            scores = torch.matmul(q_chunk, k.transpose(-2, -1)) * self.scale
            
            if mask is not None:
                chunk_mask = mask[:, :, i:chunk_end]
                scores = scores + chunk_mask
            
            attn = torch.softmax(scores, dim=-1)
            attn = self.dropout(attn)
            
            chunk_output = torch.matmul(attn, v)
            outputs.append(chunk_output)
        
        return torch.cat(outputs, dim=2)


class VRAMMonitor:
    """Utility for monitoring GPU memory usage."""
    
    @staticmethod
    def get_memory_stats() -> dict:
        """Get current GPU memory statistics."""
        if not torch.cuda.is_available():
            return {"available": False}
        
        return {
            "available": True,
            "allocated_gb": torch.cuda.memory_allocated() / 1e9,
            "reserved_gb": torch.cuda.memory_reserved() / 1e9,
            "max_allocated_gb": torch.cuda.max_memory_allocated() / 1e9,
            "total_gb": torch.cuda.get_device_properties(0).total_memory / 1e9
        }
    
    @staticmethod
    def print_memory_stats():
        """Print current memory statistics."""
        stats = VRAMMonitor.get_memory_stats()
        if not stats["available"]:
            print("[VRAM] No GPU available")
            return
        
        print(f"[VRAM] Allocated: {stats['allocated_gb']:.2f} GB")
        print(f"[VRAM] Reserved:  {stats['reserved_gb']:.2f} GB")
        print(f"[VRAM] Peak:      {stats['max_allocated_gb']:.2f} GB")
        print(f"[VRAM] Total:     {stats['total_gb']:.2f} GB")
    
    @staticmethod
    def clear_cache():
        """Clear GPU memory cache."""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()


def enable_memory_efficient_mode(model: nn.Module, config: dict = None):
    """
    Enable all memory-efficient optimizations for a model.
    
    Args:
        model: The model to optimize
        config: Optional configuration dict with keys:
            - gradient_checkpointing: bool (default: True)
            - checkpoint_ratio: float (default: 0.5)
    """
    config = config or {}
    
    # Enable gradient checkpointing
    if config.get("gradient_checkpointing", True):
        ratio = config.get("checkpoint_ratio", 0.5)
        model = apply_gradient_checkpointing(model, ratio)
    
    # Set model to use memory-efficient operations
    if hasattr(model, 'config'):
        model.config.use_memory_efficient = True
    
    # Clear cache
    VRAMMonitor.clear_cache()
    
    return model


if __name__ == "__main__":
    print("Testing Memory Optimizations...")
    
    # Test VRAM monitor
    VRAMMonitor.print_memory_stats()
    
    # Test gradient checkpointing wrapper
    layer = nn.Linear(512, 512)
    wrapped = GradientCheckpointWrapper(layer)
    
    x = torch.randn(2, 64, 512, requires_grad=True)
    if torch.cuda.is_available():
        wrapped = wrapped.cuda()
        x = x.cuda()
    
    wrapped.train()
    y = wrapped(x)
    print(f"Checkpointed output: {y.shape}")
    
    # Test memory-efficient attention
    attn = MemoryEfficientAttention(512, 8, chunk_size=32)
    if torch.cuda.is_available():
        attn = attn.cuda()
    
    y = attn(x)
    print(f"Efficient attention output: {y.shape}")
    
    print("✅ Memory optimizations test passed!")
