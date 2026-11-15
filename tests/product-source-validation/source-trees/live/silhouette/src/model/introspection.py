"""
NANOSILHOUETTE - Introspection Module
State monitoring and self-explanation (inspired by Anthropic research).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from dataclasses import dataclass
from typing import Optional, Dict


@dataclass
class IntrospectionConfig:
    d_model: int = 512
    num_features: int = 128
    monitor_dim: int = 64
    safety_threshold: float = 0.5


class StateMonitor(nn.Module):
    """Monitors internal state for anomalies."""
    def __init__(self, d_model: int, monitor_dim: int):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(d_model, monitor_dim),
            nn.SiLU(),
            nn.Linear(monitor_dim, monitor_dim)
        )
        self.anomaly_detector = nn.Linear(monitor_dim, 1)
    
    def forward(self, hidden_states: torch.Tensor) -> Dict[str, torch.Tensor]:
        pooled = hidden_states.mean(dim=1)
        encoded = self.encoder(pooled)
        anomaly_score = torch.sigmoid(self.anomaly_detector(encoded))
        return {"state_encoding": encoded, "anomaly_score": anomaly_score}


class FeatureExtractor(nn.Module):
    """Sparse feature extraction (dictionary learning concept)."""
    def __init__(self, d_model: int, num_features: int):
        super().__init__()
        self.dictionary = nn.Parameter(torch.randn(num_features, d_model) * 0.02)
        self.encoder = nn.Linear(d_model, num_features)
    
    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        pooled = x.mean(dim=1)
        coeffs = F.relu(self.encoder(pooled))  # Sparse activation
        # Top-k sparsity
        topk_vals, topk_idx = coeffs.topk(k=min(16, coeffs.shape[-1]), dim=-1)
        return {"coefficients": coeffs, "top_features": topk_idx, "top_values": topk_vals}


class SelfReporter(nn.Module):
    """Generates explanations of internal state."""
    def __init__(self, monitor_dim: int, d_model: int):
        super().__init__()
        self.report_gen = nn.Sequential(
            nn.Linear(monitor_dim, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_model)
        )
    
    def forward(self, state_encoding: torch.Tensor) -> torch.Tensor:
        return self.report_gen(state_encoding)


class IntrospectionModule(nn.Module):
    """Complete introspection module combining all components."""
    def __init__(self, config: IntrospectionConfig):
        super().__init__()
        self.config = config
        self.state_monitor = StateMonitor(config.d_model, config.monitor_dim)
        self.feature_extractor = FeatureExtractor(config.d_model, config.num_features)
        self.self_reporter = SelfReporter(config.monitor_dim, config.d_model)
        self.safety_threshold = config.safety_threshold
    
    def forward(self, hidden_states: torch.Tensor) -> Dict[str, torch.Tensor]:
        monitor_out = self.state_monitor(hidden_states)
        features = self.feature_extractor(hidden_states)
        report = self.self_reporter(monitor_out["state_encoding"])
        
        is_safe = monitor_out["anomaly_score"] < self.safety_threshold
        
        return {
            "anomaly_score": monitor_out["anomaly_score"],
            "state_encoding": monitor_out["state_encoding"],
            "active_features": features["top_features"],
            "feature_values": features["top_values"],
            "self_report": report,
            "is_safe": is_safe
        }
    
    def get_consistency_loss(self, report1: torch.Tensor, report2: torch.Tensor) -> torch.Tensor:
        """Loss to ensure consistent self-reports."""
        return F.mse_loss(F.normalize(report1, dim=-1), F.normalize(report2, dim=-1))


if __name__ == "__main__":
    cfg = IntrospectionConfig()
    intro = IntrospectionModule(cfg)
    x = torch.randn(2, 128, 512)
    out = intro(x)
    print(f"Anomaly: {out['anomaly_score'].shape}, Features: {out['active_features'].shape}")
    print(f"Is safe: {out['is_safe'].squeeze()}")
