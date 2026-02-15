"""
NANOSILHOUETTE - Advanced Goal System
========================================
State-of-the-art goal management with:
- Hierarchical Reinforcement Learning (Options)
- MAXQ decomposition
- Goal-conditioned policies
- Hindsight Experience Replay (HER)
- Abstract goal reasoning

Based on: Options Framework, MAXQ, HER, HAM, Goal-Conditioned RL
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple, Callable
from dataclasses import dataclass, field
from collections import deque
from enum import Enum
import numpy as np
import json
from pathlib import Path
import heapq
import time


class GoalLevel(Enum):
    """Hierarchical goal levels."""
    STRATEGIC = 0  # Long-term, abstract
    TACTICAL = 1   # Medium-term, plans
    OPERATIONAL = 2  # Short-term, actions


@dataclass
class HierarchicalGoal:
    """A goal in the hierarchy."""
    id: str
    level: GoalLevel
    description: str
    embedding: Optional[torch.Tensor] = None
    parent_id: Optional[str] = None
    children: List[str] = field(default_factory=list)
    success_condition: Optional[Callable] = None
    timeout_steps: int = 1000
    created_at: float = field(default_factory=time.time)
    completed: bool = False
    reward: float = 0.0


@dataclass
class AdvancedGoalConfig:
    """Configuration for advanced goal system."""
    d_model: int = 512
    d_goal: int = 256
    num_options: int = 16
    max_option_length: int = 50
    her_k: int = 4  # HER future goals
    hierarchy_depth: int = 3
    planning_horizon: int = 20


class Option(nn.Module):
    """
    An Option in the Options Framework.
    
    Represents a temporally extended action with:
    - Initiation set (when can start)
    - Policy (what to do)
    - Termination condition (when to stop)
    """
    
    def __init__(
        self,
        option_id: int,
        d_state: int,
        d_action: int,
        d_goal: int
    ):
        super().__init__()
        self.option_id = option_id
        
        # Initiation set (can this option be started?)
        self.initiation = nn.Sequential(
            nn.Linear(d_state + d_goal, 256),
            nn.SiLU(),
            nn.Linear(256, 1),
            nn.Sigmoid()
        )
        
        # Intra-option policy
        self.policy = nn.Sequential(
            nn.Linear(d_state + d_goal, 512),
            nn.SiLU(),
            nn.Linear(512, 256),
            nn.SiLU(),
            nn.Linear(256, d_action)
        )
        
        # Termination condition
        self.termination = nn.Sequential(
            nn.Linear(d_state + d_goal, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Value function for this option
        self.value = nn.Sequential(
            nn.Linear(d_state + d_goal, 256),
            nn.SiLU(),
            nn.Linear(256, 1)
        )
    
    def can_initiate(self, state: torch.Tensor, goal: torch.Tensor) -> torch.Tensor:
        """Check if option can be initiated."""
        combined = torch.cat([state, goal], dim=-1)
        return self.initiation(combined).squeeze(-1)
    
    def get_action(self, state: torch.Tensor, goal: torch.Tensor) -> torch.Tensor:
        """Get action from intra-option policy."""
        combined = torch.cat([state, goal], dim=-1)
        return self.policy(combined)
    
    def should_terminate(self, state: torch.Tensor, goal: torch.Tensor) -> torch.Tensor:
        """Check if option should terminate."""
        combined = torch.cat([state, goal], dim=-1)
        return self.termination(combined).squeeze(-1)
    
    def get_value(self, state: torch.Tensor, goal: torch.Tensor) -> torch.Tensor:
        """Get value of state under this option."""
        combined = torch.cat([state, goal], dim=-1)
        return self.value(combined).squeeze(-1)


class OptionCritic(nn.Module):
    """
    Option-Critic architecture for learning options end-to-end.
    """
    
    def __init__(
        self,
        d_state: int,
        d_action: int,
        d_goal: int,
        num_options: int
    ):
        super().__init__()
        self.num_options = num_options
        
        # Options
        self.options = nn.ModuleList([
            Option(i, d_state, d_action, d_goal)
            for i in range(num_options)
        ])
        
        # Policy over options (which option to choose)
        self.option_policy = nn.Sequential(
            nn.Linear(d_state + d_goal, 256),
            nn.SiLU(),
            nn.Linear(256, num_options)
        )
        
        # Option value function Q(s, o)
        self.option_value = nn.Sequential(
            nn.Linear(d_state + d_goal, 256),
            nn.SiLU(),
            nn.Linear(256, num_options)
        )
    
    def get_option_probs(
        self,
        state: torch.Tensor,
        goal: torch.Tensor,
        available_mask: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Get probability distribution over options."""
        combined = torch.cat([state, goal], dim=-1)
        logits = self.option_policy(combined)
        
        # Check initiation conditions
        if available_mask is None:
            available_mask = torch.stack([
                opt.can_initiate(state, goal) > 0.5
                for opt in self.options
            ], dim=-1)
        
        # Mask unavailable options
        logits = logits.masked_fill(~available_mask, float('-inf'))
        
        return F.softmax(logits, dim=-1)
    
    def select_option(
        self,
        state: torch.Tensor,
        goal: torch.Tensor,
        explore: bool = True
    ) -> Tuple[int, torch.Tensor]:
        """Select an option to execute."""
        probs = self.get_option_probs(state, goal)
        
        if explore:
            # Sample from distribution
            dist = torch.distributions.Categorical(probs)
            option_idx = dist.sample()
        else:
            # Greedy selection
            option_idx = probs.argmax(dim=-1)
        
        return option_idx, probs
    
    def execute_option(
        self,
        option_idx: int,
        state: torch.Tensor,
        goal: torch.Tensor
    ) -> Tuple[torch.Tensor, bool]:
        """Execute selected option."""
        option = self.options[option_idx]
        
        action = option.get_action(state, goal)
        terminate = option.should_terminate(state, goal) > 0.5
        
        return action, terminate.item() if terminate.dim() == 0 else terminate[0].item()


