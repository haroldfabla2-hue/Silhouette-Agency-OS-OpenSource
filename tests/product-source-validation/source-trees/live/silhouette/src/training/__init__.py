# NANOSILHOUETTE Training Package
from .losses import NanoSilhouetteLoss
from .data_loader import TextDataset, StreamingTextDataset, create_dataloader
from .trainer import Trainer, TrainerConfig
from .memory_utils import (
    GradientCheckpointWrapper,
    apply_gradient_checkpointing,
    enable_memory_efficient_mode,
    VRAMMonitor
)
from .tokenizer import NanoSilhouetteTokenizer, create_tokenizer
from .quantization import (
    QuantizationConfig,
    quantize_model,
    apply_lora,
    get_trainable_params
)
from .lr_finder import (
    LRFinder,
    LRFinderConfig,
    OneCycleLR,
    WarmupCosineScheduler,
    find_lr
)
from .continual_learning import (
    ContinualLearner,
    ContinualConfig,
    FisherInformationMatrix,
    ExperienceReplay,
    create_continual_learner
)
from .dynamic_growth import (
    DynamicGrowthEngine,
    GrowthConfig,
    CapacityMonitor,
    create_growth_engine
)
from .self_improvement import (
    SelfImprovementEngine,
    SelfImprovementConfig,
    PerformanceTracker,
    SelfEvaluator,
    create_self_improvement_engine
)

__all__ = [
    # Core
    "NanoSilhouetteLoss",
    "TextDataset",
    "StreamingTextDataset", 
    "create_dataloader",
    "Trainer",
    "TrainerConfig",
    # Memory optimization
    "GradientCheckpointWrapper",
    "apply_gradient_checkpointing",
    "enable_memory_efficient_mode",
    "VRAMMonitor",
    # Tokenizer
    "NanoSilhouetteTokenizer",
    "create_tokenizer",
    # Quantization
    "QuantizationConfig",
    "quantize_model",
    "apply_lora",
    "get_trainable_params",
    # LR Finder
    "LRFinder",
    "LRFinderConfig",
    "OneCycleLR",
    "WarmupCosineScheduler",
    "find_lr",
    # Continual Learning
    "ContinualLearner",
    "ContinualConfig",
    "FisherInformationMatrix",
    "ExperienceReplay",
    "create_continual_learner",
    # Dynamic Growth
    "DynamicGrowthEngine",
    "GrowthConfig",
    "CapacityMonitor",
    "create_growth_engine",
    # Self-Improvement
    "SelfImprovementEngine",
    "SelfImprovementConfig",
    "PerformanceTracker",
    "SelfEvaluator",
    "create_self_improvement_engine"
]

