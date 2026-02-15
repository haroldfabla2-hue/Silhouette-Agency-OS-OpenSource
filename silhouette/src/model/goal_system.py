"""
NANOSILHOUETTE - Goal System
==============================
Implements autonomous goal management:
- Goal generation (what should I do?)
- Goal prioritization (what's most important?)
- Goal decomposition (break into steps)
- Planning and execution

This is the "will" of the model - autonomous agency.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from collections import deque
from enum import Enum
import numpy as np
import json
from pathlib import Path
import time


class GoalStatus(Enum):
    """Status of a goal."""
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    ABANDONED = "abandoned"


@dataclass
class Goal:
    """Represents a goal."""
    id: str
    description: str
    embedding: Optional[torch.Tensor] = None
    priority: float = 0.5
    status: GoalStatus = GoalStatus.PENDING
    parent_id: Optional[str] = None
    sub_goals: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    deadline: Optional[float] = None
    progress: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GoalSystemConfig:
    """Configuration for goal system."""
    d_model: int = 512
    d_goal: int = 128
    max_active_goals: int = 5
    max_sub_goals: int = 10
    planning_horizon: int = 10
    replan_frequency: int = 50


class GoalGenerator(nn.Module):
    """
    Generates goals from context.
    
    Creates high-level objectives based on current state.
    """
    
    def __init__(self, d_model: int, d_goal: int, num_goal_types: int = 8):
        super().__init__()
        self.d_goal = d_goal
        self.num_goal_types = num_goal_types
        
        # Goal type templates
        self.goal_types = [
            "learn_new_information",
            "improve_capability",
            "reduce_uncertainty",
            "complete_task",
            "explore_topic",
            "verify_knowledge",
            "synthesize_information",
            "generate_output"
        ]
        
        # Goal type embeddings
        self.goal_type_embeddings = nn.Embedding(num_goal_types, d_goal)
        
        # Goal generator from context
        self.generator = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_goal * num_goal_types)
        )
        
        # Goal scorer
        self.scorer = nn.Sequential(
            nn.Linear(d_model + d_goal, d_goal),
            nn.SiLU(),
            nn.Linear(d_goal, 1)
        )
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        current_goals: Optional[List[Goal]] = None
    ) -> Dict[str, Any]:
        """
        Generate potential goals for current context.
        """
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        batch_size = pooled.shape[0]
        
        # Generate goal embeddings
        generated = self.generator(pooled)
        generated = generated.view(batch_size, self.num_goal_types, self.d_goal)
        
        # Score each goal type
        scores = []
        for i in range(self.num_goal_types):
            combined = torch.cat([pooled, generated[:, i]], dim=-1)
            score = self.scorer(combined)
            scores.append(score)
        
        scores = torch.cat(scores, dim=-1)
        goal_probs = F.softmax(scores, dim=-1)
        
        # Select best goals
        top_k = min(3, self.num_goal_types)
        top_indices = scores.topk(top_k, dim=-1).indices
        
        top_goals = []
        for b in range(batch_size):
            batch_goals = []
            for idx in top_indices[b]:
                batch_goals.append({
                    "type": self.goal_types[idx.item()],
                    "type_idx": idx.item(),
                    "embedding": generated[b, idx],
                    "score": scores[b, idx].item()
                })
            top_goals.append(batch_goals)
        
        return {
            "goal_probs": goal_probs,
            "top_goals": top_goals,
            "all_embeddings": generated
        }


class GoalPrioritizer(nn.Module):
    """
    Prioritizes goals based on importance and urgency.
    """
    
    def __init__(self, d_goal: int):
        super().__init__()
        
        # Priority scorer
        self.scorer = nn.Sequential(
            nn.Linear(d_goal + 3, d_goal),  # +3 for urgency, importance, progress
            nn.SiLU(),
            nn.Linear(d_goal, 1),
            nn.Sigmoid()
        )
        
        # Urgency estimator
        self.urgency_estimator = nn.Sequential(
            nn.Linear(d_goal, d_goal // 2),
            nn.SiLU(),
            nn.Linear(d_goal // 2, 1),
            nn.Sigmoid()
        )
        
        # Importance estimator
        self.importance_estimator = nn.Sequential(
            nn.Linear(d_goal, d_goal // 2),
            nn.SiLU(),
            nn.Linear(d_goal // 2, 1),
            nn.Sigmoid()
        )
    
    def forward(
        self,
        goal_embeddings: torch.Tensor,
        progress: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Compute priority scores for goals.
        """
        batch_size = goal_embeddings.shape[0]
        
        if goal_embeddings.dim() == 2:
            goal_embeddings = goal_embeddings.unsqueeze(1)
        
        num_goals = goal_embeddings.shape[1]
        
        # Estimate urgency and importance
        urgency = self.urgency_estimator(goal_embeddings).squeeze(-1)
        importance = self.importance_estimator(goal_embeddings).squeeze(-1)
        
        # Progress (if not provided)
        if progress is None:
            progress = torch.zeros(batch_size, num_goals, device=goal_embeddings.device)
        
        # Compute priority
        features = torch.cat([
            goal_embeddings,
            urgency.unsqueeze(-1),
            importance.unsqueeze(-1),
            progress.unsqueeze(-1)
        ], dim=-1)
        
        priority = self.scorer(features).squeeze(-1)
        
        # Rank goals
        ranking = priority.argsort(dim=-1, descending=True)
        
        return {
            "priority": priority,
            "urgency": urgency,
            "importance": importance,
            "ranking": ranking
        }


