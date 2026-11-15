"""
NANOSILHOUETTE - Advanced Curiosity Module
=============================================
State-of-the-art intrinsic motivation with:
- Random Network Distillation (RND)
- Go-Explore inspired state archiving
- Disagreement-based exploration
- Empowerment maximization
- Information gain estimation

Based on: RND (OpenAI), Go-Explore (Uber), Disagreement, Empowerment
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass
from collections import deque
import numpy as np
import heapq


@dataclass
class AdvancedCuriosityConfig:
    """Configuration for advanced curiosity."""
    d_model: int = 512
    d_curiosity: int = 256
    rnd_hidden: int = 256
    num_ensemble: int = 5  # For disagreement
    archive_size: int = 10000  # For Go-Explore
    novelty_k: int = 10  # k-nearest for novelty
    empowerment_horizon: int = 5


class RandomNetworkDistillation(nn.Module):
    """
    Random Network Distillation (RND).
    
    Uses prediction error of a randomly initialized network
    as intrinsic reward signal.
    """
    
    def __init__(self, d_model: int, d_hidden: int = 256):
        super().__init__()
        
        # Target network (random, frozen)
        self.target = nn.Sequential(
            nn.Linear(d_model, d_hidden),
            nn.ReLU(),
            nn.Linear(d_hidden, d_hidden),
            nn.ReLU(),
            nn.Linear(d_hidden, d_hidden)
        )
        
        # Predictor network (trained to match target)
        self.predictor = nn.Sequential(
            nn.Linear(d_model, d_hidden),
            nn.ReLU(),
            nn.Linear(d_hidden, d_hidden),
            nn.ReLU(),
            nn.Linear(d_hidden, d_hidden)
        )
        
        # Freeze target
        for param in self.target.parameters():
            param.requires_grad = False
        
        # Running statistics for normalization
        self.obs_mean = nn.Parameter(torch.zeros(d_model), requires_grad=False)
        self.obs_std = nn.Parameter(torch.ones(d_model), requires_grad=False)
        self.reward_mean = nn.Parameter(torch.zeros(1), requires_grad=False)
        self.reward_std = nn.Parameter(torch.ones(1), requires_grad=False)
        
        self.update_count = 0
    
    def update_stats(self, obs: torch.Tensor, intrinsic_reward: torch.Tensor):
        """Update running statistics."""
        self.update_count += 1
        alpha = 1.0 / self.update_count
        
        # Update observation stats
        obs_flat = obs.view(-1, obs.shape[-1])
        batch_mean = obs_flat.mean(dim=0)
        batch_std = obs_flat.std(dim=0) + 1e-8
        
        self.obs_mean.data = (1 - alpha) * self.obs_mean + alpha * batch_mean
        self.obs_std.data = (1 - alpha) * self.obs_std + alpha * batch_std
        
        # Update reward stats
        r_mean = intrinsic_reward.mean()
        r_std = intrinsic_reward.std() + 1e-8
        
        self.reward_mean.data = (1 - alpha) * self.reward_mean + alpha * r_mean
        self.reward_std.data = (1 - alpha) * self.reward_std + alpha * r_std
    
    def forward(self, obs: torch.Tensor) -> Dict[str, torch.Tensor]:
        """
        Compute RND intrinsic reward.
        
        High prediction error = novel state = high reward
        """
        if obs.dim() == 3:
            obs = obs.mean(dim=1)
        
        # Normalize observation
        obs_normalized = (obs - self.obs_mean) / (self.obs_std + 1e-8)
        
        # Get target and prediction
        with torch.no_grad():
            target_features = self.target(obs_normalized)
        
        predicted_features = self.predictor(obs_normalized)
        
        # Prediction error = intrinsic reward
        error = (target_features - predicted_features).pow(2).mean(dim=-1)
        
        # Normalize reward
        intrinsic_reward = error / (self.reward_std + 1e-8)
        
        # Update stats
        if self.training:
            self.update_stats(obs, error)
        
        return {
            "intrinsic_reward": intrinsic_reward,
            "prediction_error": error,
            "target_features": target_features,
            "predicted_features": predicted_features
        }
    
    def compute_loss(self, obs: torch.Tensor) -> torch.Tensor:
        """Compute RND training loss."""
        result = self.forward(obs)
        return result["prediction_error"].mean()


class EnsembleDisagreement(nn.Module):
    """
    Disagreement-based exploration using ensemble.
    
    States where the ensemble disagrees are novel/interesting.
    """
    
    def __init__(self, d_model: int, d_hidden: int, num_ensemble: int = 5):
        super().__init__()
        self.num_ensemble = num_ensemble
        
        # Ensemble of networks
        self.ensemble = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_model, d_hidden),
                nn.SiLU(),
                nn.Linear(d_hidden, d_hidden),
                nn.SiLU(),
                nn.Linear(d_hidden, d_model)
            )
            for _ in range(num_ensemble)
        ])
    
    def forward(self, obs: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Compute disagreement-based novelty."""
        if obs.dim() == 3:
            obs = obs.mean(dim=1)
        
        # Get predictions from all ensemble members
        predictions = torch.stack([net(obs) for net in self.ensemble], dim=0)
        
        # Mean and variance across ensemble
        mean_pred = predictions.mean(dim=0)
        variance = predictions.var(dim=0)
        
        # Disagreement = variance = novelty
        disagreement = variance.mean(dim=-1)
        
        return {
            "disagreement": disagreement,
            "mean_prediction": mean_pred,
            "variance": variance,
            "predictions": predictions
        }
    
    def compute_loss(self, obs: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """Train ensemble to predict targets."""
        if obs.dim() == 3:
            obs = obs.mean(dim=1)
        if target.dim() == 3:
            target = target.mean(dim=1)
        
        losses = []
        for net in self.ensemble:
            pred = net(obs)
            loss = F.mse_loss(pred, target)
            losses.append(loss)
        
        return sum(losses) / len(losses)


class StateArchive:
    """
    Go-Explore inspired state archive.
    
    Keeps track of interesting states for exploration.
    """
    
    def __init__(self, archive_size: int = 10000, d_embedding: int = 256):
        self.archive_size = archive_size
        self.d_embedding = d_embedding
        
        # Archive storage
        self.states: List[np.ndarray] = []
        self.scores: List[float] = []  # Novelty/interest scores
        self.visits: List[int] = []
        self.metadata: List[Dict] = []
        
        # For efficient nearest neighbor
        self._embedding_matrix: Optional[np.ndarray] = None
    
    def add(
        self,
        state: torch.Tensor,
        score: float,
        metadata: Optional[Dict] = None
    ) -> int:
        """Add state to archive."""
        state_np = state.detach().cpu().numpy().squeeze()
        
        if len(self.states) >= self.archive_size:
            # Remove lowest scoring state
            min_idx = np.argmin(self.scores)
            self.states.pop(min_idx)
            self.scores.pop(min_idx)
            self.visits.pop(min_idx)
            self.metadata.pop(min_idx)
            self._embedding_matrix = None
        
        self.states.append(state_np)
        self.scores.append(score)
        self.visits.append(0)
        self.metadata.append(metadata or {})
        self._embedding_matrix = None
        
        return len(self.states) - 1
    
    def select_goal(self) -> Tuple[int, np.ndarray]:
        """Select a goal state for exploration (Go-Explore style)."""
        if not self.states:
            return -1, np.zeros(self.d_embedding)
        
        # Score = novelty / sqrt(visits + 1)
        selection_scores = [
            s / np.sqrt(v + 1)
            for s, v in zip(self.scores, self.visits)
        ]
        
        # Softmax selection
        probs = np.exp(selection_scores) / np.sum(np.exp(selection_scores))
        idx = np.random.choice(len(self.states), p=probs)
        
        self.visits[idx] += 1
        
        return idx, self.states[idx]
    
    def compute_novelty(
        self,
        state: torch.Tensor,
        k: int = 10
    ) -> float:
        """Compute novelty relative to archive."""
        if len(self.states) < k:
            return 1.0
        
        state_np = state.detach().cpu().numpy().squeeze()
        
        # Build embedding matrix if needed
        if self._embedding_matrix is None:
            self._embedding_matrix = np.stack(self.states)
        
        # Compute distances
        distances = np.linalg.norm(self._embedding_matrix - state_np, axis=-1)
        
        # k-nearest neighbors novelty
        k_nearest = np.partition(distances, k)[:k]
        novelty = np.mean(k_nearest)
        
        return novelty
    
    def get_stats(self) -> Dict[str, Any]:
        return {
            "archive_size": len(self.states),
            "max_size": self.archive_size,
            "mean_score": np.mean(self.scores) if self.scores else 0,
            "total_visits": sum(self.visits)
        }


class EmpowermentEstimator(nn.Module):
    """
    Estimates empowerment - the channel capacity between
    actions and future states.
    
    High empowerment = more control over future = interesting.
    """
    
    def __init__(self, d_model: int, d_action: int = 64, horizon: int = 5):
        super().__init__()
        self.d_action = d_action
        self.horizon = horizon
        
        # Source distribution (actions)
        self.source_net = nn.Sequential(
            nn.Linear(d_model, 256),
            nn.SiLU(),
            nn.Linear(256, d_action * 2)  # mean and logvar
        )
        
        # Forward dynamics (state + action -> next state)
        self.dynamics = nn.Sequential(
            nn.Linear(d_model + d_action, 512),
            nn.SiLU(),
            nn.Linear(512, d_model)
        )
        
        # Inverse model (states -> action)
        self.inverse = nn.Sequential(
            nn.Linear(d_model * 2, 512),
            nn.SiLU(),
            nn.Linear(512, d_action)
        )
    
    def sample_action(self, state: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Sample action from source distribution."""
        params = self.source_net(state)
        mean, logvar = params.chunk(2, dim=-1)
        
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        action = mean + std * eps
        
        # Log prob for mutual information estimation
        log_prob = -0.5 * (logvar + (action - mean).pow(2) / std.pow(2) + np.log(2 * np.pi))
        log_prob = log_prob.sum(dim=-1)
        
        return action, log_prob
    
    def forward(self, state: torch.Tensor, num_samples: int = 10) -> Dict[str, torch.Tensor]:
        """
        Estimate empowerment via variational lower bound.
        """
        if state.dim() == 3:
            state = state.mean(dim=1)
        
        batch_size = state.shape[0]
        
        all_log_probs = []
        all_inverse_log_probs = []
        
        for _ in range(num_samples):
            # Sample action
            action, log_prob = self.sample_action(state)
            
            # Simulate forward
            combined = torch.cat([state, action], dim=-1)
            next_state = self.dynamics(combined)
            
            # Inverse model: recover action from states
            states_combined = torch.cat([state, next_state], dim=-1)
            recovered_action = self.inverse(states_combined)
            
            # Log prob of recovered action under source
            params = self.source_net(state)
            mean, logvar = params.chunk(2, dim=-1)
            std = torch.exp(0.5 * logvar)
            
            inverse_log_prob = -0.5 * (logvar + (recovered_action - mean).pow(2) / std.pow(2) + np.log(2 * np.pi))
            inverse_log_prob = inverse_log_prob.sum(dim=-1)
            
            all_log_probs.append(log_prob)
            all_inverse_log_probs.append(inverse_log_prob)
        
        # Empowerment ≈ I(A; S') ≈ H(A) - H(A|S')
        # Using variational bound with inverse model
        log_probs = torch.stack(all_log_probs, dim=0)
        inverse_log_probs = torch.stack(all_inverse_log_probs, dim=0)
        
        # Approximate mutual information
        empowerment = (inverse_log_probs - log_probs).mean(dim=0)
        empowerment = F.softplus(empowerment)  # Ensure positive
        
        return {
            "empowerment": empowerment,
            "source_entropy": -log_probs.mean(dim=0),
            "conditional_entropy": -inverse_log_probs.mean(dim=0)
        }


class InformationGainNetwork(nn.Module):
    """
    Estimates expected information gain from actions.
    
    Based on Bayesian approach to active learning.
    """
    
    def __init__(self, d_model: int, d_action: int = 64):
        super().__init__()
        
        # Belief state (what we know)
        self.belief_encoder = nn.Sequential(
            nn.Linear(d_model, 256),
            nn.SiLU(),
            nn.Linear(256, 128)
        )
        
        # Predicted posterior (what we'd know after action)
        self.posterior_predictor = nn.Sequential(
            nn.Linear(128 + d_action, 256),
            nn.SiLU(),
            nn.Linear(256, 128)
        )
        
        # Information gain estimator
        self.ig_estimator = nn.Sequential(
            nn.Linear(256, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Softplus()
        )
    
    def forward(
        self,
        state: torch.Tensor,
        action: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """Estimate information gain from action."""
        if state.dim() == 3:
            state = state.mean(dim=1)
        
        # Current belief
        belief = self.belief_encoder(state)
        
        if action is None:
            # Random action
            action = torch.randn(state.shape[0], 64, device=state.device)
        
        # Predicted posterior after action
        combined = torch.cat([belief, action], dim=-1)
        posterior = self.posterior_predictor(combined)
        
        # Information gain = KL(posterior || prior)
        # Approximate via neural network
        ig_input = torch.cat([belief, posterior], dim=-1)
        info_gain = self.ig_estimator(ig_input).squeeze(-1)
        
        return {
            "information_gain": info_gain,
            "prior_belief": belief,
            "posterior_belief": posterior
        }


class AdvancedCuriosity(nn.Module):
    """
    State-of-the-art curiosity module.
    
    Combines multiple intrinsic motivation signals.
    """
    
    def __init__(self, config: Optional[AdvancedCuriosityConfig] = None):
        super().__init__()
        self.config = config or AdvancedCuriosityConfig()
        
        # Encoder
        self.encoder = nn.Sequential(
            nn.Linear(self.config.d_model, self.config.d_curiosity),
            nn.LayerNorm(self.config.d_curiosity),
            nn.SiLU()
        )
        
        # RND
        self.rnd = RandomNetworkDistillation(
            self.config.d_curiosity,
            self.config.rnd_hidden
        )
        
        # Ensemble disagreement
        self.ensemble = EnsembleDisagreement(
            self.config.d_curiosity,
            self.config.rnd_hidden,
            self.config.num_ensemble
        )
        
        # State archive
        self.archive = StateArchive(
            self.config.archive_size,
            self.config.d_curiosity
        )
        
        # Empowerment
        self.empowerment = EmpowermentEstimator(
            self.config.d_curiosity,
            horizon=self.config.empowerment_horizon
        )
        
        # Information gain
        self.info_gain = InformationGainNetwork(self.config.d_curiosity)
        
        # Combination weights (learnable)
        self.combination_weights = nn.Parameter(torch.ones(5) / 5)
    
    def forward(
        self,
        hidden: torch.Tensor,
        action: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Compute comprehensive curiosity signals.
        """
        # Encode
        encoded = self.encoder(hidden.mean(dim=1) if hidden.dim() == 3 else hidden)
        
        # 1. RND
        rnd_result = self.rnd(encoded)
        
        # 2. Ensemble disagreement
        ensemble_result = self.ensemble(encoded)
        
        # 3. Archive novelty
        archive_novelty = torch.tensor(
            [self.archive.compute_novelty(encoded[i:i+1], self.config.novelty_k)
             for i in range(encoded.shape[0])],
            device=encoded.device
        )
        
        # 4. Empowerment
        empowerment_result = self.empowerment(encoded)
        
        # 5. Information gain
        ig_result = self.info_gain(encoded, action)
        
        # Combine signals
        weights = F.softmax(self.combination_weights, dim=0)
        
        combined_curiosity = (
            weights[0] * rnd_result["intrinsic_reward"] +
            weights[1] * ensemble_result["disagreement"] +
            weights[2] * archive_novelty +
            weights[3] * empowerment_result["empowerment"] +
            weights[4] * ig_result["information_gain"]
        )
        
        return {
            "combined_curiosity": combined_curiosity,
            "rnd": rnd_result,
            "ensemble": ensemble_result,
            "archive_novelty": archive_novelty,
            "empowerment": empowerment_result,
            "information_gain": ig_result,
            "weights": weights,
            "should_explore": combined_curiosity > combined_curiosity.median()
        }
    
    def update_archive(self, hidden: torch.Tensor, score: float):
        """Update state archive with new state."""
        encoded = self.encoder(hidden.mean(dim=1) if hidden.dim() == 3 else hidden)
        for i in range(encoded.shape[0]):
            self.archive.add(encoded[i:i+1], score)
    
    def select_exploration_goal(self) -> Tuple[int, np.ndarray]:
        """Select a goal for directed exploration."""
        return self.archive.select_goal()
    
    def compute_loss(
        self,
        current: torch.Tensor,
        next_state: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """Compute curiosity training losses."""
        current_enc = self.encoder(current.mean(dim=1) if current.dim() == 3 else current)
        next_enc = self.encoder(next_state.mean(dim=1) if next_state.dim() == 3 else next_state)
        
        # RND loss
        rnd_loss = self.rnd.compute_loss(current_enc)
        
        # Ensemble loss
        ensemble_loss = self.ensemble.compute_loss(current_enc, next_enc)
        
        total = rnd_loss + ensemble_loss
        
        return {
            "total": total,
            "rnd": rnd_loss,
            "ensemble": ensemble_loss
        }
    
    def get_stats(self) -> Dict[str, Any]:
        return {
            "archive": self.archive.get_stats(),
            "rnd_updates": self.rnd.update_count,
            "num_ensemble": self.config.num_ensemble,
            "type": "Advanced Curiosity with RND + Go-Explore"
        }


def create_advanced_curiosity(d_model: int = 512) -> AdvancedCuriosity:
    """Factory function."""
    config = AdvancedCuriosityConfig(d_model=d_model)
    return AdvancedCuriosity(config)


if __name__ == "__main__":
    print("Testing Advanced Curiosity...")
    
    module = create_advanced_curiosity()
    
    # Test forward
    hidden = torch.randn(2, 32, 512)
    
    result = module(hidden)
    
    print(f"Combined curiosity: {result['combined_curiosity']}")
    print(f"RND reward: {result['rnd']['intrinsic_reward']}")
    print(f"Disagreement: {result['ensemble']['disagreement']}")
    print(f"Archive novelty: {result['archive_novelty']}")
    print(f"Empowerment: {result['empowerment']['empowerment']}")
    print(f"Info gain: {result['information_gain']['information_gain']}")
    print(f"Should explore: {result['should_explore']}")
    
    # Test archive
    module.update_archive(hidden, 0.8)
    goal_idx, goal = module.select_exploration_goal()
    print(f"\nSelected goal: {goal_idx}, shape: {goal.shape}")
    
    # Test loss
    next_hidden = torch.randn(2, 32, 512)
    loss = module.compute_loss(hidden, next_hidden)
    print(f"\nCuriosity loss: {loss['total'].item():.4f}")
    
    print(f"\nStats: {module.get_stats()}")
    
    print("\n✅ Advanced Curiosity test passed!")
