"""
NANOSILHOUETTE - Mamba Block Implementation
============================================
Selective State Space Model (S6) based on:
- Mamba: Linear-Time Sequence Modeling with Selective State Spaces
- Repository: state-spaces/mamba

This implementation provides:
1. Selective scan mechanism (input-dependent A, B, C, Δ)
2. Hardware-aware parallel scan (when mamba-ssm is available)
3. Pure PyTorch fallback for compatibility
"""

import math
from typing import Optional, Tuple
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F
from einops import rearrange, repeat

# Try to import optimized Mamba kernels
try:
    from mamba_ssm import Mamba as MambaOptimized
    from mamba_ssm.ops.selective_scan_interface import selective_scan_fn
    MAMBA_AVAILABLE = True
except ImportError:
    MAMBA_AVAILABLE = False
    print("[NANOSILHOUETTE] mamba-ssm not found. Using pure PyTorch implementation.")


@dataclass
class MambaConfig:
    """Configuration for Mamba block."""
    d_model: int = 512          # Model dimension
    d_state: int = 16           # SSM state dimension (N)
    d_conv: int = 4             # Local convolution width
    expand: int = 2             # Block expansion factor
    dt_rank: str = "auto"       # Delta rank
    dt_min: float = 0.001
    dt_max: float = 0.1
    dt_init: str = "random"     # "random" or "constant"
    dt_scale: float = 1.0
    dt_init_floor: float = 1e-4
    bias: bool = False
    conv_bias: bool = True
    
    def __post_init__(self):
        self.d_inner = int(self.expand * self.d_model)
        if self.dt_rank == "auto":
            self.dt_rank = math.ceil(self.d_model / 16)


