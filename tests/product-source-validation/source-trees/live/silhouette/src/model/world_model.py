"""
NANOSILHOUETTE - World Model
==============================
Implements internal world representation:
- State prediction (what happens next)
- Action-consequence modeling
- Mental simulation
- Environment understanding

This is a key component for AGI - understanding cause and effect.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from collections import deque
import numpy as np


@dataclass
class WorldModelConfig:
    """Configuration for world model."""
    d_model: int = 512
    d_state: int = 256  # World state dimension
    d_action: int = 64  # Action embedding dimension
    num_layers: int = 4
    prediction_horizon: int = 10  # How far to predict
    num_simulations: int = 5  # Monte Carlo rollouts


class StateEncoder(nn.Module):
    """Encodes observations into world state."""
    
    def __init__(self, d_model: int, d_state: int):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_state),
            nn.LayerNorm(d_state)
        )
    
    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        """Encode observations to state."""
        # Pool over sequence
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        return self.encoder(pooled)


class TransitionModel(nn.Module):
    """
    Predicts next state given current state and action.
    
    Core of world model - learns dynamics of the environment.
    """
    
    def __init__(
        self,
        d_state: int,
        d_action: int,
        num_layers: int = 4
    ):
        super().__init__()
        self.d_state = d_state
        self.d_action = d_action
        
        # State-action fusion
        self.fusion = nn.Linear(d_state + d_action, d_state)
        
        # Transition layers
        self.layers = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_state, d_state * 2),
                nn.SiLU(),
                nn.Linear(d_state * 2, d_state),
                nn.LayerNorm(d_state)
            )
            for _ in range(num_layers)
        ])
        
        # Probabilistic output (mean and variance)
        self.mean_head = nn.Linear(d_state, d_state)
        self.logvar_head = nn.Linear(d_state, d_state)
    
    def forward(
        self,
        state: torch.Tensor,
        action: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Predict next state distribution.
        
        Returns:
            mean: Predicted next state mean
            logvar: Log variance (uncertainty)
        """
        # Fuse state and action
        combined = torch.cat([state, action], dim=-1)
        h = self.fusion(combined)
        
        # Apply transition layers
        for layer in self.layers:
            h = h + layer(h)  # Residual
        
        # Output distribution
        mean = self.mean_head(h)
        logvar = self.logvar_head(h).clamp(-10, 2)  # Bounded variance
        
        return mean, logvar
    
    def sample(
        self,
        state: torch.Tensor,
        action: torch.Tensor,
        num_samples: int = 1
    ) -> torch.Tensor:
        """Sample from predicted distribution."""
        mean, logvar = self.forward(state, action)
        
        if num_samples == 1:
            std = torch.exp(0.5 * logvar)
            eps = torch.randn_like(std)
            return mean + eps * std
        else:
            std = torch.exp(0.5 * logvar)
            samples = []
            for _ in range(num_samples):
                eps = torch.randn_like(std)
                samples.append(mean + eps * std)
            return torch.stack(samples, dim=0)


class RewardPredictor(nn.Module):
    """Predicts reward/value of a state."""
    
    def __init__(self, d_state: int):
        super().__init__()
        self.predictor = nn.Sequential(
            nn.Linear(d_state, d_state),
            nn.SiLU(),
            nn.Linear(d_state, 1)
        )
    
    def forward(self, state: torch.Tensor) -> torch.Tensor:
        return self.predictor(state).squeeze(-1)


class ActionEncoder(nn.Module):
    """Encodes actions/decisions into embeddings."""
    
    def __init__(self, vocab_size: int, d_action: int):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, d_action)
        self.projection = nn.Linear(d_action, d_action)
    
    def forward(self, actions: torch.Tensor) -> torch.Tensor:
        """Encode discrete actions."""
        embedded = self.embedding(actions)
        if embedded.dim() == 3:
            embedded = embedded.mean(dim=1)  # Pool
        return self.projection(embedded)
    
    def from_hidden(self, hidden: torch.Tensor) -> torch.Tensor:
        """Derive action embedding from hidden states."""
        return self.projection(hidden.mean(dim=1) if hidden.dim() == 3 else hidden)


