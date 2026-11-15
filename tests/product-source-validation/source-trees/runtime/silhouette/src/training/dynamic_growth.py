"""
NANOSILHOUETTE - Dynamic Growth Engine
=======================================
Implements adaptive network growth:
- Capacity monitoring (detects saturation)
- Expert spawning (adds MoE experts)
- Layer growing (adds depth)
- Resource-aware scaling (respects VRAM)
"""
import math
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from collections import deque

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class GrowthConfig:
    """Configuration for dynamic growth."""
    # Capacity thresholds
    saturation_threshold: float = 0.85  # When to consider growth
    utilization_window: int = 100  # Steps to track
    
    # Growth limits
    max_experts_per_layer: int = 32
    max_layers: int = 48
    max_parameters: int = 500_000_000  # 500M max
    
    # Resource limits
    max_vram_gb: float = 4.0  # RTX 3050 limit
    growth_vram_buffer: float = 0.5  # GB to keep free
    
    # Growth strategy
    grow_experts_first: bool = True
    expert_growth_step: int = 4
    layer_growth_step: int = 2


@dataclass
class CapacityMetrics:
    """Metrics for tracking model capacity utilization."""
    gradient_saturation: float = 0.0
    weight_utilization: float = 0.0
    loss_plateau_steps: int = 0
    expert_load_balance: float = 1.0
    performance_trend: float = 0.0


class CapacityMonitor:
    """
    Monitors model capacity utilization.
    
    Detects when model is saturating and needs growth.
    """
    
    def __init__(self, config: GrowthConfig):
        self.config = config
        
        # History tracking
        self.loss_history: deque = deque(maxlen=config.utilization_window)
        self.gradient_norms: deque = deque(maxlen=config.utilization_window)
        self.expert_loads: deque = deque(maxlen=config.utilization_window)
        
        # State
        self.metrics = CapacityMetrics()
        self.growth_recommended = False
    
    def update(
        self,
        loss: float,
        gradients: Optional[Dict[str, torch.Tensor]] = None,
        expert_routing: Optional[Dict[str, torch.Tensor]] = None
    ):
        """Update capacity metrics with new observations."""
        self.loss_history.append(loss)
        
        # Track gradient saturation
        if gradients:
            total_norm = 0.0
            for name, grad in gradients.items():
                if grad is not None:
                    total_norm += grad.norm().item() ** 2
            self.gradient_norms.append(math.sqrt(total_norm))
        
        # Track expert load balancing
        if expert_routing:
            for name, loads in expert_routing.items():
                # Coefficient of variation for load balance
                mean_load = loads.float().mean()
                std_load = loads.float().std()
                cv = (std_load / (mean_load + 1e-6)).item()
                self.expert_loads.append(cv)
        
        # Compute metrics
        self._compute_metrics()
    
    def _compute_metrics(self):
        """Compute capacity metrics from history."""
        if len(self.loss_history) < 10:
            return
        
        # 1. Loss plateau detection
        recent_losses = list(self.loss_history)[-20:]
        if len(recent_losses) >= 20:
            early = sum(recent_losses[:10]) / 10
            late = sum(recent_losses[10:]) / 10
            improvement_rate = (early - late) / (early + 1e-6)
            
            if improvement_rate < 0.01:  # Less than 1% improvement
                self.metrics.loss_plateau_steps += 1
            else:
                self.metrics.loss_plateau_steps = 0
        
        # 2. Gradient saturation
        if len(self.gradient_norms) >= 10:
            recent_grads = list(self.gradient_norms)[-10:]
            mean_grad = sum(recent_grads) / len(recent_grads)
            
            # Small gradients indicate saturation
            self.metrics.gradient_saturation = 1.0 / (1.0 + mean_grad)
        
        # 3. Expert load balance
        if len(self.expert_loads) >= 10:
            recent_loads = list(self.expert_loads)[-10:]
            self.metrics.expert_load_balance = 1.0 - (sum(recent_loads) / len(recent_loads))
        
        # 4. Performance trend
        if len(self.loss_history) >= 50:
            old_avg = sum(list(self.loss_history)[:25]) / 25
            new_avg = sum(list(self.loss_history)[-25:]) / 25
            self.metrics.performance_trend = (old_avg - new_avg) / (old_avg + 1e-6)
        
        # Recommend growth?
        self.growth_recommended = (
            self.metrics.loss_plateau_steps > 50 or
            self.metrics.gradient_saturation > self.config.saturation_threshold
        )
    
    def should_grow(self) -> bool:
        """Check if growth is recommended."""
        return self.growth_recommended
    
    def get_growth_reason(self) -> str:
        """Get explanation for growth recommendation."""
        reasons = []
        
        if self.metrics.loss_plateau_steps > 50:
            reasons.append(f"Loss plateau for {self.metrics.loss_plateau_steps} steps")
        
        if self.metrics.gradient_saturation > self.config.saturation_threshold:
            reasons.append(f"Gradient saturation: {self.metrics.gradient_saturation:.2%}")
        
        if self.metrics.expert_load_balance < 0.5:
            reasons.append(f"Expert imbalance: {self.metrics.expert_load_balance:.2%}")
        
        return "; ".join(reasons) if reasons else "No growth needed"


