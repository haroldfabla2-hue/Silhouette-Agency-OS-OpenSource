"""
SILHOUETTE - Homeostatic Resource Management System
====================================================
Automatically detects available resources (GPU VRAM, RAM, CPU) and
synthesizes optimal configuration that PRESERVES all AGI capabilities
while scaling them appropriately.

Philosophy: "Never lose capabilities, only adapt them to the environment."

Biological analog: Homeostasis - maintaining internal equilibrium
despite external environmental changes.
"""
import os
import sys
import time
import logging
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Tuple, List
from enum import Enum

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False


# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Homeostasis")


class ResourceProfile(Enum):
    """Resource availability profiles."""
    ULTRA_CONSTRAINED = "ultra_constrained"  # < 2GB VRAM
    CONSTRAINED = "constrained"              # 2-4GB VRAM (RTX 3050)
    BALANCED = "balanced"                    # 4-8GB VRAM
    PERFORMANCE = "performance"              # 8-16GB VRAM
    UNLIMITED = "unlimited"                  # 16GB+ VRAM
    CPU_ONLY = "cpu_only"                    # No GPU


@dataclass
class EnvironmentState:
    """Detected environment state."""
    # GPU
    gpu_available: bool = False
    gpu_name: str = "None"
    gpu_vram_total_gb: float = 0.0
    gpu_vram_free_gb: float = 0.0
    gpu_vram_used_gb: float = 0.0
    gpu_compute_capability: Tuple[int, int] = (0, 0)
    
    # System
    ram_total_gb: float = 0.0
    ram_available_gb: float = 0.0
    cpu_cores: int = 1
    
    # Runtime context
    other_gpu_processes: List[str] = field(default_factory=list)
    is_training_mode: bool = False
    timestamp: float = field(default_factory=time.time)
    
    def usable_vram_gb(self, safety_margin: float = 0.2) -> float:
        """Calculate usable VRAM with safety margin."""
        return self.gpu_vram_free_gb * (1 - safety_margin)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "gpu_available": self.gpu_available,
            "gpu_name": self.gpu_name,
            "gpu_vram_total_gb": round(self.gpu_vram_total_gb, 2),
            "gpu_vram_free_gb": round(self.gpu_vram_free_gb, 2),
            "gpu_vram_used_gb": round(self.gpu_vram_used_gb, 2),
            "ram_total_gb": round(self.ram_total_gb, 2),
            "ram_available_gb": round(self.ram_available_gb, 2),
            "cpu_cores": self.cpu_cores,
            "usable_vram_gb": round(self.usable_vram_gb(), 2),
        }


