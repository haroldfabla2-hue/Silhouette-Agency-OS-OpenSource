"""
NANOSILHOUETTE - Evolution Orchestrator
========================================
Main orchestrator that integrates all self-evolution systems:
- Eternal Memory (semantic + episodic)
- Continual Learning (EWC + replay)
- Dynamic Growth (MoE expansion)
- Self-Improvement (meta-learning)

This is the "brain" that coordinates autonomous evolution.
"""
import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass

import torch
import torch.nn as nn

# Import evolution components
from ..model.eternal_memory import EternalMemory
from .continual_learning import ContinualLearner, ContinualConfig, create_continual_learner
from .dynamic_growth import DynamicGrowthEngine, GrowthConfig, create_growth_engine
from .self_improvement import SelfImprovementEngine, SelfImprovementConfig, create_self_improvement_engine


@dataclass
class EvolutionConfig:
    """Master configuration for evolution system."""
    # Memory settings
    memory_path: str = "./memory"
    d_embedding: int = 256
    
    # Continual learning
    ewc_lambda: float = 1000.0
    replay_buffer_size: int = 10000
    
    # Dynamic growth
    max_vram_gb: float = 4.0
    max_parameters: int = 100_000_000  # 100M limit
    grow_on_plateau: bool = True
    
    # Self-improvement
    eval_frequency: int = 100
    self_train: bool = True
    
    # Orchestration
    consolidation_frequency: int = 1000  # Steps between memory consolidation
    improvement_check_frequency: int = 500
    verbose: bool = True


