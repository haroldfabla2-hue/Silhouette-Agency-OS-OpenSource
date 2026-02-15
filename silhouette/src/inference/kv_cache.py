"""
NANOSILHOUETTE - KV Cache Optimization
========================================
Implements efficient KV cache with:
- Sliding window attention
- Attention sinks (StreamingLLM)
- Dynamic cache compression
"""
import torch
import torch.nn as nn
from typing import Optional, Tuple, List
from dataclasses import dataclass


@dataclass
class KVCacheConfig:
    """Configuration for KV cache."""
    max_cache_size: int = 2048  # Maximum cache entries
    window_size: int = 512  # Sliding window size
    num_sink_tokens: int = 4  # Attention sink tokens to retain
    compression_ratio: float = 0.5  # For dynamic compression


class KVCache:
    """
    Efficient Key-Value cache with sliding window.
    
    Implements StreamingLLM's attention sinks for stable
    long-sequence generation.
    """
    
    def __init__(
        self,
        num_layers: int,
        num_heads: int,
        head_dim: int,
        config: Optional[KVCacheConfig] = None,
        dtype: torch.dtype = torch.float16,
        device: str = "cuda"
    ):
        self.num_layers = num_layers
        self.num_heads = num_heads
        self.head_dim = head_dim
        self.config = config or KVCacheConfig()
        self.dtype = dtype
        self.device = device
        
        # Initialize empty caches
        self.key_cache: List[Optional[torch.Tensor]] = [None] * num_layers
        self.value_cache: List[Optional[torch.Tensor]] = [None] * num_layers
        
        # Track positions
        self.seq_len = 0
    
    def update(
        self,
        layer_idx: int,
        key: torch.Tensor,
        value: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Update cache with new key-value pairs.
        
        Implements sliding window with attention sinks.
        
        Args:
            layer_idx: Layer index
            key: New keys (batch, num_heads, seq, head_dim)
            value: New values (batch, num_heads, seq, head_dim)
        
        Returns:
            Full key and value tensors for attention
        """
        batch_size = key.shape[0]
        new_seq_len = key.shape[2]
        
        if self.key_cache[layer_idx] is None:
            # First update
            self.key_cache[layer_idx] = key
            self.value_cache[layer_idx] = value
        else:
            # Append new KV pairs
            self.key_cache[layer_idx] = torch.cat(
                [self.key_cache[layer_idx], key], dim=2
            )
            self.value_cache[layer_idx] = torch.cat(
                [self.value_cache[layer_idx], value], dim=2
            )
        
        # Apply sliding window with attention sinks
        current_len = self.key_cache[layer_idx].shape[2]
        
        if current_len > self.config.max_cache_size:
            self._apply_sliding_window(layer_idx)
        
        self.seq_len = self.key_cache[layer_idx].shape[2]
        
        return self.key_cache[layer_idx], self.value_cache[layer_idx]
    
    def _apply_sliding_window(self, layer_idx: int):
        """
        Apply sliding window with attention sinks.
        
        Keeps:
        - First N tokens (attention sinks)
        - Last W tokens (recent context)
        """
        sink_tokens = self.config.num_sink_tokens
        window_size = self.config.window_size
        
        # Get sink tokens (first N)
        sink_keys = self.key_cache[layer_idx][:, :, :sink_tokens, :]
        sink_values = self.value_cache[layer_idx][:, :, :sink_tokens, :]
        
        # Get window tokens (last W)
        window_keys = self.key_cache[layer_idx][:, :, -window_size:, :]
        window_values = self.value_cache[layer_idx][:, :, -window_size:, :]
        
        # Combine sinks + window
        self.key_cache[layer_idx] = torch.cat([sink_keys, window_keys], dim=2)
        self.value_cache[layer_idx] = torch.cat([sink_values, window_values], dim=2)
    
    def get(
        self,
        layer_idx: int
    ) -> Tuple[Optional[torch.Tensor], Optional[torch.Tensor]]:
        """Get cached key-value pairs for a layer."""
        return self.key_cache[layer_idx], self.value_cache[layer_idx]
    
    def clear(self):
        """Clear all caches."""
        self.key_cache = [None] * self.num_layers
        self.value_cache = [None] * self.num_layers
        self.seq_len = 0
    
    def get_memory_usage(self) -> dict:
        """Get memory usage statistics."""
        total_bytes = 0
        for k, v in zip(self.key_cache, self.value_cache):
            if k is not None:
                total_bytes += k.element_size() * k.nelement()
            if v is not None:
                total_bytes += v.element_size() * v.nelement()
        
        return {
            "total_bytes": total_bytes,
            "total_mb": total_bytes / 1e6,
            "seq_len": self.seq_len,
            "max_cache_size": self.config.max_cache_size
        }


class SlidingWindowAttention(nn.Module):
    """
    Sliding Window Attention with KV Cache.
    
    Enables processing of sequences longer than context window.
    """
    
    def __init__(
        self,
        d_model: int,
        num_heads: int,
        window_size: int = 512,
        num_sink_tokens: int = 4
    ):
        super().__init__()
        self.d_model = d_model
        self.num_heads = num_heads
        self.head_dim = d_model // num_heads
        self.window_size = window_size
        self.num_sink_tokens = num_sink_tokens
        
        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, d_model)
        self.out_proj = nn.Linear(d_model, d_model)
        
        self.scale = self.head_dim ** -0.5
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        kv_cache: Optional[KVCache] = None,
        layer_idx: int = 0,
        attention_mask: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, Optional[KVCache]]:
        """
        Forward pass with sliding window attention.
        
        Args:
            hidden_states: (batch, seq, d_model)
            kv_cache: Optional KV cache for incremental decoding
            layer_idx: Layer index for cache
            attention_mask: Optional attention mask
        
        Returns:
            output: (batch, seq, d_model)
            kv_cache: Updated cache
        """
        batch, seq_len, _ = hidden_states.shape
        
        # Project to Q, K, V
        q = self.q_proj(hidden_states)
        k = self.k_proj(hidden_states)
        v = self.v_proj(hidden_states)
        
        # Reshape for multi-head
        q = q.view(batch, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = k.view(batch, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        v = v.view(batch, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        
        # Update cache
        if kv_cache is not None:
            k, v = kv_cache.update(layer_idx, k, v)
        
        # Compute attention
        attn_scores = torch.matmul(q, k.transpose(-2, -1)) * self.scale
        
        # Create sliding window mask
        kv_len = k.shape[2]
        if kv_len > self.window_size + self.num_sink_tokens:
            window_mask = self._create_sliding_window_mask(
                seq_len, kv_len, q.device
            )
            attn_scores = attn_scores + window_mask
        
        # Causal mask
        if attention_mask is not None:
            attn_scores = attn_scores + attention_mask
        
        attn_probs = torch.softmax(attn_scores, dim=-1)
        output = torch.matmul(attn_probs, v)
        
        # Reshape back
        output = output.transpose(1, 2).contiguous().view(batch, seq_len, self.d_model)
        output = self.out_proj(output)
        
        return output, kv_cache
    
    def _create_sliding_window_mask(
        self,
        q_len: int,
        kv_len: int,
        device: torch.device
    ) -> torch.Tensor:
        """Create sliding window attention mask."""
        # Allow attention to:
        # 1. Sink tokens (first N)
        # 2. Tokens within window
        mask = torch.zeros(q_len, kv_len, device=device)
        
        for i in range(q_len):
            # Current position in KV cache
            pos = kv_len - q_len + i
            
            # Mask positions outside window (except sinks)
            for j in range(kv_len):
                if j >= self.num_sink_tokens and j < pos - self.window_size:
                    mask[i, j] = float('-inf')
        
        return mask.unsqueeze(0).unsqueeze(0)  # Add batch and head dims


class CompressedKVCache(KVCache):
    """
    KV Cache with dynamic compression.
    
    Compresses less important KV pairs to reduce memory.
    """
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.importance_scores: List[Optional[torch.Tensor]] = [None] * self.num_layers
    
    def update_with_importance(
        self,
        layer_idx: int,
        key: torch.Tensor,
        value: torch.Tensor,
        attention_scores: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Update cache with importance-based compression.
        
        Uses attention scores to determine which KV pairs to keep.
        """
        # Update normally first
        k, v = self.update(layer_idx, key, value)
        
        # Track importance (average attention received)
        importance = attention_scores.mean(dim=(0, 1, 2))  # Average across batch, heads, queries
        
        if self.importance_scores[layer_idx] is None:
            self.importance_scores[layer_idx] = importance
        else:
            # Combine with existing importance
            old_len = self.importance_scores[layer_idx].shape[0]
            new_importance = torch.cat([
                self.importance_scores[layer_idx],
                importance
            ])
            self.importance_scores[layer_idx] = new_importance
        
        # Compress if too large
        current_len = k.shape[2]
        if current_len > self.config.max_cache_size:
            self._compress_by_importance(layer_idx)
        
        return self.key_cache[layer_idx], self.value_cache[layer_idx]
    
    def _compress_by_importance(self, layer_idx: int):
        """Compress cache by keeping most important entries."""
        target_size = int(self.config.max_cache_size * self.config.compression_ratio)
        current_len = self.key_cache[layer_idx].shape[2]
        
        # Always keep sink tokens
        sink_len = self.config.num_sink_tokens
        
        if current_len <= target_size:
            return
        
        # Get importance scores
        scores = self.importance_scores[layer_idx]
        
        if scores is None or len(scores) != current_len:
            # Fallback to sliding window
            self._apply_sliding_window(layer_idx)
            return
        
        # Keep sinks + most important
        remaining_size = target_size - sink_len
        
        # Don't consider sinks for importance ranking
        non_sink_scores = scores[sink_len:]
        _, top_indices = torch.topk(non_sink_scores, remaining_size)
        top_indices = top_indices + sink_len  # Adjust for sink offset
        
        # Combine sink indices with important indices
        sink_indices = torch.arange(sink_len, device=scores.device)
        keep_indices = torch.cat([sink_indices, top_indices])
        keep_indices = torch.sort(keep_indices)[0]  # Sort to maintain order
        
        # Apply selection
        self.key_cache[layer_idx] = self.key_cache[layer_idx][:, :, keep_indices, :]
        self.value_cache[layer_idx] = self.value_cache[layer_idx][:, :, keep_indices, :]
        self.importance_scores[layer_idx] = self.importance_scores[layer_idx][keep_indices]


def create_kv_cache(
    num_layers: int,
    num_heads: int,
    head_dim: int,
    max_cache_size: int = 2048,
    window_size: int = 512,
    compressed: bool = False,
    device: str = "cuda"
) -> KVCache:
    """Factory function for KV cache."""
    config = KVCacheConfig(
        max_cache_size=max_cache_size,
        window_size=window_size
    )
    
    if compressed:
        return CompressedKVCache(
            num_layers, num_heads, head_dim, config, device=device
        )
    else:
        return KVCache(
            num_layers, num_heads, head_dim, config, device=device
        )


if __name__ == "__main__":
    print("Testing KV Cache...")
    
    # Test basic KV cache
    cache = create_kv_cache(
        num_layers=12,
        num_heads=8,
        head_dim=64,
        max_cache_size=100,
        window_size=50,
        device="cpu"
    )
    
    # Simulate adding tokens
    for i in range(10):
        k = torch.randn(1, 8, 20, 64)  # 20 tokens per step
        v = torch.randn(1, 8, 20, 64)
        cache.update(0, k, v)
    
    print(f"Cache memory: {cache.get_memory_usage()}")
    
    # Test sliding window attention
    swa = SlidingWindowAttention(512, 8, window_size=256)
    x = torch.randn(2, 64, 512)
    
    kv_cache = create_kv_cache(1, 8, 64, device="cpu")
    output, _ = swa(x, kv_cache, layer_idx=0)
    print(f"SWA output: {output.shape}")
    
    print("✅ KV Cache test passed!")