@dataclass
class ScalableConfig:
    """
    Configuration that scales ALL components proportionally.
    No component is ever disabled - only scaled down.
    """
    # Profile identity
    profile_name: str = "balanced"
    
    # Core architecture (scaled)
    d_model: int = 512
    intermediate_size: int = 1376
    num_layers: int = 12
    num_heads: int = 8
    num_kv_heads: int = 2
    max_seq_len: int = 2048
    vocab_size: int = 32000
    
    # Hybrid architecture
    mamba_ratio: int = 7  # Mamba : Transformer ratio
    
    # MoE (scaled, NEVER disabled)
    use_moe: bool = True
    num_experts: int = 16
    num_experts_per_tok: int = 2
    moe_interval: int = 2
    
    # Continuum Memory System (scaled)
    use_cms: bool = True
    cms_memory_size: int = 256
    cms_num_timescales: int = 4
    
    # JEPA (scaled)
    use_jepa: bool = True
    jepa_embedding_dim: int = 512
    
    # Introspection (scaled)
    use_introspection: bool = True
    introspection_features: int = 128
    
    # Deep Optimizer (scaled)
    use_deep_optimizer: bool = True
    deep_optimizer_hidden: int = 256
    
    # AGI Core scaling factor (0.0 - 1.0)
    # This scales World Model, Self Model, Curiosity, Goals proportionally
    agi_core_scale: float = 1.0
    
    # Memory optimization
    quantization: str = "none"  # "none", "fp16", "8bit", "4bit"
    gradient_checkpointing: bool = False
    compile_model: bool = True
    
    # Estimated parameters (informational)
    estimated_params_millions: float = 0.0
    estimated_vram_gb: float = 0.0
    
    def __post_init__(self):
        """Calculate estimates after initialization."""
        self._calculate_estimates()
    
    def _calculate_estimates(self):
        """Estimate parameter count and VRAM usage."""
        # Embedding parameters
        embed_params = self.vocab_size * self.d_model
        
        # Per-layer parameters (approximate)
        layer_params = 4 * self.d_model * self.d_model  # Attention + FFN base
        
        # MoE additional params (only count active experts for inference)
        if self.use_moe:
            moe_layers = self.num_layers // self.moe_interval
            moe_params = moe_layers * self.num_experts * 3 * self.d_model * self.intermediate_size
            # But only 2 experts are active at a time
            active_moe_params = moe_layers * self.num_experts_per_tok * 3 * self.d_model * self.intermediate_size
        else:
            moe_params = 0
            active_moe_params = 0
        
        # AGI Core params (scaled)
        agi_base = 5_000_000  # ~5M base
        agi_params = int(agi_base * self.agi_core_scale)
        
        # Total
        total_params = embed_params + (layer_params * self.num_layers) + active_moe_params + agi_params
        self.estimated_params_millions = total_params / 1_000_000
        
        # VRAM estimate (bytes per param depends on quantization)
        bytes_per_param = {
            "none": 4.0,  # FP32
            "fp16": 2.0,
            "8bit": 1.0,
            "4bit": 0.5,
        }.get(self.quantization, 2.0)
        
        self.estimated_vram_gb = (total_params * bytes_per_param) / 1e9
        
        # Add overhead for activations and gradients
        if self.gradient_checkpointing:
            self.estimated_vram_gb *= 1.3  # 30% overhead
        else:
            self.estimated_vram_gb *= 2.0  # 100% overhead for full gradients


# ============================================
# PROFILE DEFINITIONS
# ============================================
# Each profile maintains ALL capabilities, just scaled appropriately