class EvolutionOrchestrator:
    """
    Master orchestrator for NANOSILHOUETTE self-evolution.
    
    Coordinates all evolution subsystems to create an
    autonomously improving model.
    """
    
    def __init__(
        self,
        model: nn.Module,
        config: Optional[EvolutionConfig] = None,
        device: str = "cuda"
    ):
        self.model = model
        self.config = config or EvolutionConfig()
        self.device = device
        
        # Initialize evolution components
        self._initialize_components()
        
        # State tracking
        self.current_step = 0
        self.evolution_events: list = []
        self.is_evolving = False
    
    def _initialize_components(self):
        """Initialize all evolution subsystems."""
        # 1. Eternal Memory - for persistent knowledge
        self.memory = EternalMemory(
            storage_path=Path(self.config.memory_path),
            d_embedding=self.config.d_embedding
        )
        
        # 2. Continual Learner - prevents catastrophic forgetting
        self.continual_learner = create_continual_learner(
            model=self.model,
            ewc_lambda=self.config.ewc_lambda,
            replay_buffer_size=self.config.replay_buffer_size
        )
        
        # 3. Dynamic Growth Engine - adaptive scaling
        self.growth_engine = create_growth_engine(
            model=self.model,
            max_vram_gb=self.config.max_vram_gb,
            max_parameters=self.config.max_parameters
        )
        
        # 4. Self-Improvement Engine - meta-learning
        self.self_improvement = create_self_improvement_engine(
            model=self.model,
            device=self.device
        )
        
        if self.config.verbose:
            print("[EVOLUTION] All subsystems initialized:")
            print(f"  - Eternal Memory: {self.memory.get_stats()}")
            print(f"  - Continual Learning: {self.continual_learner.get_stats()}")
            print(f"  - Dynamic Growth: {self.growth_engine.get_stats()}")
    
    def step(
        self,
        batch: Dict[str, torch.Tensor],
        loss: torch.Tensor,
        logits: Optional[torch.Tensor] = None,
        hidden_states: Optional[torch.Tensor] = None,
        gradients: Optional[Dict[str, torch.Tensor]] = None
    ) -> Tuple[torch.Tensor, Dict[str, Any]]:
        """
        Perform one evolution step during training.
        
        Args:
            batch: Training batch with input_ids and labels
            loss: Current training loss
            logits: Model output logits
            hidden_states: Model hidden states
            gradients: Parameter gradients
        
        Returns:
            Modified loss with evolution regularization
            Dict of evolution events and metrics
        """
        self.current_step += 1
        events = {}
        
        # 1. Continual Learning regularization
        modified_loss, cl_components = self.continual_learner.training_step(
            batch=batch,
            base_loss=loss,
            device=self.device
        )
        events["continual_learning"] = cl_components
        
        # 2. Self-improvement monitoring
        improvement_actions = self.self_improvement.step(
            loss=loss.item(),
            logits=logits,
            labels=batch.get("labels"),
            hidden_states=hidden_states
        )
        events["self_improvement"] = improvement_actions
        
        # 3. Dynamic growth check
        grew = self.growth_engine.step(
            loss=loss.item(),
            gradients=gradients,
            expert_routing=None  # Would come from MoE layer
        )
        if grew:
            events["growth"] = {
                "occurred": True,
                "stats": self.growth_engine.get_stats()
            }
            self._record_event("growth", self.growth_engine.get_stats())
        
        # 4. Memory operations
        if hidden_states is not None:
            # Remember important experiences
            if loss.item() > 0:  # High-loss = important
                importance = min(1.0, loss.item() / 2.0)
                content = f"Training step {self.current_step}"
                self.memory.remember(
                    content=content,
                    hidden_states=hidden_states,
                    memory_type="episodic",
                    importance=importance,
                    context={"step": self.current_step, "loss": loss.item()}
                )
        
        # 5. Periodic consolidation
        if self.current_step % self.config.consolidation_frequency == 0:
            self.memory.consolidate()
            events["consolidation"] = True
        
        # 6. Periodic improvement analysis
        if self.current_step % self.config.improvement_check_frequency == 0:
            improvement_plan = self.self_improvement.get_improvement_plan()
            events["improvement_plan"] = improvement_plan
            
            if self.config.verbose and improvement_plan["priority"] == "high":
                print(f"[EVOLUTION] High-priority improvement needed at step {self.current_step}")
                for action in improvement_plan["recommended_actions"]:
                    print(f"  - {action['action']}: {action.get('suggestion', '')}")
        
        return modified_loss, events
    
    def on_new_task(self, task_name: str = None, dataloader = None):
        """
        Called when starting a new learning task.
        
        Prepares continual learning for task transition.
        """
        self.continual_learner.start_new_task(task_name)
        
        if dataloader is not None:
            # Compute EWC after finishing previous task
            self.continual_learner.compute_ewc(dataloader, self.device)
        
        self._record_event("new_task", {"name": task_name})
    
    def recall_relevant(
        self,
        query: str = None,
        hidden_states: Optional[torch.Tensor] = None,
        top_k: int = 5
    ) -> Dict[str, Any]:
        """
        Recall relevant memories for current context.
        
        Can be used during inference for memory-augmented generation.
        """
        return self.memory.recall(
            query=query,
            hidden_states=hidden_states,
            top_k=top_k
        )
    
    def save_state(self, path: Path):
        """Save evolution state to disk."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        # Save evolution history
        import json
        with open(path / "evolution_events.json", "w") as f:
            json.dump(self.evolution_events, f, indent=2, default=str)
        
        # Memory is auto-saved
        
        # Save stats
        stats = self.get_comprehensive_stats()
        with open(path / "evolution_stats.json", "w") as f:
            json.dump(stats, f, indent=2, default=str)
        
        if self.config.verbose:
            print(f"[EVOLUTION] State saved to {path}")
    
    def _record_event(self, event_type: str, data: Dict):
        """Record an evolution event."""
        self.evolution_events.append({
            "type": event_type,
            "step": self.current_step,
            "timestamp": time.time(),
            "data": data
        })
    
    def get_comprehensive_stats(self) -> Dict[str, Any]:
        """Get comprehensive evolution statistics."""
        return {
            "step": self.current_step,
            "memory": self.memory.get_stats(),
            "continual_learning": self.continual_learner.get_stats(),
            "growth": self.growth_engine.get_stats(),
            "self_improvement": self.self_improvement.get_stats(),
            "total_events": len(self.evolution_events),
            "recent_events": self.evolution_events[-10:]
        }
    
    def get_model_status(self) -> Dict[str, Any]:
        """Get current model status for monitoring."""
        params = sum(p.numel() for p in self.model.parameters())
        trainable = sum(p.numel() for p in self.model.parameters() if p.requires_grad)
        
        return {
            "total_parameters": params,
            "trainable_parameters": trainable,
            "evolution_step": self.current_step,
            "memory_entries": self.memory.get_stats()["episodic_memories"],
            "semantic_concepts": self.memory.get_stats()["semantic_concepts"],
            "growth_events": len([e for e in self.evolution_events if e["type"] == "growth"]),
            "can_grow": self.growth_engine.resource_manager.get_available_vram() > 0.5
        }


def create_evolution_orchestrator(
    model: nn.Module,
    memory_path: str = "./memory",
    max_vram_gb: float = 4.0,
    device: str = "cuda"
) -> EvolutionOrchestrator:
    """Factory function for evolution orchestrator."""
    config = EvolutionConfig(
        memory_path=memory_path,
        max_vram_gb=max_vram_gb
    )
    return EvolutionOrchestrator(model, config, device)


# Convenience class for simple integration
class AutoEvolvingModel(nn.Module):
    """
    Wrapper that adds automatic evolution to any model.
    
    Usage:
        model = YourModel()
        evolving_model = AutoEvolvingModel(model)
        
        # Training loop
        for batch in dataloader:
            output, evolution_info = evolving_model(batch)
    """
    
    def __init__(
        self,
        base_model: nn.Module,
        evolution_config: Optional[EvolutionConfig] = None,
        device: str = "cuda"
    ):
        super().__init__()
        self.base_model = base_model
        self.orchestrator = EvolutionOrchestrator(
            base_model,
            evolution_config,
            device
        )
        self.device = device
    
    def forward(
        self,
        input_ids: torch.Tensor,
        labels: Optional[torch.Tensor] = None,
        return_evolution_info: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """Forward pass with automatic evolution tracking."""
        # Base model forward
        outputs = self.base_model(input_ids, labels=labels, **kwargs)
        
        if not self.training or labels is None:
            return outputs
        
        # Evolution step during training
        batch = {"input_ids": input_ids, "labels": labels}
        loss = outputs["loss"] if isinstance(outputs, dict) else outputs
        logits = outputs.get("logits") if isinstance(outputs, dict) else None
        hidden = outputs.get("hidden_states") if isinstance(outputs, dict) else None
        
        evolved_loss, evolution_info = self.orchestrator.step(
            batch=batch,
            loss=loss,
            logits=logits,
            hidden_states=hidden
        )
        
        # Update loss
        if isinstance(outputs, dict):
            outputs["loss"] = evolved_loss
            if return_evolution_info:
                outputs["evolution"] = evolution_info
        
        return outputs
    
    def get_stats(self) -> Dict[str, Any]:
        """Get evolution statistics."""
        return self.orchestrator.get_comprehensive_stats()
    
    def get_status(self) -> Dict[str, Any]:
        """Get current model status."""
        return self.orchestrator.get_model_status()


if __name__ == "__main__":
    print("Testing Evolution Orchestrator...")
    
    # Simple test model
    class MockModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.layers = nn.ModuleList([
                nn.Linear(512, 512) for _ in range(4)
            ])
            self.output = nn.Linear(512, 100)
        
        def forward(self, input_ids, labels=None, **kwargs):
            x = torch.randn(input_ids.shape[0], 32, 512, device=input_ids.device)
            for layer in self.layers:
                x = torch.relu(layer(x))
            logits = self.output(x)
            
            loss = None
            if labels is not None:
                loss = torch.nn.functional.cross_entropy(
                    logits.view(-1, 100),
                    labels.view(-1)
                )
            
            return {"logits": logits, "loss": loss, "hidden_states": x}
    
    # Create model and orchestrator
    model = MockModel()
    orchestrator = create_evolution_orchestrator(
        model,
        memory_path="./test_evolution",
        max_vram_gb=4.0,
        device="cpu"
    )
    
    # Simulate training
    print("\nRunning evolution simulation...")
    for step in range(100):
        input_ids = torch.randint(0, 100, (4, 32))
        labels = torch.randint(0, 100, (4, 32))
        batch = {"input_ids": input_ids, "labels": labels}
        
        outputs = model(input_ids, labels=labels)
        
        modified_loss, events = orchestrator.step(
            batch=batch,
            loss=outputs["loss"],
            logits=outputs["logits"],
            hidden_states=outputs["hidden_states"]
        )
        
        if step > 0 and step % 25 == 0:
            print(f"Step {step}: loss={modified_loss.item():.4f}")
    
    # Final stats
    print("\nFinal Evolution Stats:")
    stats = orchestrator.get_comprehensive_stats()
    print(f"  Memory: {stats['memory']}")
    print(f"  Continual Learning: {stats['continual_learning']}")
    print(f"  Growth: {stats['growth']}")
    
    status = orchestrator.get_model_status()
    print(f"\nModel Status:")
    print(f"  Parameters: {status['total_parameters']:,}")
    print(f"  Memory entries: {status['memory_entries']}")
    
    print("\n✅ Evolution Orchestrator test passed!")
