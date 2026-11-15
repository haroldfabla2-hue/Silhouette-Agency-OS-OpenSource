"""
NANOSILHOUETTE - Transformer Block with GQA and RoPE
=====================================================
Efficient Transformer implementation featuring:
- Grouped Query Attention (GQA) for memory efficiency
- Rotary Position Embeddings (RoPE) for position encoding
- FlashAttention-2 support when available
- Pre-norm architecture (more stable training)
"""

import math
from typing import Optional, Tuple
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F
from einops import rearrange, repeat

# Try to import FlashAttention
try:
    from flash_attn import flash_attn_func
    FLASH_ATTN_AVAILABLE = True
except ImportError:
    FLASH_ATTN_AVAILABLE = False
    print("[NANOSILHOUETTE] flash-attn not found. Using standard attention.")


@dataclass
class TransformerConfig:
    """Configuration for Transformer block."""
    d_model: int = 512
    num_heads: int = 8
    num_kv_heads: int = 2      # For GQA: num_heads // num_kv_heads queries per KV head
    intermediate_size: int = 1376  # ~2.7x for SwiGLU
    max_position_embeddings: int = 2048
    rotary_dim: int = 64       # Usually d_model // num_heads
    rotary_base: float = 10000.0
    attention_dropout: float = 0.0
    hidden_dropout: float = 0.0
    rms_norm_eps: float = 1e-5
    use_flash_attention: bool = True
    bias: bool = False


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