PROFILES: Dict[str, ScalableConfig] = {
    ResourceProfile.CPU_ONLY.value: ScalableConfig(
        profile_name="cpu_only",
        d_model=256,
        intermediate_size=688,
        num_layers=4,
        num_heads=4,
        num_kv_heads=1,
        max_seq_len=512,
        # MoE minimal but present
        use_moe=True,
        num_experts=4,
        num_experts_per_tok=1,
        moe_interval=4,
        # CMS minimal
        cms_memory_size=32,
        cms_num_timescales=2,
        # JEPA scaled
        jepa_embedding_dim=256,
        # Introspection scaled
        introspection_features=32,
        # Deep optimizer scaled
        deep_optimizer_hidden=64,
        # AGI at 20%
        agi_core_scale=0.2,
        # Optimization
        quantization="8bit",
        gradient_checkpointing=True,
        compile_model=False,  # CPU doesn't benefit much
    ),
    
    ResourceProfile.ULTRA_CONSTRAINED.value: ScalableConfig(
        profile_name="ultra_constrained",
        d_model=256,
        intermediate_size=688,
        num_layers=6,
        num_heads=4,
        num_kv_heads=1,
        max_seq_len=1024,
        # MoE present but minimal
        use_moe=True,
        num_experts=4,
        num_experts_per_tok=1,
        moe_interval=3,
        # CMS
        cms_memory_size=64,
        cms_num_timescales=2,
        # JEPA
        jepa_embedding_dim=256,
        # Introspection
        introspection_features=64,
        # Deep optimizer
        deep_optimizer_hidden=128,
        # AGI at 25%
        agi_core_scale=0.25,
        # Optimization
        quantization="4bit",
        gradient_checkpointing=True,
        compile_model=True,
    ),
    
    ResourceProfile.CONSTRAINED.value: ScalableConfig(
        profile_name="constrained",  # RTX 3050 4GB
        d_model=384,
        intermediate_size=1024,
        num_layers=8,
        num_heads=6,
        num_kv_heads=2,
        max_seq_len=1024,
        # MoE scaled
        use_moe=True,
        num_experts=8,
        num_experts_per_tok=2,
        moe_interval=2,
        # CMS
        cms_memory_size=128,
        cms_num_timescales=3,
        # JEPA
        jepa_embedding_dim=384,
        # Introspection
        introspection_features=96,
        # Deep optimizer
        deep_optimizer_hidden=192,
        # AGI at 50%
        agi_core_scale=0.5,
        # Optimization
        quantization="8bit",
        gradient_checkpointing=True,
        compile_model=True,
    ),
    
    ResourceProfile.BALANCED.value: ScalableConfig(
        profile_name="balanced",  # RTX 3060/3070 8GB
        d_model=512,
        intermediate_size=1376,
        num_layers=12,
        num_heads=8,
        num_kv_heads=2,
        max_seq_len=2048,
        # MoE full
        use_moe=True,
        num_experts=16,
        num_experts_per_tok=2,
        moe_interval=2,
        # CMS
        cms_memory_size=256,
        cms_num_timescales=4,
        # JEPA
        jepa_embedding_dim=512,
        # Introspection
        introspection_features=128,
        # Deep optimizer
        deep_optimizer_hidden=256,
        # AGI at 100%
        agi_core_scale=1.0,
        # Optimization
        quantization="fp16",
        gradient_checkpointing=True,
        compile_model=True,
    ),
    
    ResourceProfile.PERFORMANCE.value: ScalableConfig(
        profile_name="performance",  # RTX 3080/4080 12-16GB
        d_model=768,
        intermediate_size=2048,
        num_layers=16,
        num_heads=12,
        num_kv_heads=4,
        max_seq_len=4096,
        # MoE expanded
        use_moe=True,
        num_experts=16,
        num_experts_per_tok=2,
        moe_interval=2,
        # CMS
        cms_memory_size=512,
        cms_num_timescales=4,
        # JEPA
        jepa_embedding_dim=768,
        # Introspection
        introspection_features=192,
        # Deep optimizer
        deep_optimizer_hidden=384,
        # AGI at 100%
        agi_core_scale=1.0,
        # Optimization
        quantization="fp16",
        gradient_checkpointing=False,
        compile_model=True,
    ),
    
    ResourceProfile.UNLIMITED.value: ScalableConfig(
        profile_name="unlimited",  # RTX 4090 / A100 24GB+
        d_model=1024,
        intermediate_size=2752,
        num_layers=24,
        num_heads=16,
        num_kv_heads=4,
        max_seq_len=8192,
        # MoE maximum
        use_moe=True,
        num_experts=32,
        num_experts_per_tok=4,
        moe_interval=2,
        # CMS
        cms_memory_size=1024,
        cms_num_timescales=6,
        # JEPA
        jepa_embedding_dim=1024,
        # Introspection
        introspection_features=256,
        # Deep optimizer
        deep_optimizer_hidden=512,
        # AGI at 100%
        agi_core_scale=1.0,
        # Optimization
        quantization="none",  # Full precision
        gradient_checkpointing=False,
        compile_model=True,
    ),
}


