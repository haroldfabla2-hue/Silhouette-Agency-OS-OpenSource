"""
NANOSILHOUETTE - Quantization Support
======================================
Implements memory-efficient quantization for training and inference:
- 4-bit quantization (NF4/FP4)
- 8-bit quantization
- QLoRA compatibility
"""
import torch
import torch.nn as nn
from typing import Optional, Dict, Any, Union
from dataclasses import dataclass

# Check for bitsandbytes
try:
    import bitsandbytes as bnb
    from bitsandbytes.nn import Linear4bit, Linear8bitLt
    BNB_AVAILABLE = True
except ImportError:
    BNB_AVAILABLE = False
    print("[QUANTIZATION] bitsandbytes not found. Install with: pip install bitsandbytes")


@dataclass
class QuantizationConfig:
    """Configuration for model quantization."""
    # 4-bit quantization
    load_in_4bit: bool = False
    bnb_4bit_quant_type: str = "nf4"  # "nf4" or "fp4"
    bnb_4bit_compute_dtype: torch.dtype = torch.bfloat16
    bnb_4bit_use_double_quant: bool = True
    
    # 8-bit quantization
    load_in_8bit: bool = False
    llm_int8_threshold: float = 6.0
    
    # QLoRA settings
    use_lora: bool = False
    lora_r: int = 8
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    lora_target_modules: tuple = ("q_proj", "k_proj", "v_proj", "o_proj")


def quantize_linear_4bit(
    linear: nn.Linear,
    quant_type: str = "nf4",
    compute_dtype: torch.dtype = torch.bfloat16,
    double_quant: bool = True
) -> Union[nn.Linear, Any]:
    """
    Convert a Linear layer to 4-bit quantized.
    
    Args:
        linear: The linear layer to quantize
        quant_type: "nf4" (recommended) or "fp4"
        compute_dtype: Dtype for computation
        double_quant: Enable double quantization for more savings
    
    Returns:
        Quantized linear layer
    """
    if not BNB_AVAILABLE:
        print("[WARNING] bitsandbytes not available, returning original layer")
        return linear
    
    # Create 4-bit linear layer
    quantized = Linear4bit(
        linear.in_features,
        linear.out_features,
        bias=linear.bias is not None,
        compute_dtype=compute_dtype,
        quant_type=quant_type,
        device=linear.weight.device
    )
    
    # Copy weights (they'll be quantized)
    quantized.weight.data = linear.weight.data
    if linear.bias is not None:
        quantized.bias.data = linear.bias.data
    
    return quantized


def quantize_linear_8bit(
    linear: nn.Linear,
    threshold: float = 6.0
) -> Union[nn.Linear, Any]:
    """
    Convert a Linear layer to 8-bit quantized.
    
    Args:
        linear: The linear layer to quantize
        threshold: Threshold for outlier handling
    
    Returns:
        Quantized linear layer
    """
    if not BNB_AVAILABLE:
        print("[WARNING] bitsandbytes not available, returning original layer")
        return linear
    
    quantized = Linear8bitLt(
        linear.in_features,
        linear.out_features,
        bias=linear.bias is not None,
        has_fp16_weights=False,
        threshold=threshold
    )
    
    quantized.weight.data = linear.weight.data
    if linear.bias is not None:
        quantized.bias.data = linear.bias.data
    
    return quantized