class RotaryEmbedding(nn.Module):
    """
    Rotary Position Embeddings (RoPE).
    
    Encodes position through rotation in embedding space,
    enabling length generalization.
    """
    
    def __init__(
        self, 
        dim: int, 
        max_position_embeddings: int = 2048,
        base: float = 10000.0,
        device: Optional[torch.device] = None
    ):
        super().__init__()
        self.dim = dim
        self.max_position_embeddings = max_position_embeddings
        self.base = base
        
        # Compute inverse frequencies
        inv_freq = 1.0 / (
            self.base ** (torch.arange(0, self.dim, 2, device=device).float() / self.dim)
        )
        self.register_buffer("inv_freq", inv_freq, persistent=False)
        
        # Build cos/sin cache
        self._set_cos_sin_cache(max_position_embeddings, device)
    
    def _set_cos_sin_cache(self, seq_len: int, device: Optional[torch.device] = None):
        self.max_seq_len_cached = seq_len
        t = torch.arange(seq_len, device=device, dtype=self.inv_freq.dtype)
        freqs = torch.outer(t, self.inv_freq)
        emb = torch.cat((freqs, freqs), dim=-1)
        self.register_buffer("cos_cached", emb.cos(), persistent=False)
        self.register_buffer("sin_cached", emb.sin(), persistent=False)
    
    def forward(self, x: torch.Tensor, seq_len: int) -> Tuple[torch.Tensor, torch.Tensor]:
        # Extend cache if needed
        if seq_len > self.max_seq_len_cached:
            self._set_cos_sin_cache(seq_len, x.device)
        
        return (
            self.cos_cached[:seq_len],
            self.sin_cached[:seq_len]
        )


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    """Rotate half the hidden dims of the input."""
    x1 = x[..., : x.shape[-1] // 2]
    x2 = x[..., x.shape[-1] // 2 :]
    return torch.cat((-x2, x1), dim=-1)


def apply_rotary_pos_emb(
    q: torch.Tensor, 
    k: torch.Tensor, 
    cos: torch.Tensor, 
    sin: torch.Tensor
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Apply rotary position embeddings to queries and keys."""
    # q/k: (batch, heads, seq, head_dim)
    # cos/sin: (seq, dim) where dim = head_dim
    
    # Get the rotary dimension (might be smaller than head_dim)
    rotary_dim = cos.shape[-1]
    
    # Split q and k into rotary and non-rotary parts
    q_rot = q[..., :rotary_dim]
    q_pass = q[..., rotary_dim:]
    k_rot = k[..., :rotary_dim]
    k_pass = k[..., rotary_dim:]
    
    # Reshape cos/sin: (seq, dim) -> (1, 1, seq, dim)
    cos = cos.unsqueeze(0).unsqueeze(0)
    sin = sin.unsqueeze(0).unsqueeze(0)
    
    # Apply rotation
    q_embed = (q_rot * cos) + (rotate_half(q_rot) * sin)
    k_embed = (k_rot * cos) + (rotate_half(k_rot) * sin)
    
    # Concatenate back
    q_embed = torch.cat([q_embed, q_pass], dim=-1)
    k_embed = torch.cat([k_embed, k_pass], dim=-1)
    
    return q_embed, k_embed


class GroupedQueryAttention(nn.Module):
    """
    Grouped Query Attention (GQA).
    
    Each group of query heads shares a single key-value head,
    reducing KV cache size while maintaining quality.
    """
    
    def __init__(self, config: TransformerConfig):
        super().__init__()
        self.config = config
        self.d_model = config.d_model
        self.num_heads = config.num_heads
        self.num_kv_heads = config.num_kv_heads
        self.head_dim = config.d_model // config.num_heads
        self.num_groups = self.num_heads // self.num_kv_heads
        
        self.q_proj = nn.Linear(config.d_model, config.num_heads * self.head_dim, bias=config.bias)
        self.k_proj = nn.Linear(config.d_model, config.num_kv_heads * self.head_dim, bias=config.bias)
        self.v_proj = nn.Linear(config.d_model, config.num_kv_heads * self.head_dim, bias=config.bias)
        self.o_proj = nn.Linear(config.num_heads * self.head_dim, config.d_model, bias=config.bias)
        
        self.rotary_emb = RotaryEmbedding(
            self.head_dim,
            max_position_embeddings=config.max_position_embeddings,
            base=config.rotary_base
        )
        
        self.attention_dropout = config.attention_dropout
        self.use_flash = config.use_flash_attention and FLASH_ATTN_AVAILABLE
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        position_ids: Optional[torch.Tensor] = None,
        past_key_value: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        use_cache: bool = False
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        batch, seq_len, _ = hidden_states.shape
        
        # Project to Q, K, V
        q = self.q_proj(hidden_states)
        k = self.k_proj(hidden_states)
        v = self.v_proj(hidden_states)
        
        # Reshape: (batch, seq, heads, head_dim)
        q = q.view(batch, seq_len, self.num_heads, self.head_dim)
        k = k.view(batch, seq_len, self.num_kv_heads, self.head_dim)
        v = v.view(batch, seq_len, self.num_kv_heads, self.head_dim)
        
        # Apply rotary embeddings
        cos, sin = self.rotary_emb(q, seq_len)
        q = rearrange(q, "b s h d -> b h s d")
        k = rearrange(k, "b s h d -> b h s d")
        q, k = apply_rotary_pos_emb(q, k, cos, sin)
        
        # Handle KV cache
        if past_key_value is not None:
            past_k, past_v = past_key_value
            k = torch.cat([past_k, k], dim=2)
            v = torch.cat([past_v, rearrange(v, "b s h d -> b h s d")], dim=2)
        else:
            v = rearrange(v, "b s h d -> b h s d")
        
        if use_cache:
            new_cache = (k, v)
        else:
            new_cache = None
        
        # Expand KV for GQA: repeat each KV head for its group of query heads
        k = repeat(k, "b h s d -> b (h g) s d", g=self.num_groups)
        v = repeat(v, "b h s d -> b (h g) s d", g=self.num_groups)
        
        # Compute attention
        if self.use_flash and q.is_cuda:
            # FlashAttention expects (batch, seq, heads, dim)
            q = rearrange(q, "b h s d -> b s h d")
            k = rearrange(k, "b h s d -> b s h d")
            v = rearrange(v, "b h s d -> b s h d")
            
            attn_output = flash_attn_func(
                q, k, v,
                dropout_p=self.attention_dropout if self.training else 0.0,
                causal=True
            )
            attn_output = rearrange(attn_output, "b s h d -> b s (h d)")
        else:
            # Standard scaled dot-product attention
            scale = 1.0 / math.sqrt(self.head_dim)
            attn_weights = torch.matmul(q, k.transpose(-2, -1)) * scale
            
            # Causal mask
            if attention_mask is None:
                kv_len = k.shape[2]
                causal_mask = torch.triu(
                    torch.full((seq_len, kv_len), float("-inf"), device=q.device),
                    diagonal=kv_len - seq_len + 1
                )
                attn_weights = attn_weights + causal_mask
            else:
                attn_weights = attn_weights + attention_mask
            
            attn_weights = F.softmax(attn_weights, dim=-1, dtype=torch.float32).to(q.dtype)
            attn_weights = F.dropout(attn_weights, p=self.attention_dropout, training=self.training)
            
            attn_output = torch.matmul(attn_weights, v)
            attn_output = rearrange(attn_output, "b h s d -> b s (h d)")
        
        # Output projection
        attn_output = self.o_proj(attn_output)
        
        return attn_output, new_cache


class SwiGLU(nn.Module):
    """SwiGLU activation function."""
    
    def __init__(self, d_model: int, intermediate_size: int, bias: bool = False):
        super().__init__()
        self.gate_proj = nn.Linear(d_model, intermediate_size, bias=bias)
        self.up_proj = nn.Linear(d_model, intermediate_size, bias=bias)
        self.down_proj = nn.Linear(intermediate_size, d_model, bias=bias)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class TransformerBlock(nn.Module):
    """
    Transformer Block with GQA and pre-norm architecture.
    
    Structure:
        x -> RMSNorm -> GQA -> + residual
          -> RMSNorm -> SwiGLU -> + residual
    """
    
    def __init__(self, config: TransformerConfig):
        super().__init__()
        self.config = config
        
        self.input_layernorm = RMSNorm(config.d_model, eps=config.rms_norm_eps)
        self.self_attn = GroupedQueryAttention(config)
        self.post_attention_layernorm = RMSNorm(config.d_model, eps=config.rms_norm_eps)
        self.mlp = SwiGLU(config.d_model, config.intermediate_size, bias=config.bias)
        
        self.hidden_dropout = nn.Dropout(config.hidden_dropout)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        position_ids: Optional[torch.Tensor] = None,
        past_key_value: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        use_cache: bool = False
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        # Self-attention with residual
        residual = hidden_states
        hidden_states = self.input_layernorm(hidden_states)
        hidden_states, new_cache = self.self_attn(
            hidden_states,
            attention_mask=attention_mask,
            position_ids=position_ids,
            past_key_value=past_key_value,
            use_cache=use_cache
        )
        hidden_states = self.hidden_dropout(hidden_states)
        hidden_states = residual + hidden_states
        
        # FFN with residual
        residual = hidden_states
        hidden_states = self.post_attention_layernorm(hidden_states)
        hidden_states = self.mlp(hidden_states)
        hidden_states = self.hidden_dropout(hidden_states)
        hidden_states = residual + hidden_states
        
        return hidden_states, new_cache


def create_transformer_block(
    d_model: int = 512,
    num_heads: int = 8,
    num_kv_heads: int = 2,
    intermediate_size: int = 1376,
    **kwargs
) -> TransformerBlock:
    """Factory function to create a Transformer block."""
    config = TransformerConfig(
        d_model=d_model,
        num_heads=num_heads,
        num_kv_heads=num_kv_heads,
        intermediate_size=intermediate_size,
        **kwargs
    )
    return TransformerBlock(config)


# Quick test
if __name__ == "__main__":
    print("Testing Transformer Block...")
    
    config = TransformerConfig(
        d_model=512,
        num_heads=8,
        num_kv_heads=2,
        intermediate_size=1376
    )
    
    block = TransformerBlock(config)
    print(f"Using FlashAttention: {block.self_attn.use_flash}")
    
    batch, seq_len, d_model = 2, 128, 512
    x = torch.randn(batch, seq_len, d_model)
    
    if torch.cuda.is_available():
        block = block.cuda()
        x = x.cuda()
    
    y, cache = block(x)
    print(f"Input shape: {x.shape}")
    print(f"Output shape: {y.shape}")
    
    num_params = sum(p.numel() for p in block.parameters())
    print(f"Parameters: {num_params:,}")
    
    print("✅ Transformer Block test passed!")