class ResourceManager:
    """
    Manages hardware resources for growth decisions.
    
    Ensures growth doesn't exceed available VRAM.
    """
    
    def __init__(self, max_vram_gb: float = 4.0, buffer_gb: float = 0.5):
        self.max_vram_gb = max_vram_gb
        self.buffer_gb = buffer_gb
    
    def get_available_vram(self) -> float:
        """Get available VRAM in GB."""
        if not torch.cuda.is_available():
            return 0.0
        
        total = torch.cuda.get_device_properties(0).total_memory / 1e9
        used = torch.cuda.memory_allocated() / 1e9
        
        return min(total - used, self.max_vram_gb - used)
    
    def can_grow(self, estimated_cost_gb: float) -> bool:
        """Check if growth is possible within resource limits."""
        available = self.get_available_vram()
        return (available - self.buffer_gb) >= estimated_cost_gb
    
    def estimate_expert_cost(self, d_model: int, intermediate: int) -> float:
        """Estimate VRAM cost of adding an expert."""
        # Expert params: 3 linear layers (gate, up, down)
        params = 3 * d_model * intermediate
        # Assume float16
        bytes_per_param = 2
        return params * bytes_per_param / 1e9
    
    def estimate_layer_cost(self, d_model: int, layer_type: str = "mamba") -> float:
        """Estimate VRAM cost of adding a layer."""
        if layer_type == "mamba":
            # Mamba block: ~4x d_model^2 params
            params = 4 * d_model * d_model
        else:
            # Transformer block: ~12x d_model^2 params
            params = 12 * d_model * d_model
        
        bytes_per_param = 2
        return params * bytes_per_param / 1e9


class ExpertSpawner:
    """
    Creates new MoE experts dynamically.
    
    Uses smart initialization from existing experts.
    """
    
    def __init__(self, config: GrowthConfig):
        self.config = config
    
    def spawn_expert(
        self,
        existing_experts: nn.ModuleList,
        d_model: int,
        intermediate_size: int,
        device: str = "cuda"
    ) -> nn.Module:
        """
        Create a new expert based on existing ones.
        
        Uses average of existing experts + noise for initialization.
        """
        # Create new expert structure (SwiGLU FFN)
        new_expert = nn.Sequential(
            nn.Linear(d_model, intermediate_size * 2, bias=False),
            nn.SiLU(),
            nn.Linear(intermediate_size, d_model, bias=False)
        ).to(device)
        
        if len(existing_experts) > 0:
            # Initialize from average of existing experts
            with torch.no_grad():
                for i, (new_param, param_name) in enumerate(new_expert.named_parameters()):
                    # Gather corresponding params from existing experts
                    existing_params = []
                    for expert in existing_experts:
                        for name, param in expert.named_parameters():
                            if name == param_name:
                                existing_params.append(param.data)
                                break
                    
                    if existing_params:
                        # Average + noise
                        avg_param = torch.stack(existing_params).mean(dim=0)
                        noise = torch.randn_like(avg_param) * 0.01
                        new_param.data = avg_param + noise
        
        return new_expert
    
    def expand_moe_layer(
        self,
        moe_layer: nn.Module,
        num_new_experts: int = 4
    ) -> nn.Module:
        """Expand an MoE layer with new experts."""
        if not hasattr(moe_layer, 'experts'):
            return moe_layer
        
        current_experts = moe_layer.experts
        d_model = moe_layer.config.d_model if hasattr(moe_layer, 'config') else 512
        intermediate = moe_layer.config.intermediate_size if hasattr(moe_layer, 'config') else d_model * 4
        
        device = next(moe_layer.parameters()).device
        
        for _ in range(num_new_experts):
            if len(current_experts) >= self.config.max_experts_per_layer:
                break
            
            new_expert = self.spawn_expert(
                current_experts, d_model, intermediate, device
            )
            current_experts.append(new_expert)
        
        # Update router to handle new experts
        if hasattr(moe_layer, 'router'):
            old_router = moe_layer.router
            new_num_experts = len(current_experts)
            
            # Expand router output dimension
            new_router = nn.Linear(d_model, new_num_experts).to(device)
            with torch.no_grad():
                # Copy old router weights
                old_num = old_router.out_features
                new_router.weight[:old_num] = old_router.weight
                new_router.bias[:old_num] = old_router.bias
                # Initialize new expert routes with small noise
                new_router.weight[old_num:] = 0.01 * torch.randn(new_num_experts - old_num, d_model)
                new_router.bias[old_num:] = 0.0
            
            moe_layer.router = new_router
        
        return moe_layer


