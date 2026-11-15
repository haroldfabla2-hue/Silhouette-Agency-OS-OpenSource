"""
NANOSILHOUETTE - AGI Core
===========================
Master integrator for all AGI components:
- World Model (understanding environment)
- Self Model (self-awareness)
- Curiosity (intrinsic motivation)
- Goal System (autonomous agency)
- Evolution (self-improvement)

This is the "mind" that brings all components together.
"""
import torch
import torch.nn as nn
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from pathlib import Path
import json
import time

# Import all AGI components
from .world_model import WorldModel, create_world_model
from .self_model import SelfModel, create_self_model
from .curiosity_module import CuriosityModule, create_curiosity_module
from .goal_system import GoalSystem, create_goal_system


@dataclass
class AGICoreConfig:
    """Configuration for AGI Core."""
    d_model: int = 512
    
    # Component toggles
    enable_world_model: bool = True
    enable_self_model: bool = True
    enable_curiosity: bool = True
    enable_goals: bool = True
    
    # Integration settings
    awareness_threshold: float = 0.7
    curiosity_threshold: float = 0.6
    goal_update_frequency: int = 100
    
    # Storage
    memory_path: str = "./agi_memory"


class AGICore(nn.Module):
    """
    AGI Core - The integrated mind of NANOSILHOUETTE.
    
    This module integrates:
    1. World Model - Understanding cause and effect
    2. Self Model - Self-awareness and meta-cognition
    3. Curiosity - Intrinsic motivation to learn
    4. Goal System - Autonomous goal setting and planning
    
    Together, these enable the foundations of AGI:
    - Understanding the world
    - Understanding itself
    - Wanting to learn
    - Acting with purpose
    """
    
    def __init__(self, config: Optional[AGICoreConfig] = None):
        super().__init__()
        self.config = config or AGICoreConfig()
        
        # Initialize components
        if self.config.enable_world_model:
            self.world_model = create_world_model(self.config.d_model)
        else:
            self.world_model = None
        
        if self.config.enable_self_model:
            self.self_model = create_self_model(self.config.d_model)
        else:
            self.self_model = None
        
        if self.config.enable_curiosity:
            self.curiosity = create_curiosity_module(self.config.d_model)
        else:
            self.curiosity = None
        
        if self.config.enable_goals:
            self.goals = create_goal_system(self.config.d_model)
        else:
            self.goals = None
        
        # State tracking
        self.step_count = 0
        self.agi_state = {
            "awareness_level": 0.0,
            "curiosity_level": 0.0,
            "active_goals": 0,
            "world_understanding": 0.0
        }
        
        # Integration layers
        self.state_integrator = nn.Sequential(
            nn.Linear(self.config.d_model * 4, self.config.d_model * 2),
            nn.SiLU(),
            nn.Linear(self.config.d_model * 2, self.config.d_model),
            nn.LayerNorm(self.config.d_model)
        )
        
        self.decision_maker = nn.Sequential(
            nn.Linear(self.config.d_model, 256),
            nn.SiLU(),
            nn.Linear(256, 64),
            nn.SiLU(),
            nn.Linear(64, 4)  # [act, explore, learn, wait]
        )
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        output_logits: Optional[torch.Tensor] = None,
        next_hidden: Optional[torch.Tensor] = None,
        labels: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Complete AGI processing step.
        
        Returns comprehensive AGI state and decisions.
        """
        self.step_count += 1
        
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        batch_size = pooled.shape[0]
        result = {
            "step": self.step_count,
            "components": {}
        }
        
        # 1. World Model - Understand environment
        world_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
        if self.world_model is not None:
            world_encoding = self.world_model.encode_state(hidden_states)
            result["components"]["world"] = {
                "state_encoded": True,
                "state_dim": world_encoding.shape
            }
            
            if next_hidden is not None:
                world_prediction = self.world_model.predict_next(
                    world_encoding,
                    torch.randn(batch_size, 64, device=pooled.device)  # Action placeholder
                )
                result["components"]["world"]["prediction"] = {
                    "uncertainty": world_prediction["uncertainty"].mean().item()
                }
            
            # Pad to d_model if needed
            if world_encoding.shape[-1] < self.config.d_model:
                world_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
                world_state[:, :world_encoding.shape[-1]] = world_encoding
            else:
                world_state = world_encoding[:, :self.config.d_model]
        
        # 2. Self Model - Self-awareness
        self_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
        if self.self_model is not None:
            self_assessment = self.self_model(hidden_states, output_logits)
            
            self.agi_state["awareness_level"] = self_assessment["self_awareness_score"].mean().item()
            
            result["components"]["self"] = {
                "awareness_score": self.agi_state["awareness_level"],
                "should_respond": self_assessment["should_respond"].tolist(),
                "knowledge_score": self_assessment["knowledge"]["knowledge_score"].mean().item(),
                "capability": self_assessment["capability"]["domain_name"]
            }
            
            # Use self embedding
            self_emb = self_assessment["self_embedding"]
            if self_emb.dim() == 1:
                self_emb = self_emb.unsqueeze(0).expand(batch_size, -1)
            if self_emb.shape[-1] < self.config.d_model:
                self_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
                self_state[:, :self_emb.shape[-1]] = self_emb
            else:
                self_state = self_emb[:, :self.config.d_model]
        
        # 3. Curiosity - Intrinsic motivation
        curiosity_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
        if self.curiosity is not None:
            curiosity_result = self.curiosity(hidden_states, next_hidden)
            
            self.agi_state["curiosity_level"] = curiosity_result["current_curiosity"].item()
            
            result["components"]["curiosity"] = {
                "novelty_score": curiosity_result["novelty"]["novelty_score"].mean().item(),
                "exploration_goal": curiosity_result["goals"]["best_goal_name"],
                "should_explore": curiosity_result["should_explore"].tolist(),
                "exploration_bonus": curiosity_result["exploration_bonus"].mean().item()
            }
            
            # Use curiosity embedding
            cur_emb = curiosity_result["novelty"]["embedding"]
            if cur_emb.shape[-1] < self.config.d_model:
                curiosity_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
                curiosity_state[:, :cur_emb.shape[-1]] = cur_emb
            else:
                curiosity_state = cur_emb[:, :self.config.d_model]
            
            # Update curiosity memory
            self.curiosity.update_memory(hidden_states)
        
        # 4. Goal System - Autonomous agency
        goal_state = torch.zeros(batch_size, self.config.d_model, device=pooled.device)
        if self.goals is not None:
            # Generate goals periodically
            generate_new = (self.step_count % self.config.goal_update_frequency == 0)
            goal_result = self.goals(hidden_states, generate_new=generate_new)
            
            self.agi_state["active_goals"] = len(self.goals.active_goals)
            
            result["components"]["goals"] = {
                "total_goals": len(self.goals.goals),
                "active_goals": self.agi_state["active_goals"],
                "status": self.goals.get_status()
            }
            
            if generate_new and "generated_goals" in goal_result:
                top_goals = goal_result["generated_goals"]["top_goals"][0]
                result["components"]["goals"]["suggested"] = [g["type"] for g in top_goals]
        
        # 5. Integrate all states
        combined_state = torch.cat([
            pooled,
            world_state,
            self_state,
            curiosity_state
        ], dim=-1)
        
        integrated = self.state_integrator(combined_state)
        
        # 6. Make decision
        decision_logits = self.decision_maker(integrated)
        decision_probs = torch.softmax(decision_logits, dim=-1)
        decision_idx = decision_logits.argmax(dim=-1)
        
        decision_names = ["act", "explore", "learn", "wait"]
        
        result["integrated_state"] = integrated
        result["decision"] = {
            "action": [decision_names[idx.item()] for idx in decision_idx],
            "probabilities": {
                name: decision_probs[:, i].mean().item()
                for i, name in enumerate(decision_names)
            }
        }
        
        result["agi_state"] = self.agi_state.copy()
        
        return result
    
    def compute_agi_loss(
        self,
        current_hidden: torch.Tensor,
        next_hidden: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Compute combined AGI training losses.
        """
        losses = {}
        total = torch.tensor(0.0, device=current_hidden.device)
        
        # World model loss
        if self.world_model is not None:
            world_loss = self.world_model.compute_loss(current_hidden, next_hidden)
            losses["world"] = world_loss["total"]
            total = total + world_loss["total"]
        
        # Curiosity loss
        if self.curiosity is not None:
            curiosity_loss = self.curiosity.compute_curiosity_loss(current_hidden, next_hidden)
            losses["curiosity"] = curiosity_loss["total"]
            total = total + 0.1 * curiosity_loss["total"]
        
        losses["total"] = total
        
        return losses
    
    def think(
        self,
        context: torch.Tensor,
        depth: int = 3
    ) -> Dict[str, Any]:
        """
        Meta-cognitive thinking process.
        
        Uses all components to reason about a situation.
        """
        thoughts = []
        
        for i in range(depth):
            # Get current assessment
            assessment = self.forward(context)
            
            thought = {
                "depth": i,
                "awareness": assessment["agi_state"]["awareness_level"],
                "curiosity": assessment["agi_state"]["curiosity_level"],
                "decision": assessment["decision"]["action"]
            }
            thoughts.append(thought)
            
            # Evolve context based on decision
            context = context + 0.1 * assessment["integrated_state"].unsqueeze(1).expand_as(context)
        
        return {
            "thoughts": thoughts,
            "final_decision": thoughts[-1]["decision"],
            "thinking_depth": depth
        }
    
    def get_consciousness_report(self) -> Dict[str, Any]:
        """
        Generate a report on the model's "consciousness" state.
        
        This is a metaphorical report - not claiming actual consciousness,
        but reporting on the model's self-monitoring capabilities.
        """
        report = {
            "timestamp": time.time(),
            "step": self.step_count,
            "state": self.agi_state.copy(),
            "components": {}
        }
        
        # World understanding
        if self.world_model is not None:
            report["components"]["world_model"] = self.world_model.get_world_understanding()
        
        # Self knowledge
        if self.self_model is not None:
            report["components"]["self_model"] = self.self_model.get_self_description()
        
        # Curiosity
        if self.curiosity is not None:
            report["components"]["curiosity"] = self.curiosity.get_exploration_stats()
        
        # Goals
        if self.goals is not None:
            report["components"]["goals"] = self.goals.get_status()
        
        # Overall assessment
        awareness = self.agi_state.get("awareness_level", 0)
        curiosity = self.agi_state.get("curiosity_level", 0)
        
        report["overall"] = {
            "cognitive_integration": (awareness + curiosity) / 2,
            "operational_status": "active" if self.step_count > 0 else "dormant",
            "needs_attention": awareness < self.config.awareness_threshold
        }
        
        return report
    
    def save_state(self, path: Path):
        """Save AGI state to disk."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        # Save component states
        if self.self_model is not None:
            self.self_model.save_self_knowledge(path / "self_knowledge")
        
        if self.goals is not None:
            self.goals.save_goals(path / "goals")
        
        # Save overall state
        with open(path / "agi_state.json", "w") as f:
            json.dump({
                "step_count": self.step_count,
                "agi_state": self.agi_state,
                "config": {
                    "d_model": self.config.d_model,
                    "enable_world_model": self.config.enable_world_model,
                    "enable_self_model": self.config.enable_self_model,
                    "enable_curiosity": self.config.enable_curiosity,
                    "enable_goals": self.config.enable_goals
                }
            }, f, indent=2)
        
        # Save model weights
        torch.save(self.state_dict(), path / "agi_core.pt")


def create_agi_core(d_model: int = 512) -> AGICore:
    """Factory function for AGI Core."""
    config = AGICoreConfig(d_model=d_model)
    return AGICore(config)


# Convenience wrapper for existing models
class AGIEnhancedModel(nn.Module):
    """
    Wraps any base model with AGI capabilities.
    
    Usage:
        base_model = NanoSilhouetteModel(config)
        agi_model = AGIEnhancedModel(base_model)
        
        # Now has AGI capabilities
        output = agi_model(input_ids)
        print(output["agi"]["decision"])
    """
    
    def __init__(
        self,
        base_model: nn.Module,
        d_model: int = 512
    ):
        super().__init__()
        self.base_model = base_model
        self.agi_core = create_agi_core(d_model)
    
    def forward(
        self,
        input_ids: torch.Tensor,
        labels: Optional[torch.Tensor] = None,
        return_agi: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """Forward with AGI processing."""
        # Base model forward
        outputs = self.base_model(input_ids, labels=labels, **kwargs)
        
        # Extract what we need
        if isinstance(outputs, dict):
            logits = outputs.get("logits")
            hidden = outputs.get("hidden_states")
            loss = outputs.get("loss")
        else:
            logits = outputs
            hidden = None
            loss = None
        
        # AGI processing
        if return_agi and hidden is not None:
            agi_result = self.agi_core(
                hidden_states=hidden,
                output_logits=logits,
                labels=labels
            )
            
            if isinstance(outputs, dict):
                outputs["agi"] = agi_result
            else:
                outputs = {"logits": outputs, "agi": agi_result}
        
        return outputs
    
    def think(self, context: torch.Tensor, depth: int = 3) -> Dict[str, Any]:
        """Meta-cognitive thinking."""
        return self.agi_core.think(context, depth)
    
    def get_consciousness_report(self) -> Dict[str, Any]:
        """Get consciousness report."""
        return self.agi_core.get_consciousness_report()


if __name__ == "__main__":
    print("Testing AGI Core...")
    
    core = create_agi_core(d_model=512)
    
    # Test forward pass
    hidden = torch.randn(2, 32, 512)
    logits = torch.randn(2, 32, 1000)
    next_hidden = torch.randn(2, 32, 512)
    
    result = core(hidden, logits, next_hidden)
    
    print(f"\nAGI State:")
    print(f"  Awareness: {result['agi_state']['awareness_level']:.3f}")
    print(f"  Curiosity: {result['agi_state']['curiosity_level']:.3f}")
    print(f"  Decision: {result['decision']['action']}")
    
    print(f"\nComponent Status:")
    for comp, data in result["components"].items():
        print(f"  {comp}: active")
    
    # Test loss
    losses = core.compute_agi_loss(hidden, next_hidden)
    print(f"\nAGI Loss: {losses['total'].item():.4f}")
    
    # Test thinking
    thoughts = core.think(hidden, depth=2)
    print(f"\nThinking process:")
    for t in thoughts["thoughts"]:
        print(f"  Depth {t['depth']}: {t['decision']}")
    
    # Consciousness report
    report = core.get_consciousness_report()
    print(f"\nConsciousness Report:")
    print(f"  Cognitive integration: {report['overall']['cognitive_integration']:.3f}")
    print(f"  Status: {report['overall']['operational_status']}")
    
    print("\n✅ AGI Core test passed!")
