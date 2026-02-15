"""
NANOSILHOUETTE - Curiosity Module
===================================
Implements intrinsic motivation for autonomous learning:
- Novelty detection (is this new?)
- Information gain estimation
- Exploration goals generation
- Active learning selection

This drives autonomous learning - seeking new knowledge.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass
from collections import deque
import numpy as np


@dataclass
class CuriosityConfig:
    """Configuration for curiosity module."""
    d_model: int = 512
    d_curiosity: int = 128
    memory_size: int = 10000  # Experiences for novelty comparison
    novelty_threshold: float = 0.7  # When to explore
    exploration_bonus_scale: float = 0.1
    icm_beta: float = 0.2  # Forward vs inverse model weight


class NoveltyDetector(nn.Module):
    """
    Detects novel/unfamiliar experiences.
    
    Uses prediction error as novelty signal.
    """
    
    def __init__(self, d_model: int, d_curiosity: int):
        super().__init__()
        
        # Encoder to curiosity space
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, d_curiosity),
            nn.LayerNorm(d_curiosity)
        )
        
        # Predictor (predicts encoding from context)
        self.predictor = nn.Sequential(
            nn.Linear(d_curiosity, d_curiosity),
            nn.SiLU(),
            nn.Linear(d_curiosity, d_curiosity)
        )
        
        # Memory of seen encodings
        self.memory: deque = deque(maxlen=10000)
        self.memory_tensor: Optional[torch.Tensor] = None
    
    def encode(self, hidden_states: torch.Tensor) -> torch.Tensor:
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        return self.encoder(pooled)
    
    def forward(self, hidden_states: torch.Tensor) -> Dict[str, torch.Tensor]:
        """
        Compute novelty score for experience.
        
        Returns:
            novelty_score: 0-1, how novel
            embedding: Curiosity space embedding
            prediction_error: Difference from predicted
        """
        encoding = self.encode(hidden_states)
        
        # Prediction error based novelty
        predicted = self.predictor(encoding)
        prediction_error = ((encoding - predicted) ** 2).mean(dim=-1)
        
        # Memory-based novelty (distance to nearest neighbor)
        memory_novelty = self._compute_memory_novelty(encoding)
        
        # Combined novelty
        novelty_score = 0.5 * torch.sigmoid(prediction_error * 10) + 0.5 * memory_novelty
        
        return {
            "novelty_score": novelty_score,
            "embedding": encoding,
            "prediction_error": prediction_error,
            "memory_novelty": memory_novelty
        }
    
    def _compute_memory_novelty(self, encoding: torch.Tensor) -> torch.Tensor:
        """Compute novelty based on distance to remembered experiences."""
        if len(self.memory) < 10:
            return torch.ones(encoding.shape[0], device=encoding.device)
        
        # Build memory tensor if needed
        if self.memory_tensor is None or len(self.memory) != self.memory_tensor.shape[0]:
            self.memory_tensor = torch.stack(list(self.memory)).to(encoding.device)
        
        # Distance to nearest neighbor
        distances = torch.cdist(encoding, self.memory_tensor)
        min_distance = distances.min(dim=-1)[0]
        
        # Normalize to 0-1
        novelty = torch.tanh(min_distance)
        
        return novelty
    
    def add_to_memory(self, encoding: torch.Tensor):
        """Add experience to novelty memory."""
        for i in range(encoding.shape[0]):
            self.memory.append(encoding[i].detach().cpu())
        self.memory_tensor = None  # Invalidate cache


class InformationGainEstimator(nn.Module):
    """
    Estimates expected information gain from an experience.
    
    Higher gain = more worth learning about.
    """
    
    def __init__(self, d_model: int, d_curiosity: int):
        super().__init__()
        
        # Current knowledge state estimator
        self.knowledge_state = nn.Sequential(
            nn.Linear(d_model, d_curiosity),
            nn.SiLU(),
            nn.Linear(d_curiosity, d_curiosity)
        )
        
        # Information gain predictor
        self.gain_predictor = nn.Sequential(
            nn.Linear(d_curiosity * 2, d_curiosity),
            nn.SiLU(),
            nn.Linear(d_curiosity, 1),
            nn.Softplus()  # Positive gain
        )
        
        # Track actual gains for calibration
        self.predicted_gains: List[float] = []
        self.actual_gains: List[float] = []
    
    def forward(
        self,
        current_hidden: torch.Tensor,
        potential_experience: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Estimate information gain from potential experience.
        """
        current_state = self.knowledge_state(
            current_hidden.mean(dim=1) if current_hidden.dim() == 3 else current_hidden
        )
        
        potential_state = self.knowledge_state(
            potential_experience.mean(dim=1) if potential_experience.dim() == 3 else potential_experience
        )
        
        # Combine states
        combined = torch.cat([current_state, potential_state], dim=-1)
        
        # Predict gain
        gain = self.gain_predictor(combined).squeeze(-1)
        
        # Confidence (based on state difference)
        state_diff = (current_state - potential_state).norm(dim=-1)
        confidence = torch.sigmoid(state_diff - 1)
        
        return {
            "expected_gain": gain,
            "confidence": confidence,
            "current_state": current_state,
            "potential_state": potential_state
        }