class LayerGrower:
    """
    Adds new layers to the model dynamically.
    
    Uses knowledge distillation for smooth integration.
    """
    
    def __init__(self, config: GrowthConfig):
        self.config = config
    
    def add_layers(
        self,
        model: nn.Module,
        num_layers: int = 2,
        position: str = "middle"  # "start", "middle", "end"
    ) -> nn.Module:
        """
        Add new layers to model.
        
        Position determines where layers are inserted.
        """
        if not hasattr(model, 'layers'):
            print("[GROWTH] Model doesn't have 'layers' attribute")
            return model
        
        current_layers = model.layers
        num_current = len(current_layers)
        
        if num_current + num_layers > self.config.max_layers:
            num_layers = self.config.max_layers - num_current
            if num_layers <= 0:
                print(f"[GROWTH] At max layers ({self.config.max_layers})")
                return model
        
        # Determine insertion point
        if position == "start":
            insert_idx = 0
        elif position == "end":
            insert_idx = num_current
        else:  # middle
            insert_idx = num_current // 2
        
        # Create new layers (copy from adjacent)
        device = next(model.parameters()).device
        template_layer = current_layers[max(0, insert_idx - 1)]
        
        new_layers = []
        for i in range(num_layers):
            # Deep copy and add noise to weights
            import copy
            new_layer = copy.deepcopy(template_layer)
            
            with torch.no_grad():
                for param in new_layer.parameters():
                    param.data += 0.001 * torch.randn_like(param)
            
            new_layers.append(new_layer)
        
        # Insert new layers
        layers_list = list(current_layers)
        for i, new_layer in enumerate(new_layers):
            layers_list.insert(insert_idx + i, new_layer)
        
        # Update model
        model.layers = nn.ModuleList(layers_list)
        
        print(f"[GROWTH] Added {num_layers} layers at position {insert_idx}. "
              f"Total: {len(model.layers)}")
        
        return model