class GoalDecomposer(nn.Module):
    """
    Decomposes high-level goals into sub-goals.
    """
    
    def __init__(self, d_goal: int, max_sub_goals: int = 10):
        super().__init__()
        self.max_sub_goals = max_sub_goals
        
        # Sub-goal generator
        self.generator = nn.Sequential(
            nn.Linear(d_goal, d_goal * 2),
            nn.SiLU(),
            nn.Linear(d_goal * 2, d_goal * max_sub_goals)
        )
        
        # Validity scorer (is this a valid sub-goal?)
        self.validity_scorer = nn.Sequential(
            nn.Linear(d_goal * 2, d_goal),  # parent + sub
            nn.SiLU(),
            nn.Linear(d_goal, 1),
            nn.Sigmoid()
        )
        
        # Ordering predictor
        self.order_predictor = nn.Sequential(
            nn.Linear(d_goal, 32),
            nn.SiLU(),
            nn.Linear(32, 1)
        )
    
    def forward(
        self,
        parent_goal: torch.Tensor
    ) -> Dict[str, Any]:
        """
        Decompose parent goal into sub-goals.
        """
        if parent_goal.dim() == 1:
            parent_goal = parent_goal.unsqueeze(0)
        
        batch_size = parent_goal.shape[0]
        d_goal = parent_goal.shape[-1]
        
        # Generate sub-goals
        sub_goals = self.generator(parent_goal)
        sub_goals = sub_goals.view(batch_size, self.max_sub_goals, d_goal)
        
        # Score validity
        parent_expanded = parent_goal.unsqueeze(1).expand(-1, self.max_sub_goals, -1)
        combined = torch.cat([parent_expanded, sub_goals], dim=-1)
        validity = self.validity_scorer(combined).squeeze(-1)
        
        # Get ordering
        order_scores = self.order_predictor(sub_goals).squeeze(-1)
        ordering = order_scores.argsort(dim=-1)
        
        # Filter valid sub-goals
        valid_mask = validity > 0.5
        
        return {
            "sub_goals": sub_goals,
            "validity": validity,
            "ordering": ordering,
            "valid_mask": valid_mask,
            "num_valid": valid_mask.sum(dim=-1)
        }