class ExplorationGoalGenerator(nn.Module):
    """
    Generates exploration goals based on curiosity.
    
    Creates sub-goals for exploring unknown territories.
    """
    
    def __init__(self, d_model: int, d_curiosity: int, num_goals: int = 8):
        super().__init__()
        self.num_goals = num_goals
        
        # Goal embedding bank (learnable archetypes)
        self.goal_bank = nn.Parameter(torch.randn(num_goals, d_curiosity))
        
        # Goal generator from context
        self.goal_generator = nn.Sequential(
            nn.Linear(d_model, d_curiosity * 2),
            nn.SiLU(),
            nn.Linear(d_curiosity * 2, d_curiosity * num_goals)
        )
        
        # Goal selector
        self.goal_selector = nn.Sequential(
            nn.Linear(d_model + d_curiosity, 64),
            nn.SiLU(),
            nn.Linear(64, 1)
        )
        
        # Goal descriptions
        self.goal_descriptions = [
            "explore_unknown_topic",
            "clarify_confusion",
            "find_counterexamples",
            "seek_explanation",
            "test_hypothesis",
            "gather_evidence",
            "verify_understanding",
            "expand_context"
        ]
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        curiosity_embedding: torch.Tensor
    ) -> Dict[str, Any]:
        """
        Generate exploration goals for current context.
        """
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        batch_size = pooled.shape[0]
        
        # Generate candidate goals
        generated = self.goal_generator(pooled)
        generated = generated.view(batch_size, self.num_goals, -1)
        
        # Combine with goal bank
        bank_expanded = self.goal_bank.unsqueeze(0).expand(batch_size, -1, -1)
        candidates = 0.5 * generated + 0.5 * bank_expanded
        
        # Score each goal based on context and curiosity
        scores = []
        for i in range(self.num_goals):
            combined = torch.cat([pooled, candidates[:, i]], dim=-1)
            score = self.goal_selector(combined)
            scores.append(score)
        
        scores = torch.cat(scores, dim=-1)  # (batch, num_goals)
        goal_probs = F.softmax(scores, dim=-1)
        
        # Select best goal
        best_goal_idx = goal_probs.argmax(dim=-1)
        best_goal = candidates[torch.arange(batch_size), best_goal_idx]
        
        return {
            "goal_probs": goal_probs,
            "best_goal_idx": best_goal_idx,
            "best_goal_name": [self.goal_descriptions[idx.item()] for idx in best_goal_idx],
            "best_goal_embedding": best_goal,
            "all_goals": candidates
        }