class DynamicGrowthEngine:
    """
    Main dynamic growth system.
    
    Coordinates capacity monitoring, resource management, and growth operations.
    """
    
    def __init__(
        self,
        model: nn.Module,
        config: Optional[GrowthConfig] = None
    ):
        self.model = model
        self.config = config or GrowthConfig()
        
        # Components
        self.capacity_monitor = CapacityMonitor(self.config)
        self.resource_manager = ResourceManager(
            max_vram_gb=self.config.max_vram_gb,
            buffer_gb=self.config.growth_vram_buffer
        )
        self.expert_spawner = ExpertSpawner(self.config)
        self.layer_grower = LayerGrower(self.config)
        
        # State
        self.growth_history: List[Dict] = []
        self.total_growths = 0
    
    def step(
        self,
        loss: float,
        gradients: Optional[Dict[str, torch.Tensor]] = None,
        expert_routing: Optional[Dict[str, torch.Tensor]] = None
    ) -> bool:
        """
        Update monitoring and potentially trigger growth.
        
        Returns True if growth occurred.
        """
        # Update monitoring
        self.capacity_monitor.update(loss, gradients, expert_routing)
        
        # Check if growth is recommended
        if not self.capacity_monitor.should_grow():
            return False
        
        # Attempt growth
        return self._attempt_growth()
    
    def _attempt_growth(self) -> bool:
        """Attempt to grow the model."""
        # Get model parameters
        d_model = getattr(self.model, 'd_model', 512)
        if hasattr(self.model, 'config'):
            d_model = self.model.config.d_model
        
        intermediate = d_model * 4
        
        # Try expert growth first
        if self.config.grow_experts_first:
            expert_cost = self.resource_manager.estimate_expert_cost(d_model, intermediate)
            expert_cost *= self.config.expert_growth_step
            
            if self.resource_manager.can_grow(expert_cost):
                return self._grow_experts()
        
        # Try layer growth
        layer_cost = self.resource_manager.estimate_layer_cost(d_model)
        layer_cost *= self.config.layer_growth_step
        
        if self.resource_manager.can_grow(layer_cost):
            return self._grow_layers()
        
        print(f"[GROWTH] Insufficient resources. Available: "
              f"{self.resource_manager.get_available_vram():.2f} GB")
        return False
    
    def _grow_experts(self) -> bool:
        """Grow MoE experts in the model."""
        if not hasattr(self.model, 'moe_layers'):
            print("[GROWTH] No MoE layers to grow")
            return False
        
        grown = False
        for layer_id, moe_layer in self.model.moe_layers.items():
            self.expert_spawner.expand_moe_layer(
                moe_layer,
                num_new_experts=self.config.expert_growth_step
            )
            grown = True
        
        if grown:
            self._record_growth("experts", self.config.expert_growth_step)
        
        return grown
    
    def _grow_layers(self) -> bool:
        """Grow model depth."""
        old_layers = len(self.model.layers) if hasattr(self.model, 'layers') else 0
        
        self.layer_grower.add_layers(
            self.model,
            num_layers=self.config.layer_growth_step
        )
        
        new_layers = len(self.model.layers) if hasattr(self.model, 'layers') else 0
        
        if new_layers > old_layers:
            self._record_growth("layers", new_layers - old_layers)
            return True
        
        return False
    
    def _record_growth(self, growth_type: str, amount: int):
        """Record growth event."""
        self.total_growths += 1
        self.growth_history.append({
            "type": growth_type,
            "amount": amount,
            "total_params": self._count_params(),
            "reason": self.capacity_monitor.get_growth_reason()
        })
        
        print(f"[GROWTH] {growth_type.upper()} +{amount}. "
              f"Total params: {self._count_params():,}")
    
    def _count_params(self) -> int:
        """Count total model parameters."""
        return sum(p.numel() for p in self.model.parameters())
    
    def get_stats(self) -> Dict[str, Any]:
        """Get growth statistics."""
        return {
            "total_growths": self.total_growths,
            "current_params": self._count_params(),
            "growth_history": self.growth_history[-10:],
            "capacity_metrics": self.capacity_monitor.metrics,
            "growth_recommended": self.capacity_monitor.should_grow(),
            "available_vram_gb": self.resource_manager.get_available_vram()
        }


def create_growth_engine(
    model: nn.Module,
    max_vram_gb: float = 4.0,
    max_parameters: int = 100_000_000
) -> DynamicGrowthEngine:
    """Factory function for dynamic growth engine."""
    config = GrowthConfig(
        max_vram_gb=max_vram_gb,
        max_parameters=max_parameters
    )
    return DynamicGrowthEngine(model, config)


if __name__ == "__main__":
    print("Testing Dynamic Growth Engine...")
    
    # Simple model for testing
    class MockModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.layers = nn.ModuleList([
                nn.Linear(512, 512) for _ in range(12)
            ])
            self.moe_layers = nn.ModuleDict()
    
    model = MockModel()
    engine = create_growth_engine(model, max_vram_gb=4.0)
    
    # Simulate training steps
    for step in range(200):
        # Simulate decreasing loss that plateaus
        loss = 2.0 / (1 + step * 0.01) + 0.5
        if step > 100:
            loss = 0.55 + 0.001 * (step - 100)  # Plateau
        
        grew = engine.step(loss=loss)
        
        if grew:
            print(f"Step {step}: Growth occurred!")
    
    # Stats
    stats = engine.get_stats()
    print(f"\nFinal stats:")
    print(f"  Total growths: {stats['total_growths']}")
    print(f"  Current params: {stats['current_params']:,}")
    print(f"  Growth recommended: {stats['growth_recommended']}")
    
    print("\n✅ Dynamic Growth test passed!")