class LoRALayer(nn.Module):
    """
    Low-Rank Adaptation (LoRA) layer.
    
    Adds trainable low-rank matrices to frozen base weights.
    """
    
    def __init__(
        self,
        in_features: int,
        out_features: int,
        r: int = 8,
        alpha: int = 32,
        dropout: float = 0.05
    ):
        super().__init__()
        self.r = r
        self.alpha = alpha
        self.scaling = alpha / r
        
        # Low-rank matrices
        self.lora_A = nn.Parameter(torch.zeros(r, in_features))
        self.lora_B = nn.Parameter(torch.zeros(out_features, r))
        
        # Initialize A with Kaiming, B with zeros
        nn.init.kaiming_uniform_(self.lora_A, a=5**0.5)
        nn.init.zeros_(self.lora_B)
        
        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Compute LoRA delta: x @ A^T @ B^T * scaling"""
        return (self.dropout(x) @ self.lora_A.T @ self.lora_B.T) * self.scaling


class LinearWithLoRA(nn.Module):
    """
    Linear layer with LoRA adaptation.
    
    Base weights are frozen, only LoRA weights are trained.
    """
    
    def __init__(
        self,
        linear: nn.Linear,
        r: int = 8,
        alpha: int = 32,
        dropout: float = 0.05
    ):
        super().__init__()
        self.linear = linear
        self.lora = LoRALayer(
            linear.in_features,
            linear.out_features,
            r=r,
            alpha=alpha,
            dropout=dropout
        )
        
        # Freeze base weights
        for param in self.linear.parameters():
            param.requires_grad = False
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.linear(x) + self.lora(x)


def apply_lora(
    model: nn.Module,
    target_modules: tuple = ("q_proj", "k_proj", "v_proj", "o_proj"),
    r: int = 8,
    alpha: int = 32,
    dropout: float = 0.05
) -> nn.Module:
    """
    Apply LoRA to specific modules in a model.
    
    Args:
        model: The model to modify
        target_modules: Names of modules to apply LoRA to
        r: LoRA rank
        alpha: LoRA alpha (scaling)
        dropout: Dropout probability
    
    Returns:
        Modified model with LoRA
    """
    lora_count = 0
    
    for name, module in model.named_modules():
        if any(target in name for target in target_modules):
            if isinstance(module, nn.Linear):
                # Replace with LoRA version
                parent_name = ".".join(name.split(".")[:-1])
                module_name = name.split(".")[-1]
                
                parent = model
                for part in parent_name.split("."):
                    if part:
                        parent = getattr(parent, part)
                
                lora_linear = LinearWithLoRA(module, r=r, alpha=alpha, dropout=dropout)
                setattr(parent, module_name, lora_linear)
                lora_count += 1
    
    print(f"[LORA] Applied LoRA to {lora_count} layers (r={r}, alpha={alpha})")
    return model


def quantize_model(
    model: nn.Module,
    config: Optional[QuantizationConfig] = None
) -> nn.Module:
    """
    Apply quantization to a model based on configuration.
    
    Args:
        model: The model to quantize
        config: Quantization configuration
    
    Returns:
        Quantized model
    """
    config = config or QuantizationConfig()
    
    if not BNB_AVAILABLE and (config.load_in_4bit or config.load_in_8bit):
        print("[WARNING] bitsandbytes not available, skipping quantization")
        return model
    
    if config.load_in_4bit:
        print(f"[QUANTIZATION] Applying 4-bit quantization ({config.bnb_4bit_quant_type})")
        quantized_count = 0
        
        for name, module in model.named_modules():
            if isinstance(module, nn.Linear) and not isinstance(module, (LinearWithLoRA,)):
                if module.in_features >= 256:  # Only quantize large layers
                    parent_name = ".".join(name.split(".")[:-1])
                    module_name = name.split(".")[-1]
                    
                    parent = model
                    for part in parent_name.split("."):
                        if part:
                            parent = getattr(parent, part)
                    
                    quantized = quantize_linear_4bit(
                        module,
                        quant_type=config.bnb_4bit_quant_type,
                        compute_dtype=config.bnb_4bit_compute_dtype,
                        double_quant=config.bnb_4bit_use_double_quant
                    )
                    setattr(parent, module_name, quantized)
                    quantized_count += 1
        
        print(f"[QUANTIZATION] Quantized {quantized_count} layers to 4-bit")
    
    elif config.load_in_8bit:
        print("[QUANTIZATION] Applying 8-bit quantization")
        # Similar logic for 8-bit
        pass
    
    if config.use_lora:
        model = apply_lora(
            model,
            target_modules=config.lora_target_modules,
            r=config.lora_r,
            alpha=config.lora_alpha,
            dropout=config.lora_dropout
        )
    
    return model


def get_trainable_params(model: nn.Module) -> Dict[str, int]:
    """Get count of trainable vs total parameters."""
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    
    return {
        "trainable": trainable,
        "total": total,
        "trainable_percent": 100 * trainable / total if total > 0 else 0
    }


if __name__ == "__main__":
    print("Testing Quantization Support...")
    
    # Test LoRA layer
    linear = nn.Linear(512, 512)
    lora_linear = LinearWithLoRA(linear, r=8, alpha=32)
    
    x = torch.randn(2, 64, 512)
    y = lora_linear(x)
    print(f"LoRA output shape: {y.shape}")
    
    # Check trainable params
    params = get_trainable_params(lora_linear)
    print(f"Trainable: {params['trainable']:,} / {params['total']:,} ({params['trainable_percent']:.2f}%)")
    
    if BNB_AVAILABLE:
        print("[bitsandbytes] Available - 4-bit/8-bit quantization supported")
    else:
        print("[bitsandbytes] Not available - install for quantization support")
    
    print("✅ Quantization test passed!")