class Planner(nn.Module):
    """
    Creates execution plans for goals.
    """
    
    def __init__(self, d_model: int, d_goal: int, planning_horizon: int = 10):
        super().__init__()
        self.planning_horizon = planning_horizon
        
        # State encoder
        self.state_encoder = nn.Linear(d_model, d_goal)
        
        # Action predictor
        self.action_predictor = nn.GRU(
            input_size=d_goal,
            hidden_size=d_goal,
            num_layers=2,
            batch_first=True
        )
        
        # Action decoder
        self.action_decoder = nn.Sequential(
            nn.Linear(d_goal, d_goal * 2),
            nn.SiLU(),
            nn.Linear(d_goal * 2, d_goal)
        )
        
        # Success probability predictor
        self.success_predictor = nn.Sequential(
            nn.Linear(d_goal * 2, d_goal),
            nn.SiLU(),
            nn.Linear(d_goal, 1),
            nn.Sigmoid()
        )
    
    def forward(
        self,
        current_state: torch.Tensor,
        goal: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Generate plan to achieve goal from current state.
        """
        if current_state.dim() == 3:
            current_state = current_state.mean(dim=1)
        
        batch_size = current_state.shape[0]
        
        # Encode state
        state = self.state_encoder(current_state)
        
        # Difference from goal
        goal_direction = goal - state
        
        # Generate action sequence
        # Use goal direction as input, state as initial hidden
        input_seq = goal_direction.unsqueeze(1).expand(-1, self.planning_horizon, -1)
        hidden = state.unsqueeze(0).expand(2, -1, -1).contiguous()
        
        actions, _ = self.action_predictor(input_seq, hidden)
        
        # Decode actions
        plan = self.action_decoder(actions)
        
        # Predict success probability
        final_state = plan[:, -1]
        combined = torch.cat([final_state, goal], dim=-1)
        success_prob = self.success_predictor(combined).squeeze(-1)
        
        return {
            "plan": plan,  # (batch, horizon, d_goal)
            "success_probability": success_prob,
            "estimated_steps": self.planning_horizon,
            "goal_direction": goal_direction
        }


class GoalSystem(nn.Module):
    """
    Complete Goal System for autonomous agency.
    
    Manages goal lifecycle from generation to completion.
    """
    
    def __init__(self, config: Optional[GoalSystemConfig] = None):
        super().__init__()
        self.config = config or GoalSystemConfig()
        
        # Components
        self.generator = GoalGenerator(
            self.config.d_model,
            self.config.d_goal
        )
        self.prioritizer = GoalPrioritizer(self.config.d_goal)
        self.decomposer = GoalDecomposer(
            self.config.d_goal,
            self.config.max_sub_goals
        )
        self.planner = Planner(
            self.config.d_model,
            self.config.d_goal,
            self.config.planning_horizon
        )
        
        # Goal storage
        self.goals: Dict[str, Goal] = {}
        self.active_goals: List[str] = []
        self.goal_counter = 0
        
        # Execution state
        self.current_plan: Optional[Dict] = None
        self.plan_step = 0
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        generate_new: bool = True
    ) -> Dict[str, Any]:
        """
        Process goals for current context.
        """
        result = {}
        
        # Generate new goals if requested
        if generate_new:
            generated = self.generator(hidden_states)
            result["generated_goals"] = generated
        
        # Get embeddings of active goals
        if self.active_goals:
            active_embeddings = torch.stack([
                self.goals[gid].embedding for gid in self.active_goals
                if self.goals[gid].embedding is not None
            ])
            
            if active_embeddings.shape[0] > 0:
                # Prioritize
                priorities = self.prioritizer(active_embeddings)
                result["priorities"] = priorities
        
        # Current plan status
        if self.current_plan is not None:
            result["current_plan"] = {
                "step": self.plan_step,
                "total_steps": self.config.planning_horizon,
                "success_prob": self.current_plan.get("success_probability")
            }
        
        return result
    
    def add_goal(
        self,
        description: str,
        embedding: Optional[torch.Tensor] = None,
        priority: float = 0.5,
        parent_id: Optional[str] = None
    ) -> str:
        """Add a new goal."""
        self.goal_counter += 1
        goal_id = f"goal_{self.goal_counter}"
        
        goal = Goal(
            id=goal_id,
            description=description,
            embedding=embedding,
            priority=priority,
            parent_id=parent_id
        )
        
        self.goals[goal_id] = goal
        
        # Add to parent's sub-goals
        if parent_id and parent_id in self.goals:
            self.goals[parent_id].sub_goals.append(goal_id)
        
        return goal_id
    
    def activate_goal(self, goal_id: str) -> bool:
        """Activate a goal for execution."""
        if goal_id not in self.goals:
            return False
        
        if len(self.active_goals) >= self.config.max_active_goals:
            # Remove lowest priority
            if self.active_goals:
                self.active_goals.pop()
        
        self.goals[goal_id].status = GoalStatus.ACTIVE
        self.active_goals.insert(0, goal_id)
        
        return True
    
    def complete_goal(self, goal_id: str, success: bool = True):
        """Mark a goal as completed."""
        if goal_id not in self.goals:
            return
        
        goal = self.goals[goal_id]
        goal.status = GoalStatus.COMPLETED if success else GoalStatus.FAILED
        goal.progress = 1.0 if success else goal.progress
        
        if goal_id in self.active_goals:
            self.active_goals.remove(goal_id)
    
    def decompose_goal(
        self,
        goal_id: str,
        hidden_states: Optional[torch.Tensor] = None
    ) -> List[str]:
        """Decompose goal into sub-goals."""
        if goal_id not in self.goals:
            return []
        
        goal = self.goals[goal_id]
        
        if goal.embedding is None:
            return []
        
        # Generate sub-goals
        decomposition = self.decomposer(goal.embedding)
        
        sub_goal_ids = []
        for i in range(decomposition["num_valid"][0].item()):
            sub_emb = decomposition["sub_goals"][0, i]
            sub_id = self.add_goal(
                description=f"Sub-goal {i} of {goal.description}",
                embedding=sub_emb,
                parent_id=goal_id
            )
            sub_goal_ids.append(sub_id)
        
        return sub_goal_ids
    
    def create_plan(
        self,
        goal_id: str,
        current_state: torch.Tensor
    ) -> Optional[Dict]:
        """Create execution plan for a goal."""
        if goal_id not in self.goals:
            return None
        
        goal = self.goals[goal_id]
        
        if goal.embedding is None:
            return None
        
        # Generate plan
        plan = self.planner(current_state, goal.embedding)
        
        self.current_plan = {
            "goal_id": goal_id,
            **{k: v for k, v in plan.items()}
        }
        self.plan_step = 0
        
        return self.current_plan
    
    def step_plan(self) -> Optional[torch.Tensor]:
        """Get next action from current plan."""
        if self.current_plan is None:
            return None
        
        if self.plan_step >= self.config.planning_horizon:
            return None
        
        action = self.current_plan["plan"][:, self.plan_step]
        self.plan_step += 1
        
        return action
    
    def get_status(self) -> Dict[str, Any]:
        """Get goal system status."""
        return {
            "total_goals": len(self.goals),
            "active_goals": len(self.active_goals),
            "completed_goals": sum(1 for g in self.goals.values() 
                                   if g.status == GoalStatus.COMPLETED),
            "pending_goals": sum(1 for g in self.goals.values() 
                                 if g.status == GoalStatus.PENDING),
            "current_plan": self.current_plan is not None,
            "plan_progress": f"{self.plan_step}/{self.config.planning_horizon}"
            if self.current_plan else None
        }
    
    def save_goals(self, path: Path):
        """Save goals to disk."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        goals_data = {}
        for gid, goal in self.goals.items():
            goals_data[gid] = {
                "description": goal.description,
                "priority": goal.priority,
                "status": goal.status.value,
                "progress": goal.progress,
                "parent_id": goal.parent_id,
                "sub_goals": goal.sub_goals,
                "created_at": goal.created_at
            }
        
        with open(path / "goals.json", "w") as f:
            json.dump(goals_data, f, indent=2)


def create_goal_system(d_model: int = 512) -> GoalSystem:
    """Factory function for goal system."""
    config = GoalSystemConfig(d_model=d_model)
    return GoalSystem(config)


if __name__ == "__main__":
    print("Testing Goal System...")
    
    system = create_goal_system(d_model=512)
    
    # Test goal generation
    hidden = torch.randn(2, 32, 512)
    result = system(hidden)
    
    print(f"Generated goals: {len(result['generated_goals']['top_goals'][0])}")
    for goal in result['generated_goals']['top_goals'][0]:
        print(f"  - {goal['type']}: {goal['score']:.3f}")
    
    # Add goals manually
    goal_id = system.add_goal(
        description="Learn about neural networks",
        embedding=torch.randn(128),
        priority=0.8
    )
    print(f"\nAdded goal: {goal_id}")
    
    # Activate goal
    system.activate_goal(goal_id)
    
    # Decompose goal
    sub_goals = system.decompose_goal(goal_id)
    print(f"Created {len(sub_goals)} sub-goals")
    
    # Create plan
    plan = system.create_plan(goal_id, hidden)
    print(f"Plan success probability: {plan['success_probability'][0].item():.3f}")
    
    # Execute plan steps
    for i in range(3):
        action = system.step_plan()
        if action is not None:
            print(f"Step {i}: action shape {action.shape}")
    
    # Get status
    status = system.get_status()
    print(f"\nStatus: {status}")
    
    print("\n✅ Goal System test passed!")
