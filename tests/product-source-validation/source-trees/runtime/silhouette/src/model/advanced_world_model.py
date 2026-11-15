"""
NANOSILHOUETTE - Advanced World Model (Dreamer-v3 Style)
==========================================================
State-of-the-art world model with:
- Latent dynamics model (predicts in latent space)
- Stochastic and deterministic pathways
- Imagination training (learning from simulated rollouts)
- Contrastive representation learning
- Value prediction for planning

Based on: DreamerV3, IRIS, World Models (Ha & Schmidhuber)
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass
import numpy as np


@dataclass
class DreamerConfig:
    """Configuration for Dreamer-style world model."""
    d_model: int = 512
    d_latent: int = 256  # Latent state dimension
    d_discrete: int = 32  # Discrete latent categories
    num_categories: int = 32  # Categories per discrete variable
    d_hidden: int = 512
    num_layers: int = 3
    imagination_horizon: int = 15
    kl_balance: float = 0.8  # Balance between KL terms
    free_nats: float = 1.0  # Free bits for KL


class RSSM(nn.Module):
    """
    Recurrent State Space Model (RSSM).
    
    Core of the world model - models transitions in a compact latent space
    with both stochastic and deterministic components.
    """
    
    def __init__(
        self,
        d_model: int,
        d_latent: int,
        d_discrete: int,
        num_categories: int,
        d_hidden: int
    ):
        super().__init__()
        self.d_latent = d_latent
        self.d_discrete = d_discrete
        self.num_categories = num_categories
        self.stoch_size = d_discrete * num_categories
        
        # Deterministic recurrent model
        self.gru = nn.GRUCell(self.stoch_size + d_model, d_hidden)
        
        # Prior (predict stochastic from deterministic)
        self.prior_net = nn.Sequential(
            nn.Linear(d_hidden, d_hidden),
            nn.SiLU(),
            nn.Linear(d_hidden, d_discrete * num_categories)
        )
        
        # Posterior (predict stochastic from deterministic + observation)
        self.posterior_net = nn.Sequential(
            nn.Linear(d_hidden + d_model, d_hidden),
            nn.SiLU(),
            nn.Linear(d_hidden, d_discrete * num_categories)
        )
        
        # Initial state
        self.initial_h = nn.Parameter(torch.zeros(d_hidden))
        self.initial_stoch = nn.Parameter(torch.zeros(self.stoch_size))
    
    def get_initial_state(self, batch_size: int, device: torch.device) -> Dict[str, torch.Tensor]:
        """Get initial RSSM state."""
        return {
            "deter": self.initial_h.unsqueeze(0).expand(batch_size, -1),
            "stoch": self.initial_stoch.unsqueeze(0).expand(batch_size, -1)
        }
    
    def get_stoch(self, logits: torch.Tensor, sample: bool = True) -> torch.Tensor:
        """Convert logits to stochastic state (discrete)."""
        batch_size = logits.shape[0]
        logits = logits.view(batch_size, self.d_discrete, self.num_categories)
        
        if sample:
            # Gumbel-softmax for differentiable sampling
            dist = torch.distributions.OneHotCategorical(logits=logits)
            stoch = dist.sample() + dist.probs - dist.probs.detach()  # Straight-through
        else:
            stoch = F.one_hot(logits.argmax(dim=-1), self.num_categories).float()
        
        return stoch.view(batch_size, -1)
    
    def imagine_step(
        self,
        prev_state: Dict[str, torch.Tensor],
        action: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Imagine one step forward (prior only, no observation).
        """
        # Combine previous stochastic state with action
        x = torch.cat([prev_state["stoch"], action], dim=-1)
        
        # Update deterministic state
        deter = self.gru(x, prev_state["deter"])
        
        # Get prior distribution
        prior_logits = self.prior_net(deter)
        stoch = self.get_stoch(prior_logits, sample=True)
        
        return {
            "deter": deter,
            "stoch": stoch,
            "prior_logits": prior_logits
        }
    
    def observe_step(
        self,
        prev_state: Dict[str, torch.Tensor],
        action: torch.Tensor,
        observation: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Observe one step (use observation to get posterior).
        """
        # Combine previous stochastic state with action
        x = torch.cat([prev_state["stoch"], action], dim=-1)
        
        # Update deterministic state
        deter = self.gru(x, prev_state["deter"])
        
        # Get prior distribution (needed for KL)
        prior_logits = self.prior_net(deter)
        
        # Get posterior distribution (using observation)
        posterior_input = torch.cat([deter, observation], dim=-1)
        posterior_logits = self.posterior_net(posterior_input)
        stoch = self.get_stoch(posterior_logits, sample=True)
        
        return {
            "deter": deter,
            "stoch": stoch,
            "prior_logits": prior_logits,
            "posterior_logits": posterior_logits
        }
    
    def get_features(self, state: Dict[str, torch.Tensor]) -> torch.Tensor:
        """Combine deterministic and stochastic for downstream use."""
        return torch.cat([state["deter"], state["stoch"]], dim=-1)


class ObservationEncoder(nn.Module):
    """Encodes observations to latent space."""
    
    def __init__(self, d_model: int, d_latent: int):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.LayerNorm(d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_latent),
            nn.LayerNorm(d_latent)
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 3:
            x = x.mean(dim=1)
        return self.encoder(x)


class ObservationDecoder(nn.Module):
    """Decodes latent state to observation reconstruction."""
    
    def __init__(self, d_latent: int, d_model: int):
        super().__init__()
        self.decoder = nn.Sequential(
            nn.Linear(d_latent, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_model),
            nn.LayerNorm(d_model)
        )
    
    def forward(self, latent: torch.Tensor) -> torch.Tensor:
        return self.decoder(latent)


class RewardPredictor(nn.Module):
    """Predicts reward from latent state."""
    
    def __init__(self, d_latent: int):
        super().__init__()
        self.predictor = nn.Sequential(
            nn.Linear(d_latent, 256),
            nn.SiLU(),
            nn.Linear(256, 256),
            nn.SiLU(),
            nn.Linear(256, 1)
        )
    
    def forward(self, latent: torch.Tensor) -> torch.Tensor:
        return self.predictor(latent)


class ContinuePredictor(nn.Module):
    """Predicts continuation (not done) probability."""
    
    def __init__(self, d_latent: int):
        super().__init__()
        self.predictor = nn.Sequential(
            nn.Linear(d_latent, 128),
            nn.SiLU(),
            nn.Linear(128, 1)
        )
    
    def forward(self, latent: torch.Tensor) -> torch.Tensor:
        return self.predictor(latent)


class ValueNetwork(nn.Module):
    """
    Value function for planning.
    Uses symlog for numerical stability.
    """
    
    def __init__(self, d_latent: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(d_latent, 512),
            nn.SiLU(),
            nn.Linear(512, 512),
            nn.SiLU(),
            nn.Linear(512, 1)
        )
    
    def forward(self, latent: torch.Tensor) -> torch.Tensor:
        return self.net(latent)
    
    @staticmethod
    def symlog(x: torch.Tensor) -> torch.Tensor:
        return torch.sign(x) * torch.log1p(torch.abs(x))
    
    @staticmethod
    def symexp(x: torch.Tensor) -> torch.Tensor:
        return torch.sign(x) * (torch.exp(torch.abs(x)) - 1)


class ActionEncoder(nn.Module):
    """Encodes actions for the world model."""
    
    def __init__(self, d_model: int):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU()
        )
    
    def forward(self, action: torch.Tensor) -> torch.Tensor:
        if action.dim() == 3:
            action = action.mean(dim=1)
        return self.encoder(action)


class ContrastiveHead(nn.Module):
    """
    Contrastive learning for better representations.
    Implements InfoNCE-style contrastive loss.
    """
    
    def __init__(self, d_latent: int, d_proj: int = 128):
        super().__init__()
        self.projector = nn.Sequential(
            nn.Linear(d_latent, d_latent),
            nn.SiLU(),
            nn.Linear(d_latent, d_proj)
        )
        self.temperature = nn.Parameter(torch.tensor(0.07))
    
    def forward(
        self,
        anchor: torch.Tensor,
        positive: torch.Tensor,
        negatives: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Compute contrastive loss."""
        anchor_proj = F.normalize(self.projector(anchor), dim=-1)
        positive_proj = F.normalize(self.projector(positive), dim=-1)
        
        # Positive similarity
        pos_sim = (anchor_proj * positive_proj).sum(dim=-1) / self.temperature.exp()
        
        if negatives is not None:
            neg_proj = F.normalize(self.projector(negatives), dim=-1)
            neg_sim = torch.matmul(anchor_proj, neg_proj.t()) / self.temperature.exp()
            logits = torch.cat([pos_sim.unsqueeze(-1), neg_sim], dim=-1)
        else:
            # Use other batch elements as negatives
            all_proj = positive_proj
            similarity = torch.matmul(anchor_proj, all_proj.t()) / self.temperature.exp()
            labels = torch.arange(anchor.shape[0], device=anchor.device)
            return F.cross_entropy(similarity, labels)
        
        labels = torch.zeros(anchor.shape[0], dtype=torch.long, device=anchor.device)
        return F.cross_entropy(logits, labels)


class AdvancedWorldModel(nn.Module):
    """
    Dreamer-v3 style world model.
    
    State-of-the-art world modeling with:
    - RSSM for latent dynamics
    - Discrete latent variables
    - Imagination-based training
    - Contrastive representation learning
    """
    
    def __init__(self, config: Optional[DreamerConfig] = None):
        super().__init__()
        self.config = config or DreamerConfig()
        
        # Feature dimensions
        feature_dim = self.config.d_hidden + self.config.d_discrete * self.config.num_categories
        
        # Core components
        self.encoder = ObservationEncoder(self.config.d_model, self.config.d_model)
        self.action_encoder = ActionEncoder(self.config.d_model)
        
        self.rssm = RSSM(
            d_model=self.config.d_model,
            d_latent=self.config.d_latent,
            d_discrete=self.config.d_discrete,
            num_categories=self.config.num_categories,
            d_hidden=self.config.d_hidden
        )
        
        self.decoder = ObservationDecoder(feature_dim, self.config.d_model)
        self.reward_predictor = RewardPredictor(feature_dim)
        self.continue_predictor = ContinuePredictor(feature_dim)
        self.value_net = ValueNetwork(feature_dim)
        
        # Contrastive learning
        self.contrastive = ContrastiveHead(feature_dim)
    
    def observe(
        self,
        observations: torch.Tensor,  # (batch, seq, d_model)
        actions: torch.Tensor  # (batch, seq, d_model)
    ) -> Dict[str, Any]:
        """
        Process a sequence of observations and actions.
        """
        batch_size, seq_len, _ = observations.shape
        device = observations.device
        
        # Encode observations
        encoded_obs = self.encoder(observations.view(-1, self.config.d_model))
        encoded_obs = encoded_obs.view(batch_size, seq_len, -1)
        
        # Encode actions
        encoded_actions = self.action_encoder(actions.view(-1, actions.shape[-1]))
        encoded_actions = encoded_actions.view(batch_size, seq_len, -1)
        
        # Initialize state
        state = self.rssm.get_initial_state(batch_size, device)
        
        # Process sequence
        states = []
        prior_logits = []
        posterior_logits = []
        
        for t in range(seq_len):
            state = self.rssm.observe_step(
                state,
                encoded_actions[:, t] if t > 0 else torch.zeros_like(encoded_actions[:, 0]),
                encoded_obs[:, t]
            )
            states.append(state)
            prior_logits.append(state["prior_logits"])
            posterior_logits.append(state["posterior_logits"])
        
        # Stack results
        features = torch.stack([self.rssm.get_features(s) for s in states], dim=1)
        prior_logits = torch.stack(prior_logits, dim=1)
        posterior_logits = torch.stack(posterior_logits, dim=1)
        
        return {
            "features": features,
            "states": states,
            "prior_logits": prior_logits,
            "posterior_logits": posterior_logits
        }
    
    def imagine(
        self,
        initial_state: Dict[str, torch.Tensor],
        horizon: int,
        policy: Optional[nn.Module] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Imagine future trajectories from given state.
        """
        batch_size = initial_state["deter"].shape[0]
        device = initial_state["deter"].device
        
        states = [initial_state]
        features = [self.rssm.get_features(initial_state)]
        
        for t in range(horizon):
            # Get action (from policy or random)
            if policy is not None:
                action = policy(features[-1])
            else:
                action = torch.randn(batch_size, self.config.d_model, device=device)
                action = self.action_encoder(action)
            
            # Imagine step
            next_state = self.rssm.imagine_step(states[-1], action)
            states.append(next_state)
            features.append(self.rssm.get_features(next_state))
        
        features = torch.stack(features, dim=1)
        
        # Predict rewards and values
        rewards = self.reward_predictor(features).squeeze(-1)
        values = self.value_net(features).squeeze(-1)
        continues = torch.sigmoid(self.continue_predictor(features).squeeze(-1))
        
        return {
            "features": features,
            "rewards": rewards,
            "values": values,
            "continues": continues,
            "states": states
        }
    
    def compute_loss(
        self,
        observations: torch.Tensor,
        actions: torch.Tensor,
        rewards: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Compute world model training loss.
        """
        batch_size, seq_len, _ = observations.shape
        
        # Observe sequence
        obs_result = self.observe(observations, actions)
        features = obs_result["features"]
        
        # Reconstruction loss
        reconstructed = self.decoder(features)
        encoded_target = self.encoder(observations.view(-1, self.config.d_model))
        encoded_target = encoded_target.view(batch_size, seq_len, -1)
        recon_loss = F.mse_loss(reconstructed, encoded_target)
        
        # KL loss (posterior vs prior)
        prior_logits = obs_result["prior_logits"].view(-1, self.config.d_discrete, self.config.num_categories)
        posterior_logits = obs_result["posterior_logits"].view(-1, self.config.d_discrete, self.config.num_categories)
        
        prior_probs = F.softmax(prior_logits, dim=-1)
        posterior_probs = F.softmax(posterior_logits, dim=-1)
        
        # KL divergence
        kl = (posterior_probs * (torch.log(posterior_probs + 1e-8) - torch.log(prior_probs + 1e-8))).sum(dim=-1)
        kl = kl.mean()
        
        # Free nats (don't penalize small KL)
        kl = torch.max(kl, torch.tensor(self.config.free_nats, device=kl.device))
        
        # Reward prediction loss
        reward_loss = torch.tensor(0.0, device=observations.device)
        if rewards is not None:
            pred_rewards = self.reward_predictor(features).squeeze(-1)
            reward_loss = F.mse_loss(pred_rewards, rewards)
        
        # Contrastive loss (temporal)
        contrastive_loss = torch.tensor(0.0, device=observations.device)
        if seq_len > 1:
            # Adjacent frames should be similar
            contrastive_loss = self.contrastive(features[:, :-1].reshape(-1, features.shape[-1]),
                                                 features[:, 1:].reshape(-1, features.shape[-1]))
        
        total_loss = recon_loss + self.config.kl_balance * kl + reward_loss + 0.1 * contrastive_loss
        
        return {
            "total": total_loss,
            "recon": recon_loss,
            "kl": kl,
            "reward": reward_loss,
            "contrastive": contrastive_loss
        }
    
    def get_world_understanding(self) -> Dict[str, Any]:
        """Get metrics about world understanding."""
        return {
            "latent_dim": self.config.d_latent,
            "discrete_dim": self.config.d_discrete * self.config.num_categories,
            "imagination_horizon": self.config.imagination_horizon,
            "type": "Dreamer-v3 RSSM"
        }


def create_advanced_world_model(d_model: int = 512) -> AdvancedWorldModel:
    """Factory function."""
    config = DreamerConfig(d_model=d_model)
    return AdvancedWorldModel(config)


if __name__ == "__main__":
    print("Testing Advanced World Model...")
    
    model = create_advanced_world_model()
    
    # Test observation
    obs = torch.randn(2, 10, 512)  # batch=2, seq=10
    actions = torch.randn(2, 10, 512)
    
    result = model.observe(obs, actions)
    print(f"Features shape: {result['features'].shape}")
    
    # Test imagination
    initial_state = result["states"][-1]
    imagined = model.imagine(initial_state, horizon=5)
    print(f"Imagined features: {imagined['features'].shape}")
    print(f"Imagined rewards: {imagined['rewards'].shape}")
    
    # Test loss
    loss = model.compute_loss(obs, actions)
    print(f"\nLosses:")
    for k, v in loss.items():
        print(f"  {k}: {v.item():.4f}")
    
    print(f"\nWorld understanding: {model.get_world_understanding()}")
    
    print("\n✅ Advanced World Model test passed!")