class HomeostasisManager:
    """
    Homeostatic Resource Management System.
    
    Continuously monitors environment and provides optimal configuration
    that preserves ALL AGI capabilities while adapting to available resources.
    """
    
    def __init__(self, force_profile: Optional[str] = None):
        """
        Initialize the homeostasis manager.
        
        Args:
            force_profile: Optional profile name to force instead of auto-detecting
        """
        self.forced_profile = force_profile
        self.environment = self._sense_environment()
        self.profile = self._select_profile()
        self.config = self._synthesize_config()
        
        self._log_status()
    
    def _sense_environment(self) -> EnvironmentState:
        """Detect all available resources in the environment."""
        env = EnvironmentState()
        
        # GPU detection
        if TORCH_AVAILABLE and torch.cuda.is_available():
            try:
                props = torch.cuda.get_device_properties(0)
                env.gpu_available = True
                env.gpu_name = props.name
                env.gpu_vram_total_gb = props.total_memory / 1e9
                env.gpu_vram_used_gb = torch.cuda.memory_allocated(0) / 1e9
                env.gpu_vram_free_gb = env.gpu_vram_total_gb - env.gpu_vram_used_gb
                env.gpu_compute_capability = (props.major, props.minor)
            except Exception as e:
                logger.warning(f"GPU detection failed: {e}")
                env.gpu_available = False
        
        # System memory
        if PSUTIL_AVAILABLE:
            try:
                mem = psutil.virtual_memory()
                env.ram_total_gb = mem.total / 1e9
                env.ram_available_gb = mem.available / 1e9
                env.cpu_cores = os.cpu_count() or 1
            except Exception as e:
                logger.warning(f"System memory detection failed: {e}")
        
        # Detect other GPU processes
        env.other_gpu_processes = self._detect_gpu_sharing()
        
        return env
    
    def _detect_gpu_sharing(self) -> List[str]:
        """Detect other processes using the GPU."""
        processes = []
        
        # Known Silhouette processes that use GPU
        known_gpu_users = ["tts_engine", "comfyui", "ollama"]
        
        if PSUTIL_AVAILABLE:
            try:
                for proc in psutil.process_iter(['name', 'cmdline']):
                    try:
                        name = proc.info['name'].lower()
                        cmdline = ' '.join(proc.info['cmdline'] or []).lower()
                        
                        for known in known_gpu_users:
                            if known in name or known in cmdline:
                                processes.append(known)
                                break
                    except (psutil.AccessDenied, psutil.NoSuchProcess):
                        continue
            except Exception:
                pass
        
        return list(set(processes))
    
    def _select_profile(self) -> ResourceProfile:
        """Select optimal profile based on detected environment."""
        if self.forced_profile:
            try:
                return ResourceProfile(self.forced_profile)
            except ValueError:
                logger.warning(f"Unknown profile '{self.forced_profile}', auto-detecting...")
        
        if not self.environment.gpu_available:
            return ResourceProfile.CPU_ONLY
        
        usable_vram = self.environment.usable_vram_gb()
        
        # Adjust for other GPU processes
        if self.environment.other_gpu_processes:
            # Estimate VRAM used by other processes
            vram_reduction = len(self.environment.other_gpu_processes) * 0.5  # ~500MB each
            usable_vram = max(0.5, usable_vram - vram_reduction)
            logger.info(f"Detected GPU sharing with: {self.environment.other_gpu_processes}")
            logger.info(f"Adjusted usable VRAM: {usable_vram:.2f} GB")
        
        # Select based on thresholds
        if usable_vram < 2.0:
            return ResourceProfile.ULTRA_CONSTRAINED
        elif usable_vram < 4.0:
            return ResourceProfile.CONSTRAINED
        elif usable_vram < 8.0:
            return ResourceProfile.BALANCED
        elif usable_vram < 16.0:
            return ResourceProfile.PERFORMANCE
        else:
            return ResourceProfile.UNLIMITED
    
    def _synthesize_config(self) -> ScalableConfig:
        """Get configuration for selected profile."""
        config = PROFILES.get(self.profile.value)
        if config is None:
            logger.warning(f"Profile {self.profile.value} not found, using balanced")
            config = PROFILES[ResourceProfile.BALANCED.value]
        
        # Deep copy to avoid modifying the template
        import copy
        return copy.deepcopy(config)
    
    def _log_status(self):
        """Log current homeostasis status."""
        logger.info("=" * 60)
        logger.info("SILHOUETTE HOMEOSTASIS STATUS")
        logger.info("=" * 60)
        logger.info(f"GPU: {self.environment.gpu_name}")
        logger.info(f"VRAM Total: {self.environment.gpu_vram_total_gb:.2f} GB")
        logger.info(f"VRAM Free: {self.environment.gpu_vram_free_gb:.2f} GB")
        logger.info(f"VRAM Usable: {self.environment.usable_vram_gb():.2f} GB")
        logger.info(f"RAM Available: {self.environment.ram_available_gb:.2f} GB")
        logger.info("-" * 60)
        logger.info(f"Selected Profile: {self.profile.value.upper()}")
        logger.info(f"Model Dimensions: d_model={self.config.d_model}, layers={self.config.num_layers}")
        logger.info(f"MoE: {self.config.num_experts} experts, {self.config.num_experts_per_tok} active")
        logger.info(f"AGI Core Scale: {self.config.agi_core_scale * 100:.0f}%")
        logger.info(f"Quantization: {self.config.quantization}")
        logger.info(f"Estimated Params: {self.config.estimated_params_millions:.1f}M")
        logger.info(f"Estimated VRAM: {self.config.estimated_vram_gb:.2f} GB")
        logger.info("=" * 60)
    
    def refresh(self) -> bool:
        """
        Re-sense environment and update profile if needed.
        
        Returns:
            True if profile changed, False otherwise
        """
        old_profile = self.profile
        self.environment = self._sense_environment()
        self.profile = self._select_profile()
        
        if self.profile != old_profile:
            logger.info(f"[HOMEOSTASIS] Profile changed: {old_profile.value} → {self.profile.value}")
            self.config = self._synthesize_config()
            self._log_status()
            return True
        
        return False
    
    def get_config(self) -> ScalableConfig:
        """Get current optimal configuration."""
        return self.config
    
    def get_environment(self) -> EnvironmentState:
        """Get current environment state."""
        return self.environment
    
    def get_status_dict(self) -> Dict[str, Any]:
        """Get complete status as dictionary."""
        return {
            "environment": self.environment.to_dict(),
            "profile": self.profile.value,
            "config": {
                "d_model": self.config.d_model,
                "num_layers": self.config.num_layers,
                "num_experts": self.config.num_experts,
                "agi_core_scale": self.config.agi_core_scale,
                "quantization": self.config.quantization,
                "estimated_params_millions": self.config.estimated_params_millions,
                "estimated_vram_gb": self.config.estimated_vram_gb,
            }
        }