class GoalConditionedPolicy(nn.Module):
    """
    Goal-conditioned policy network.
    
    Learns to achieve arbitrary goals.
    """
    
    def __init__(self, d_state: int, d_goal: int, d_action: int):
        super().__init__()
        
        # Goal encoder
        self.goal_encoder = nn.Sequential(
            nn.Linear(d_goal, d_goal),
            nn.LayerNorm(d_goal),
            nn.SiLU()
        )
        
        # State encoder
        self.state_encoder = nn.Sequential(
            nn.Linear(d_state, d_goal),
            nn.LayerNorm(d_goal),
            nn.SiLU()
        )
        
        # Combined policy
        self.policy = nn.Sequential(
            nn.Linear(d_goal * 2, 512),
            nn.SiLU(),
            nn.Linear(512, 256),
            nn.SiLU()
        )
        
        # Action heads (mean and log_std for continuous)
        self.action_mean = nn.Linear(256, d_action)
        self.action_log_std = nn.Parameter(torch.zeros(d_action))
    
    def forward(
        self,
        state: torch.Tensor,
        goal: torch.Tensor,
        deterministic: bool = False
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Get action for state-goal pair."""
        state_enc = self.state_encoder(state)
        goal_enc = self.goal_encoder(goal)
        
        combined = torch.cat([state_enc, goal_enc], dim=-1)
        features = self.policy(combined)
        
        mean = self.action_mean(features)
        std = torch.exp(self.action_log_std)
        
        if deterministic:
            return mean, torch.zeros_like(mean)
        
        # Sample action
        dist = torch.distributions.Normal(mean, std)
        action = dist.rsample()
        log_prob = dist.log_prob(action).sum(dim=-1)
        
        return action, log_prob


class HindsightExperienceReplay:
    """
    Hindsight Experience Replay (HER).
    
    Learns from failures by reinterpreting goals.
    """
    
    def __init__(
        self,
        buffer_size: int = 100000,
        k: int = 4  # Number of additional goals per transition
    ):
        self.buffer_size = buffer_size
        self.k = k
        
        # Episode storage
        self.episodes: deque = deque(maxlen=1000)
        self.current_episode: List[Dict] = []
        
        # Flattened replay buffer
        self.buffer: deque = deque(maxlen=buffer_size)
    
    def start_episode(self):
        """Start a new episode."""
        self.current_episode = []
    
    def add_transition(
        self,
        state: np.ndarray,
        action: np.ndarray,
        next_state: np.ndarray,
        goal: np.ndarray,
        achieved_goal: np.ndarray,
        reward: float,
        done: bool
    ):
        """Add transition to current episode."""
        self.current_episode.append({
            "state": state,
            "action": action,
            "next_state": next_state,
            "goal": goal,
            "achieved_goal": achieved_goal,
            "reward": reward,
            "done": done
        })
    
    def end_episode(self):
        """End episode and add HER goals."""
        if not self.current_episode:
            return
        
        episode = self.current_episode.copy()
        self.episodes.append(episode)
        
        # Add original transitions
        for trans in episode:
            self.buffer.append(trans)
        
        # Add hindsight transitions
        for t, trans in enumerate(episode):
            # Sample k future goals
            future_indices = list(range(t + 1, len(episode)))
            if not future_indices:
                continue
            
            sample_indices = np.random.choice(
                future_indices,
                size=min(self.k, len(future_indices)),
                replace=False
            )
            
            for idx in sample_indices:
                # New goal = achieved goal at future step
                new_goal = episode[idx]["achieved_goal"]
                
                # Compute new reward
                achieved = trans["achieved_goal"]
                new_reward = 1.0 if np.allclose(achieved, new_goal, atol=0.1) else 0.0
                new_done = new_reward > 0
                
                # Add hindsight transition
                her_trans = {
                    "state": trans["state"],
                    "action": trans["action"],
                    "next_state": trans["next_state"],
                    "goal": new_goal,
                    "achieved_goal": trans["achieved_goal"],
                    "reward": new_reward,
                    "done": new_done
                }
                self.buffer.append(her_trans)
        
        self.current_episode = []
    
    def sample(self, batch_size: int) -> Dict[str, np.ndarray]:
        """Sample a batch of transitions."""
        indices = np.random.choice(len(self.buffer), size=batch_size, replace=True)
        
        batch = {
            "states": [],
            "actions": [],
            "next_states": [],
            "goals": [],
            "rewards": [],
            "dones": []
        }
        
        for idx in indices:
            trans = self.buffer[idx]
            batch["states"].append(trans["state"])
            batch["actions"].append(trans["action"])
            batch["next_states"].append(trans["next_state"])
            batch["goals"].append(trans["goal"])
            batch["rewards"].append(trans["reward"])
            batch["dones"].append(trans["done"])
        
        return {k: np.stack(v) for k, v in batch.items()}


class MAXQDecomposer(nn.Module):
    """
    MAXQ value function decomposition.
    
    Decomposes Q-values hierarchically for better credit assignment.
    """
    
    def __init__(self, d_state: int, d_goal: int, hierarchy_depth: int = 3):
        super().__init__()
        self.hierarchy_depth = hierarchy_depth
        
        # Value functions for each level
        self.level_values = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_state + d_goal, 256),
                nn.SiLU(),
                nn.Linear(256, 1)
            )
            for _ in range(hierarchy_depth)
        ])
        
        # Completion functions (probability of completing subtask)
        self.completion_funcs = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_state + d_goal, 128),
                nn.SiLU(),
                nn.Linear(128, 1),
                nn.Sigmoid()
            )
            for _ in range(hierarchy_depth - 1)
        ])
    
    def decompose(
        self,
        state: torch.Tensor,
        goals: List[torch.Tensor]  # One goal per level
    ) -> Dict[str, torch.Tensor]:
        """Decompose Q-value hierarchically."""
        values = []
        completions = []
        
        for i in range(self.hierarchy_depth):
            combined = torch.cat([state, goals[i]], dim=-1)
            v = self.level_values[i](combined).squeeze(-1)
            values.append(v)
            
            if i < self.hierarchy_depth - 1:
                c = self.completion_funcs[i](combined).squeeze(-1)
                completions.append(c)
        
        # Total value = sum of level values weighted by completion probs
        total_value = values[0]
        for i in range(1, len(values)):
            discount = 1.0
            for j in range(i):
                discount = discount * completions[j]
            total_value = total_value + discount * values[i]
        
        return {
            "level_values": values,
            "completions": completions,
            "total_value": total_value
        }


class AbstractGoalReasoner(nn.Module):
    """
    Reasons about goals at an abstract level.
    
    Can generate, modify, and evaluate goals.
    """
    
    def __init__(self, d_model: int, d_goal: int):
        super().__init__()
        
        # Goal generator
        self.generator = nn.Sequential(
            nn.Linear(d_model, 512),
            nn.SiLU(),
            nn.Linear(512, 512),
            nn.SiLU(),
            nn.Linear(512, d_goal)
        )
        
        # Goal importance estimator
        self.importance = nn.Sequential(
            nn.Linear(d_goal + d_model, 256),
            nn.SiLU(),
            nn.Linear(256, 1),
            nn.Sigmoid()
        )
        
        # Goal achievability estimator
        self.achievability = nn.Sequential(
            nn.Linear(d_goal + d_model, 256),
            nn.SiLU(),
            nn.Linear(256, 1),
            nn.Sigmoid()
        )
        
        # Goal similarity
        self.similarity = nn.Sequential(
            nn.Linear(d_goal * 2, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Goal refinement
        self.refiner = nn.Sequential(
            nn.Linear(d_goal + d_model, 512),
            nn.SiLU(),
            nn.Linear(512, d_goal)
        )
    
    def generate_goals(
        self,
        context: torch.Tensor,
        num_goals: int = 5
    ) -> torch.Tensor:
        """Generate candidate goals from context."""
        # Add noise for diversity
        batch_size = context.shape[0]
        
        goals = []
        for _ in range(num_goals):
            noise = torch.randn_like(context) * 0.1
            goal = self.generator(context + noise)
            goals.append(goal)
        
        return torch.stack(goals, dim=1)  # (batch, num_goals, d_goal)
    
    def evaluate_goal(
        self,
        goal: torch.Tensor,
        context: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """Evaluate a goal's importance and achievability."""
        combined = torch.cat([goal, context], dim=-1)
        
        importance = self.importance(combined).squeeze(-1)
        achievability = self.achievability(combined).squeeze(-1)
        
        # Utility = importance * achievability
        utility = importance * achievability
        
        return {
            "importance": importance,
            "achievability": achievability,
            "utility": utility
        }
    
    def refine_goal(
        self,
        goal: torch.Tensor,
        context: torch.Tensor
    ) -> torch.Tensor:
        """Refine a goal based on context."""
        combined = torch.cat([goal, context], dim=-1)
        refined = self.refiner(combined)
        return refined + goal  # Residual


class AdvancedGoalSystem(nn.Module):
    """
    State-of-the-art goal system with hierarchical RL.
    """
    
    def __init__(self, config: Optional[AdvancedGoalConfig] = None):
        super().__init__()
        self.config = config or AdvancedGoalConfig()
        
        # State encoder
        self.state_encoder = nn.Sequential(
            nn.Linear(self.config.d_model, self.config.d_goal),
            nn.LayerNorm(self.config.d_goal),
            nn.SiLU()
        )
        
        # Option-Critic
        self.option_critic = OptionCritic(
            d_state=self.config.d_goal,
            d_action=self.config.d_goal,
            d_goal=self.config.d_goal,
            num_options=self.config.num_options
        )
        
        # Goal-conditioned policy
        self.gcpolicy = GoalConditionedPolicy(
            d_state=self.config.d_goal,
            d_goal=self.config.d_goal,
            d_action=self.config.d_goal
        )
        
        # MAXQ decomposition
        self.maxq = MAXQDecomposer(
            d_state=self.config.d_goal,
            d_goal=self.config.d_goal,
            hierarchy_depth=self.config.hierarchy_depth
        )
        
        # Abstract goal reasoning
        self.reasoner = AbstractGoalReasoner(
            d_model=self.config.d_model,
            d_goal=self.config.d_goal
        )
        
        # HER buffer
        self.her = HindsightExperienceReplay(k=self.config.her_k)
        
        # Goal storage
        self.goals: Dict[str, HierarchicalGoal] = {}
        self.active_goals: Dict[GoalLevel, List[str]] = {
            level: [] for level in GoalLevel
        }
        self.goal_counter = 0
        
        # Current option state
        self.current_option: Optional[int] = None
        self.option_steps = 0
    
    def forward(
        self,
        hidden: torch.Tensor,
        goal: Optional[torch.Tensor] = None,
        generate_new: bool = False
    ) -> Dict[str, Any]:
        """
        Process goals for current state.
        """
        # Encode state
        state = self.state_encoder(
            hidden.mean(dim=1) if hidden.dim() == 3 else hidden
        )
        
        result = {}
        
        # Generate goals if requested
        if generate_new:
            context = hidden.mean(dim=1) if hidden.dim() == 3 else hidden
            candidates = self.reasoner.generate_goals(context, num_goals=5)
            
            # Evaluate candidates
            evaluations = []
            for i in range(candidates.shape[1]):
                eval_result = self.reasoner.evaluate_goal(candidates[:, i], context)
                evaluations.append(eval_result)
            
            result["candidates"] = candidates
            result["evaluations"] = evaluations
            
            # Select best
            utilities = torch.stack([e["utility"] for e in evaluations], dim=-1)
            best_idx = utilities.argmax(dim=-1)
            goal = candidates[torch.arange(candidates.shape[0]), best_idx]
        
        if goal is not None:
            # Option selection
            option_idx, option_probs = self.option_critic.select_option(state, goal)
            result["option_idx"] = option_idx
            result["option_probs"] = option_probs
            
            # Execute option
            action, terminate = self.option_critic.execute_option(
                option_idx.item() if option_idx.dim() == 0 else option_idx[0].item(),
                state, goal
            )
            result["action"] = action
            result["terminate_option"] = terminate
            
            # Goal-conditioned action
            gc_action, log_prob = self.gcpolicy(state, goal)
            result["gc_action"] = gc_action
            result["gc_log_prob"] = log_prob
            
            # MAXQ decomposition (with goal at each level)
            level_goals = [goal] * self.config.hierarchy_depth
            maxq_result = self.maxq.decompose(state, level_goals)
            result["maxq"] = maxq_result
        
        return result
    
    def add_goal(
        self,
        description: str,
        embedding: torch.Tensor,
        level: GoalLevel = GoalLevel.TACTICAL,
        parent_id: Optional[str] = None
    ) -> str:
        """Add a hierarchical goal."""
        self.goal_counter += 1
        goal_id = f"goal_{self.goal_counter}"
        
        goal = HierarchicalGoal(
            id=goal_id,
            level=level,
            description=description,
            embedding=embedding,
            parent_id=parent_id
        )
        
        self.goals[goal_id] = goal
        self.active_goals[level].append(goal_id)
        
        if parent_id and parent_id in self.goals:
            self.goals[parent_id].children.append(goal_id)
        
        return goal_id
    
    def decompose_goal(
        self,
        goal_id: str,
        context: torch.Tensor
    ) -> List[str]:
        """Decompose goal into sub-goals."""
        if goal_id not in self.goals:
            return []
        
        goal = self.goals[goal_id]
        if goal.level == GoalLevel.OPERATIONAL:
            return []  # Can't decompose lowest level
        
        # Generate sub-goal embeddings
        if goal.embedding is not None:
            refined = self.reasoner.refine_goal(
                goal.embedding.unsqueeze(0),
                context.mean(dim=1) if context.dim() == 3 else context
            )
            
            # Create sub-goals
            child_level = GoalLevel(goal.level.value + 1)
            child_ids = []
            
            for i in range(3):  # Create 3 sub-goals
                noise = torch.randn_like(refined) * 0.1
                child_emb = refined + noise
                
                child_id = self.add_goal(
                    description=f"Sub-goal {i} of {goal.description}",
                    embedding=child_emb.squeeze(0),
                    level=child_level,
                    parent_id=goal_id
                )
                child_ids.append(child_id)
            
            return child_ids
        
        return []
    
    def get_status(self) -> Dict[str, Any]:
        """Get goal system status."""
        return {
            "total_goals": len(self.goals),
            "strategic_goals": len(self.active_goals[GoalLevel.STRATEGIC]),
            "tactical_goals": len(self.active_goals[GoalLevel.TACTICAL]),
            "operational_goals": len(self.active_goals[GoalLevel.OPERATIONAL]),
            "num_options": self.config.num_options,
            "her_buffer_size": len(self.her.buffer),
            "type": "Advanced Hierarchical Goal System"
        }
    
    def save(self, path: Path):
        """Save goal system state."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        torch.save(self.state_dict(), path / "goal_system.pt")
        
        goals_data = {}
        for gid, goal in self.goals.items():
            goals_data[gid] = {
                "level": goal.level.name,
                "description": goal.description,
                "completed": goal.completed,
                "parent_id": goal.parent_id,
                "children": goal.children
            }
        
        with open(path / "goals.json", "w") as f:
            json.dump(goals_data, f, indent=2)


def create_advanced_goal_system(d_model: int = 512) -> AdvancedGoalSystem:
    """Factory function."""
    config = AdvancedGoalConfig(d_model=d_model)
    return AdvancedGoalSystem(config)


if __name__ == "__main__":
    print("Testing Advanced Goal System...")
    
    system = create_advanced_goal_system()
    
    # Test forward with goal generation
    hidden = torch.randn(2, 32, 512)
    
    result = system(hidden, generate_new=True)
    
    print(f"Generated {result['candidates'].shape[1]} candidate goals")
    print(f"Best utility: {result['evaluations'][0]['utility']}")
    
    # Test with explicit goal
    goal = torch.randn(2, 256)
    result2 = system(hidden, goal=goal)
    
    print(f"\nOption selected: {result2['option_idx']}")
    print(f"Action shape: {result2['action'].shape}")
    print(f"MAXQ total value: {result2['maxq']['total_value']}")
    
    # Test goal hierarchy
    goal_id = system.add_goal(
        description="Learn machine learning",
        embedding=goal[0],
        level=GoalLevel.STRATEGIC
    )
    
    sub_goals = system.decompose_goal(goal_id, hidden)
    print(f"\nDecomposed into {len(sub_goals)} sub-goals")
    
    print(f"\nStatus: {system.get_status()}")
    
    print("\n✅ Advanced Goal System test passed!")