class ICMModule(nn.Module):
    """
    Intrinsic Curiosity Module (ICM).
    
    Computes intrinsic reward from prediction errors:
    - Forward model: predicts next state from current + action
    - Inverse model: predicts action from states
    """
    
    def __init__(self, d_model: int, d_curiosity: int, d_action: int = 64):
        super().__init__()
        self.d_action = d_action
        
        # State encoder
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_curiosity),
            nn.SiLU()
        )
        
        # Forward model: s_t + a_t -> s_{t+1}
        self.forward_model = nn.Sequential(
            nn.Linear(d_curiosity + d_action, d_curiosity * 2),
            nn.SiLU(),
            nn.Linear(d_curiosity * 2, d_curiosity)
        )
        
        # Inverse model: s_t + s_{t+1} -> a_t
        self.inverse_model = nn.Sequential(
            nn.Linear(d_curiosity * 2, d_curiosity),
            nn.SiLU(),
            nn.Linear(d_curiosity, d_action)
        )
        
        # Action encoder
        self.action_encoder = nn.Linear(d_model, d_action)
    
    def forward(
        self,
        current_state: torch.Tensor,
        next_state: torch.Tensor,
        action: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Compute ICM forward and inverse losses + intrinsic reward.
        """
        # Encode states
        if current_state.dim() == 3:
            current_state = current_state.mean(dim=1)
        if next_state.dim() == 3:
            next_state = next_state.mean(dim=1)
        
        phi_current = self.encoder(current_state)
        phi_next = self.encoder(next_state)
        
        # Derive action from state difference if not provided
        if action is None:
            action = self.action_encoder(next_state - current_state)
        
        # Forward model prediction
        forward_input = torch.cat([phi_current, action], dim=-1)
        predicted_next = self.forward_model(forward_input)
        
        # Forward loss (prediction error = intrinsic reward)
        forward_loss = ((predicted_next - phi_next.detach()) ** 2).mean(dim=-1)
        
        # Inverse model prediction
        inverse_input = torch.cat([phi_current, phi_next], dim=-1)
        predicted_action = self.inverse_model(inverse_input)
        
        # Inverse loss
        inverse_loss = ((predicted_action - action.detach()) ** 2).mean(dim=-1)
        
        # Intrinsic reward = forward prediction error (scaled)
        intrinsic_reward = forward_loss * 0.1  # Scale factor
        
        return {
            "intrinsic_reward": intrinsic_reward,
            "forward_loss": forward_loss,
            "inverse_loss": inverse_loss,
            "phi_current": phi_current,
            "phi_next": phi_next
        }


class CuriosityModule(nn.Module):
    """
    Complete Curiosity Module for intrinsic motivation.
    
    Integrates all curiosity-related components.
    """
    
    def __init__(self, config: Optional[CuriosityConfig] = None):
        super().__init__()
        self.config = config or CuriosityConfig()
        
        # Components
        self.novelty_detector = NoveltyDetector(
            self.config.d_model,
            self.config.d_curiosity
        )
        self.info_gain = InformationGainEstimator(
            self.config.d_model,
            self.config.d_curiosity
        )
        self.goal_generator = ExplorationGoalGenerator(
            self.config.d_model,
            self.config.d_curiosity
        )
        self.icm = ICMModule(
            self.config.d_model,
            self.config.d_curiosity
        )
        
        # Curiosity state
        self.current_goal: Optional[torch.Tensor] = None
        self.exploration_history: deque = deque(maxlen=1000)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        next_hidden: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Compute curiosity signals for current experience.
        """
        # Detect novelty
        novelty = self.novelty_detector(hidden_states)
        
        # Generate exploration goals
        goals = self.goal_generator(hidden_states, novelty["embedding"])
        
        # Compute intrinsic reward if we have transition
        intrinsic = None
        if next_hidden is not None:
            intrinsic = self.icm(hidden_states, next_hidden)
        
        # Combine for exploration bonus
        exploration_bonus = (
            novelty["novelty_score"] * self.config.exploration_bonus_scale
        )
        
        if intrinsic is not None:
            exploration_bonus = exploration_bonus + intrinsic["intrinsic_reward"]
        
        # Should explore?
        should_explore = novelty["novelty_score"] > self.config.novelty_threshold
        
        return {
            "novelty": novelty,
            "goals": goals,
            "intrinsic": intrinsic,
            "exploration_bonus": exploration_bonus,
            "should_explore": should_explore,
            "current_curiosity": novelty["novelty_score"].mean()
        }
    
    def compute_curiosity_loss(
        self,
        current_hidden: torch.Tensor,
        next_hidden: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Compute training loss for curiosity module.
        """
        icm_result = self.icm(current_hidden, next_hidden)
        
        # Weighted combination
        loss = (
            self.config.icm_beta * icm_result["forward_loss"].mean() +
            (1 - self.config.icm_beta) * icm_result["inverse_loss"].mean()
        )
        
        # Add novelty detector loss (self-prediction)
        novelty = self.novelty_detector(current_hidden)
        novelty_loss = novelty["prediction_error"].mean()
        
        total_loss = loss + 0.1 * novelty_loss
        
        return {
            "total": total_loss,
            "icm_forward": icm_result["forward_loss"].mean(),
            "icm_inverse": icm_result["inverse_loss"].mean(),
            "novelty": novelty_loss
        }
    
    def update_memory(self, hidden_states: torch.Tensor):
        """Update novelty memory with new experience."""
        encoding = self.novelty_detector.encode(hidden_states)
        self.novelty_detector.add_to_memory(encoding)
        
        self.exploration_history.append({
            "encoding": encoding.detach().cpu().mean(dim=0).numpy().tolist()
        })
    
    def get_exploration_stats(self) -> Dict[str, Any]:
        """Get curiosity/exploration statistics."""
        return {
            "memory_size": len(self.novelty_detector.memory),
            "exploration_history": len(self.exploration_history),
            "novelty_threshold": self.config.novelty_threshold
        }


def create_curiosity_module(d_model: int = 512) -> CuriosityModule:
    """Factory function for curiosity module."""
    config = CuriosityConfig(d_model=d_model)
    return CuriosityModule(config)


if __name__ == "__main__":
    print("Testing Curiosity Module...")
    
    module = create_curiosity_module(d_model=512)
    
    # Test forward pass
    current = torch.randn(2, 32, 512)
    next_state = torch.randn(2, 32, 512)
    
    result = module(current, next_state)
    
    print(f"Novelty score: {result['novelty']['novelty_score']}")
    print(f"Exploration goal: {result['goals']['best_goal_name']}")
    print(f"Intrinsic reward: {result['intrinsic']['intrinsic_reward']}")
    print(f"Should explore: {result['should_explore']}")
    
    # Test loss
    loss = module.compute_curiosity_loss(current, next_state)
    print(f"\nCuriosity loss: {loss['total'].item():.4f}")
    
    # Update memory
    module.update_memory(current)
    
    # Stats
    stats = module.get_exploration_stats()
    print(f"Memory size: {stats['memory_size']}")
    
    print("\n✅ Curiosity Module test passed!")