# Singleton instance
_homeostasis_manager: Optional[HomeostasisManager] = None


def get_homeostasis_manager(force_profile: Optional[str] = None) -> HomeostasisManager:
    """Get or create the global homeostasis manager."""
    global _homeostasis_manager
    
    if _homeostasis_manager is None or force_profile:
        _homeostasis_manager = HomeostasisManager(force_profile)
    
    return _homeostasis_manager


def get_optimal_config(force_profile: Optional[str] = None) -> ScalableConfig:
    """Convenience function to get optimal configuration."""
    return get_homeostasis_manager(force_profile).get_config()


# ============================================
# TESTING
# ============================================
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("TESTING SILHOUETTE HOMEOSTASIS SYSTEM")
    print("=" * 60)
    
    # Test with auto-detection
    manager = get_homeostasis_manager()
    
    print("\nEnvironment detected:")
    for key, value in manager.get_environment().to_dict().items():
        print(f"  {key}: {value}")
    
    print("\nConfiguration synthesized:")
    config = manager.get_config()
    print(f"  Profile: {config.profile_name}")
    print(f"  d_model: {config.d_model}")
    print(f"  num_layers: {config.num_layers}")
    print(f"  MoE experts: {config.num_experts} (active: {config.num_experts_per_tok})")
    print(f"  AGI Core Scale: {config.agi_core_scale * 100:.0f}%")
    print(f"  Quantization: {config.quantization}")
    print(f"  Estimated params: {config.estimated_params_millions:.1f}M")
    print(f"  Estimated VRAM: {config.estimated_vram_gb:.2f} GB")
    
    # Test profile forcing
    print("\n" + "-" * 60)
    print("Testing forced profiles...")
    
    for profile in ResourceProfile:
        forced_manager = HomeostasisManager(force_profile=profile.value)
        cfg = forced_manager.get_config()
        print(f"  {profile.value:20s}: d_model={cfg.d_model:4d}, layers={cfg.num_layers:2d}, "
              f"AGI={cfg.agi_core_scale*100:3.0f}%, params={cfg.estimated_params_millions:.1f}M")
    
    print("\n✅ Homeostasis system test passed!")