class WorldModel(nn.Module):
    """
    Complete World Model for understanding environment dynamics.
    
    Enables the model to:
    - Predict what happens next
    - Simulate consequences of actions
    - Plan by mental simulation
    """
    
    def __init__(self, config: Optional[WorldModelConfig] = None):
        super().__init__()
        self.config = config or WorldModelConfig()
        
        # Core components
        self.state_encoder = StateEncoder(
            self.config.d_model,
            self.config.d_state
        )
        self.transition = TransitionModel(
            self.config.d_state,
            self.config.d_action,
            self.config.num_layers
        )
        self.reward_predictor = RewardPredictor(self.config.d_state)
        self.action_encoder = ActionEncoder(
            vocab_size=32000,  # Typical vocab
            d_action=self.config.d_action
        )
        
        # State decoder (for reconstruction loss)
        self.state_decoder = nn.Linear(self.config.d_state, self.config.d_model)
        
        # Experience buffer for learning dynamics
        self.experience_buffer: deque = deque(maxlen=10000)
    
    def encode_state(self, hidden_states: torch.Tensor) -> torch.Tensor:
        """Encode observations to world state."""
        return self.state_encoder(hidden_states)
    
    def predict_next(
        self,
        current_state: torch.Tensor,
        action_embedding: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Predict next state and reward.
        
        Returns dict with:
            - next_state_mean: Expected next state
            - next_state_var: Uncertainty
            - reward: Predicted reward
        """
        mean, logvar = self.transition(current_state, action_embedding)
        reward = self.reward_predictor(mean)
        
        return {
            "next_state_mean": mean,
            "next_state_logvar": logvar,
            "next_state_var": torch.exp(logvar),
            "reward": reward,
            "uncertainty": logvar.exp().mean(dim=-1)
        }
    
    def simulate_trajectory(
        self,
        initial_state: torch.Tensor,
        action_sequence: List[torch.Tensor],
        num_simulations: int = 1
    ) -> Dict[str, torch.Tensor]:
        """
        Simulate future trajectory from initial state.
        
        This is "mental simulation" - imagining what will happen.
        """
        batch_size = initial_state.shape[0]
        horizon = len(action_sequence)
        
        all_states = []
        all_rewards = []
        all_uncertainties = []
        
        current_state = initial_state
        
        for action in action_sequence:
            action_emb = self.action_encoder.from_hidden(
                action.unsqueeze(-1).expand(-1, self.config.d_action)
                if action.dim() == 1 else action
            ) if action.dim() <= 2 else self.action_encoder.from_hidden(action)
            
            # Sample multiple possible futures
            next_states = self.transition.sample(
                current_state, action_emb, num_simulations
            )
            
            if num_simulations > 1:
                # Average over simulations
                current_state = next_states.mean(dim=0)
                uncertainty = next_states.var(dim=0).mean(dim=-1)
            else:
                current_state = next_states
                uncertainty = torch.zeros(batch_size, device=initial_state.device)
            
            reward = self.reward_predictor(current_state)
            
            all_states.append(current_state)
            all_rewards.append(reward)
            all_uncertainties.append(uncertainty)
        
        return {
            "states": torch.stack(all_states, dim=1),  # (batch, horizon, d_state)
            "rewards": torch.stack(all_rewards, dim=1),  # (batch, horizon)
            "uncertainties": torch.stack(all_uncertainties, dim=1),
            "total_reward": sum(all_rewards),
            "total_uncertainty": sum(all_uncertainties)
        }
    
    def compute_loss(
        self,
        current_hidden: torch.Tensor,
        next_hidden: torch.Tensor,
        actions: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Compute world model training loss.
        
        Learns to predict next state from current state + action.
        """
        # Encode states
        current_state = self.encode_state(current_hidden)
        next_state_target = self.encode_state(next_hidden)
        
        # Get action embedding
        if actions is not None:
            action_emb = self.action_encoder(actions)
        else:
            # Use difference as implicit action
            action_emb = F.normalize(next_state_target - current_state, dim=-1)
            action_emb = action_emb[:, :self.config.d_action]
            if action_emb.shape[-1] < self.config.d_action:
                action_emb = F.pad(action_emb, (0, self.config.d_action - action_emb.shape[-1]))
        
        # Predict next state
        pred_mean, pred_logvar = self.transition(current_state, action_emb)
        
        # Gaussian negative log-likelihood
        pred_var = torch.exp(pred_logvar)
        nll = 0.5 * (
            pred_logvar + 
            (next_state_target - pred_mean) ** 2 / pred_var
        ).mean()
        
        # Reconstruction loss (optional)
        reconstructed = self.state_decoder(current_state)
        if current_hidden.dim() == 3:
            target = current_hidden.mean(dim=1)
        else:
            target = current_hidden
        recon_loss = F.mse_loss(reconstructed, target)
        
        # Reward prediction loss (self-supervised from loss gradient)
        # Could be connected to actual training loss
        
        total_loss = nll + 0.1 * recon_loss
        
        return {
            "total": total_loss,
            "nll": nll,
            "recon": recon_loss,
            "uncertainty_mean": pred_logvar.exp().mean()
        }
    
    def store_experience(
        self,
        current_hidden: torch.Tensor,
        next_hidden: torch.Tensor,
        action: Optional[torch.Tensor] = None,
        reward: float = 0.0
    ):
        """Store experience for world model learning."""
        self.experience_buffer.append({
            "current": current_hidden.detach().cpu(),
            "next": next_hidden.detach().cpu(),
            "action": action.detach().cpu() if action is not None else None,
            "reward": reward
        })
    
    def get_world_understanding(self) -> Dict[str, Any]:
        """Get metrics about world model understanding."""
        return {
            "experiences_stored": len(self.experience_buffer),
            "state_dim": self.config.d_state,
            "prediction_horizon": self.config.prediction_horizon
        }


def create_world_model(d_model: int = 512) -> WorldModel:
    """Factory function for world model."""
    config = WorldModelConfig(d_model=d_model)
    return WorldModel(config)


if __name__ == "__main__":
    print("Testing World Model...")
    
    model = create_world_model(d_model=512)
    
    # Test state encoding
    hidden = torch.randn(2, 32, 512)
    state = model.encode_state(hidden)
    print(f"State shape: {state.shape}")
    
    # Test prediction
    action = torch.randn(2, 64)
    prediction = model.predict_next(state, action)
    print(f"Prediction keys: {prediction.keys()}")
    
    # Test simulation
    actions = [torch.randn(2, 64) for _ in range(5)]
    trajectory = model.simulate_trajectory(state, actions, num_simulations=3)
    print(f"Trajectory states: {trajectory['states'].shape}")
    
    # Test loss
    next_hidden = torch.randn(2, 32, 512)
    loss = model.compute_loss(hidden, next_hidden)
    print(f"Loss: {loss['total'].item():.4f}")
    
    print("✅ World Model test passed!")