class MambaBlockPure(nn.Module):
    """
    Pure PyTorch Mamba Block implementation.
    
    Used as fallback when mamba-ssm CUDA kernels are not available.
    Slower but fully compatible with any PyTorch installation.
    """
    
    def __init__(self, config: MambaConfig):
        super().__init__()
        self.config = config
        d_model = config.d_model
        d_inner = config.d_inner
        d_state = config.d_state
        d_conv = config.d_conv
        dt_rank = config.dt_rank
        
        # Input projection: d_model -> 2 * d_inner (for x and z)
        self.in_proj = nn.Linear(d_model, d_inner * 2, bias=config.bias)
        
        # 1D Convolution for local context
        self.conv1d = nn.Conv1d(
            in_channels=d_inner,
            out_channels=d_inner,
            kernel_size=d_conv,
            padding=d_conv - 1,
            groups=d_inner,
            bias=config.conv_bias
        )
        
        # SSM parameters: Delta, B, C projections from input
        # x -> (delta, B, C) for selective mechanism
        self.x_proj = nn.Linear(d_inner, dt_rank + d_state * 2, bias=False)
        
        # Delta projection: dt_rank -> d_inner
        self.dt_proj = nn.Linear(dt_rank, d_inner, bias=True)
        
        # Initialize dt_proj bias for numerical stability
        dt_init_std = dt_rank ** -0.5 * config.dt_scale
        if config.dt_init == "constant":
            nn.init.constant_(self.dt_proj.weight, dt_init_std)
        elif config.dt_init == "random":
            nn.init.uniform_(self.dt_proj.weight, -dt_init_std, dt_init_std)
        
        # Initialize dt bias to ensure dt is in [dt_min, dt_max]
        dt = torch.exp(
            torch.rand(d_inner) * (math.log(config.dt_max) - math.log(config.dt_min))
            + math.log(config.dt_min)
        ).clamp(min=config.dt_init_floor)
        inv_dt = dt + torch.log(-torch.expm1(-dt))
        with torch.no_grad():
            self.dt_proj.bias.copy_(inv_dt)
        
        # A parameter: diagonal state matrix (log parameterized for stability)
        # Shape: (d_inner, d_state)
        A = repeat(
            torch.arange(1, d_state + 1, dtype=torch.float32),
            "n -> d n",
            d=d_inner
        )
        self.A_log = nn.Parameter(torch.log(A))
        self.A_log._no_weight_decay = True
        
        # D parameter: skip connection
        self.D = nn.Parameter(torch.ones(d_inner))
        self.D._no_weight_decay = True
        
        # Output projection: d_inner -> d_model
        self.out_proj = nn.Linear(d_inner, d_model, bias=config.bias)
    
    def forward(
        self, 
        hidden_states: torch.Tensor,
        cache: Optional[Tuple[torch.Tensor, torch.Tensor]] = None
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        """
        Forward pass of Mamba block.
        
        Args:
            hidden_states: (batch, seq_len, d_model)
            cache: Optional tuple of (conv_state, ssm_state) for inference
        
        Returns:
            output: (batch, seq_len, d_model)
            new_cache: Updated cache for next step
        """
        batch, seq_len, _ = hidden_states.shape
        
        # Input projection -> x and z (gate)
        xz = self.in_proj(hidden_states)
        x, z = xz.chunk(2, dim=-1)  # Each: (batch, seq_len, d_inner)
        
        # 1D convolution
        x = rearrange(x, "b l d -> b d l")
        
        # Initialize ssm_state (will be None if no cache)
        ssm_state = None
        
        if cache is not None:
            conv_state, ssm_state = cache
            # Prepend cached conv state
            x = torch.cat([conv_state, x], dim=-1)
        
        x = self.conv1d(x)[:, :, :seq_len]  # Causal: trim to seq_len
        x = rearrange(x, "b d l -> b l d")
        
        # Activation
        x = F.silu(x)
        
        # Compute selective SSM parameters from input
        x_dbl = self.x_proj(x)  # (batch, seq_len, dt_rank + 2*d_state)
        dt, B, C = x_dbl.split(
            [self.config.dt_rank, self.config.d_state, self.config.d_state], 
            dim=-1
        )
        
        # Delta (step size) projection
        dt = self.dt_proj(dt)  # (batch, seq_len, d_inner)
        dt = F.softplus(dt)    # Ensure positive
        
        # Get A from log parameterization
        A = -torch.exp(self.A_log)  # (d_inner, d_state)
        
        # Run selective scan
        y, new_ssm_state = self._selective_scan(x, dt, A, B, C, self.D, ssm_state)
        
        # Gate with z
        y = y * F.silu(z)
        
        # Output projection
        output = self.out_proj(y)
        
        # Prepare new cache
        if cache is not None:
            new_conv_state = rearrange(x, "b l d -> b d l")[:, :, -self.config.d_conv + 1:]
            new_cache = (new_conv_state, new_ssm_state)
        else:
            new_cache = None
        
        return output, new_cache
    
    def _selective_scan(
        self,
        x: torch.Tensor,           # (batch, seq_len, d_inner)
        dt: torch.Tensor,          # (batch, seq_len, d_inner)
        A: torch.Tensor,           # (d_inner, d_state)
        B: torch.Tensor,           # (batch, seq_len, d_state)
        C: torch.Tensor,           # (batch, seq_len, d_state)
        D: torch.Tensor,           # (d_inner,)
        ssm_state: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Selective scan implementation (pure PyTorch, sequential).
        
        This is the core SSM recurrence:
            h_t = A_bar * h_{t-1} + B_bar * x_t
            y_t = C_t * h_t + D * x_t
        
        Where A_bar, B_bar are discretized versions.
        """
        batch, seq_len, d_inner = x.shape
        d_state = A.shape[1]
        
        # Initialize state
        if ssm_state is None:
            h = torch.zeros(batch, d_inner, d_state, device=x.device, dtype=x.dtype)
        else:
            h = ssm_state
        
        outputs = []
        
        # Sequential scan (can be parallelized with associative scan)
        for t in range(seq_len):
            x_t = x[:, t, :]      # (batch, d_inner)
            dt_t = dt[:, t, :]    # (batch, d_inner)
            B_t = B[:, t, :]      # (batch, d_state)
            C_t = C[:, t, :]      # (batch, d_state)
            
            # Discretize A and B using ZOH (zero-order hold)
            # A_bar = exp(A * dt)
            # B_bar = (exp(A * dt) - 1) / A * B ≈ dt * B for small dt
            dt_t = dt_t.unsqueeze(-1)  # (batch, d_inner, 1)
            A_bar = torch.exp(A.unsqueeze(0) * dt_t)  # (batch, d_inner, d_state)
            B_bar = dt_t * B_t.unsqueeze(1)  # (batch, d_inner, d_state)
            
            # State update: h = A_bar * h + B_bar * x
            h = A_bar * h + B_bar * x_t.unsqueeze(-1)
            
            # Output: y = C * h + D * x
            y_t = torch.einsum("bds,bs->bd", h, C_t) + D * x_t
            outputs.append(y_t)
        
        y = torch.stack(outputs, dim=1)  # (batch, seq_len, d_inner)
        
        return y, h


class MambaBlock(nn.Module):
    """
    Mamba Block with automatic backend selection.
    
    Uses optimized CUDA kernels from mamba-ssm when available,
    falls back to pure PyTorch implementation otherwise.
    """
    
    def __init__(self, config: MambaConfig):
        super().__init__()
        self.config = config
        
        if MAMBA_AVAILABLE:
            # Use optimized implementation
            self.mamba = MambaOptimized(
                d_model=config.d_model,
                d_state=config.d_state,
                d_conv=config.d_conv,
                expand=config.expand,
            )
            self.use_optimized = True
        else:
            # Use pure PyTorch
            self.mamba = MambaBlockPure(config)
            self.use_optimized = False
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        cache: Optional[Tuple[torch.Tensor, torch.Tensor]] = None
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        """
        Forward pass.
        
        Args:
            hidden_states: (batch, seq_len, d_model)
            cache: Optional cache for incremental decoding
        
        Returns:
            output: (batch, seq_len, d_model)
            new_cache: Updated cache (None if using optimized without cache)
        """
        if self.use_optimized:
            # Optimized implementation doesn't return cache in same format
            output = self.mamba(hidden_states)
            return output, None
        else:
            return self.mamba(hidden_states, cache)
    
    @property
    def is_optimized(self) -> bool:
        """Check if using optimized CUDA kernels."""
        return self.use_optimized


def create_mamba_block(
    d_model: int = 512,
    d_state: int = 16,
    d_conv: int = 4,
    expand: int = 2,
    **kwargs
) -> MambaBlock:
    """Factory function to create a Mamba block."""
    config = MambaConfig(
        d_model=d_model,
        d_state=d_state,
        d_conv=d_conv,
        expand=expand,
        **kwargs
    )
    return MambaBlock(config)


# Quick test
if __name__ == "__main__":
    print("Testing Mamba Block...")
    
    # Create config
    config = MambaConfig(d_model=512, d_state=16, d_conv=4, expand=2)
    
    # Create block
    block = MambaBlock(config)
    print(f"Using optimized: {block.is_optimized}")
    
    # Test forward pass
    batch, seq_len, d_model = 2, 128, 512
    x = torch.randn(batch, seq_len, d_model)
    
    if torch.cuda.is_available():
        block = block.cuda()
        x = x.cuda()
    
    y, cache = block(x)
    print(f"Input shape: {x.shape}")
    print(f"Output shape: {y.shape}")
    
    # Count parameters
    num_params = sum(p.numel() for p in block.parameters())
    print(f"Parameters: {num_params:,}")
    
    print("✅ Mamba Block test passed!")
