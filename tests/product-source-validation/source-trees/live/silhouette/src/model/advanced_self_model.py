"""
NANOSILHOUETTE - Advanced Self Model
======================================
State-of-the-art self-awareness with:
- Conformal prediction for uncertainty quantification
- Bayesian capability estimation
- Dynamic skill tracking
- Multi-scale confidence calibration
- Metacognitive monitoring

Based on: Conformal Prediction, Bayesian Deep Learning, Metacognition Research
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from collections import deque
import numpy as np
import json
from pathlib import Path


@dataclass
class AdvancedSelfModelConfig:
    """Configuration for advanced self model."""
    d_model: int = 512
    d_self: int = 256
    num_skills: int = 32
    num_confidence_heads: int = 4
    calibration_window: int = 1000
    conformal_alpha: float = 0.1  # Coverage level (90%)
    dropout_samples: int = 10  # MC Dropout samples


class ConformalPredictor:
    """
    Conformal prediction for calibrated uncertainty.
    
    Provides valid prediction intervals with guaranteed coverage.
    """
    
    def __init__(self, alpha: float = 0.1, window_size: int = 1000):
        self.alpha = alpha  # 1 - coverage probability
        self.scores: deque = deque(maxlen=window_size)
        self.calibrated = False
    
    def calibrate(self, predictions: np.ndarray, targets: np.ndarray):
        """Calibrate using held-out data."""
        # Compute nonconformity scores (absolute error)
        scores = np.abs(predictions - targets)
        
        for score in scores:
            self.scores.append(score)
        
        self.calibrated = len(self.scores) >= 100
    
    def get_quantile(self) -> float:
        """Get the calibrated quantile for prediction intervals."""
        if not self.scores:
            return float('inf')
        
        n = len(self.scores)
        q = np.ceil((n + 1) * (1 - self.alpha)) / n
        return np.quantile(list(self.scores), min(q, 1.0))
    
    def predict_interval(
        self,
        prediction: float
    ) -> Tuple[float, float]:
        """Get prediction interval."""
        q = self.get_quantile()
        return (prediction - q, prediction + q)


class BayesianCapabilityHead(nn.Module):
    """
    Bayesian estimation of capabilities using MC Dropout.
    
    Provides both mean capability and uncertainty.
    """
    
    def __init__(self, d_model: int, d_self: int, num_skills: int):
        super().__init__()
        self.num_skills = num_skills
        
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_self),
            nn.LayerNorm(d_self),
            nn.Dropout(0.2),  # MC Dropout
            nn.SiLU(),
            nn.Linear(d_self, d_self),
            nn.Dropout(0.2),
            nn.SiLU()
        )
        
        # Skill heads
        self.skill_means = nn.Linear(d_self, num_skills)
        self.skill_logvars = nn.Linear(d_self, num_skills)
        
        # Prior parameters (learnable)
        self.prior_mean = nn.Parameter(torch.zeros(num_skills))
        self.prior_logvar = nn.Parameter(torch.zeros(num_skills))
    
    def forward(
        self,
        hidden: torch.Tensor,
        num_samples: int = 1
    ) -> Dict[str, torch.Tensor]:
        """
        Estimate capabilities with uncertainty.
        """
        if hidden.dim() == 3:
            hidden = hidden.mean(dim=1)
        
        if num_samples == 1:
            # Single forward pass
            encoded = self.encoder(hidden)
            means = torch.sigmoid(self.skill_means(encoded))
            logvars = self.skill_logvars(encoded)
            
            return {
                "means": means,
                "logvars": logvars,
                "uncertainty": torch.exp(logvars * 0.5)
            }
        else:
            # MC Dropout - multiple stochastic forward passes
            self.train()  # Enable dropout
            
            all_means = []
            for _ in range(num_samples):
                encoded = self.encoder(hidden)
                means = torch.sigmoid(self.skill_means(encoded))
                all_means.append(means)
            
            all_means = torch.stack(all_means, dim=0)
            
            # Epistemic uncertainty from variance across samples
            predictive_mean = all_means.mean(dim=0)
            epistemic_uncertainty = all_means.var(dim=0)
            
            # Aleatoric uncertainty from logvar
            encoded = self.encoder(hidden)
            logvars = self.skill_logvars(encoded)
            aleatoric_uncertainty = torch.exp(logvars)
            
            return {
                "means": predictive_mean,
                "epistemic_uncertainty": epistemic_uncertainty,
                "aleatoric_uncertainty": aleatoric_uncertainty,
                "total_uncertainty": epistemic_uncertainty + aleatoric_uncertainty,
                "samples": all_means
            }


class MultiScaleConfidence(nn.Module):
    """
    Multi-scale confidence estimation at different granularities.
    
    - Token-level: confidence per output token
    - Span-level: confidence for phrases/concepts
    - Sequence-level: overall response confidence
    """
    
    def __init__(self, d_model: int, num_heads: int = 4):
        super().__init__()
        self.num_heads = num_heads
        
        # Token-level confidence
        self.token_confidence = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid()
        )
        
        # Span-level (via 1D convolutions)
        self.span_conv = nn.ModuleList([
            nn.Conv1d(d_model, 1, kernel_size=k, padding=k//2)
            for k in [3, 5, 7, 9]
        ])
        
        # Sequence-level
        self.sequence_confidence = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 1),
            nn.Sigmoid()
        )
        
        # Multi-head aggregation
        self.confidence_heads = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_model, 64),
                nn.SiLU(),
                nn.Linear(64, 1),
                nn.Sigmoid()
            )
            for _ in range(num_heads)
        ])
    
    def forward(
        self,
        hidden: torch.Tensor  # (batch, seq, d_model)
    ) -> Dict[str, torch.Tensor]:
        """Compute multi-scale confidence."""
        batch_size, seq_len, d_model = hidden.shape
        
        # Token-level
        token_conf = self.token_confidence(hidden).squeeze(-1)  # (batch, seq)
        
        # Span-level
        h_transposed = hidden.transpose(1, 2)  # (batch, d_model, seq)
        span_confs = []
        for conv in self.span_conv:
            span_conf = torch.sigmoid(conv(h_transposed))  # (batch, 1, seq)
            span_confs.append(span_conf.squeeze(1))
        span_conf = torch.stack(span_confs, dim=-1).mean(dim=-1)  # (batch, seq)
        
        # Sequence-level
        pooled = hidden.mean(dim=1)
        seq_conf = self.sequence_confidence(pooled).squeeze(-1)  # (batch,)
        
        # Multi-head confidence
        head_confs = []
        for head in self.confidence_heads:
            h_conf = head(pooled).squeeze(-1)
            head_confs.append(h_conf)
        multi_head_conf = torch.stack(head_confs, dim=-1)  # (batch, num_heads)
        
        return {
            "token_confidence": token_conf,
            "span_confidence": span_conf,
            "sequence_confidence": seq_conf,
            "multi_head_confidence": multi_head_conf,
            "mean_confidence": multi_head_conf.mean(dim=-1),
            "confidence_variance": multi_head_conf.var(dim=-1)
        }


class MetacognitiveMonitor(nn.Module):
    """
    Monitors thinking processes and detects cognitive errors.
    
    Like a "supervisor" watching the model's reasoning.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Coherence detector
        self.coherence_net = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 1),
            nn.Sigmoid()
        )
        
        # Contradiction detector
        self.contradiction_net = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 1),
            nn.Sigmoid()
        )
        
        # Hallucination risk estimator
        self.hallucination_net = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid()
        )
        
        # Reasoning quality estimator
        self.reasoning_net = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 3)  # [poor, okay, good]
        )
        
        # Error types
        self.error_types = [
            "logical_error",
            "factual_error",
            "inconsistency",
            "vagueness",
            "overconfidence",
            "underconfidence",
            "circular_reasoning",
            "non_sequitur"
        ]
        
        self.error_detector = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.SiLU(),
            nn.Linear(128, len(self.error_types))
        )
    
    def forward(
        self,
        hidden: torch.Tensor,
        prev_hidden: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """Monitor cognitive state."""
        if hidden.dim() == 3:
            pooled = hidden.mean(dim=1)
        else:
            pooled = hidden
        
        # Hallucination risk
        hallucination_risk = self.hallucination_net(pooled).squeeze(-1)
        
        # Reasoning quality
        reasoning_logits = self.reasoning_net(pooled)
        reasoning_probs = F.softmax(reasoning_logits, dim=-1)
        reasoning_quality = reasoning_probs[:, 2]  # P(good)
        
        # Error detection
        error_logits = self.error_detector(pooled)
        error_probs = torch.sigmoid(error_logits)
        detected_errors = [
            self.error_types[i] for i in range(len(self.error_types))
            if error_probs[0, i] > 0.5
        ] if error_probs.shape[0] == 1 else []
        
        # Coherence and contradiction (if we have previous state)
        coherence = torch.ones(pooled.shape[0], device=pooled.device)
        contradiction = torch.zeros(pooled.shape[0], device=pooled.device)
        
        if prev_hidden is not None:
            if prev_hidden.dim() == 3:
                prev_pooled = prev_hidden.mean(dim=1)
            else:
                prev_pooled = prev_hidden
            
            combined = torch.cat([prev_pooled, pooled], dim=-1)
            coherence = self.coherence_net(combined).squeeze(-1)
            contradiction = self.contradiction_net(combined).squeeze(-1)
        
        return {
            "hallucination_risk": hallucination_risk,
            "reasoning_quality": reasoning_quality,
            "coherence": coherence,
            "contradiction_risk": contradiction,
            "error_probabilities": error_probs,
            "detected_errors": detected_errors,
            "cognitive_health": (1 - hallucination_risk) * reasoning_quality * coherence
        }


class SkillTracker:
    """
    Tracks skill development over time.
    
    Maintains history and detects improvement/degradation.
    """
    
    def __init__(self, num_skills: int, window_size: int = 100):
        self.num_skills = num_skills
        self.window_size = window_size
        
        # Skill histories
        self.skill_history: Dict[int, deque] = {
            i: deque(maxlen=window_size) for i in range(num_skills)
        }
        
        # Skill names
        self.skill_names = [
            "language_modeling", "reasoning", "math", "coding",
            "factual_recall", "creative_writing", "summarization",
            "translation", "qa", "dialogue", "analysis", "planning",
            "common_sense", "domain_knowledge", "metacognition", "learning",
            "memory", "attention", "abstraction", "analogy",
            "causality", "counterfactual", "theory_of_mind", "self_reflection",
            "error_detection", "uncertainty", "calibration", "adaptation",
            "generalization", "composition", "decomposition", "evaluation"
        ][:num_skills]
    
    def update(self, skill_idx: int, performance: float):
        """Record skill performance."""
        self.skill_history[skill_idx].append(performance)
    
    def get_trend(self, skill_idx: int) -> Dict[str, float]:
        """Analyze skill trend."""
        history = list(self.skill_history[skill_idx])
        if len(history) < 5:
            return {"trend": 0.0, "current": 0.5, "variance": 0.0}
        
        recent = np.array(history[-10:])
        older = np.array(history[:-10]) if len(history) > 10 else np.array([0.5])
        
        trend = recent.mean() - older.mean()
        
        return {
            "trend": float(trend),
            "current": float(recent.mean()),
            "variance": float(recent.var()),
            "improving": trend > 0.05,
            "degrading": trend < -0.05
        }
    
    def get_skill_profile(self) -> Dict[str, Any]:
        """Get complete skill profile."""
        profile = {}
        for i in range(self.num_skills):
            history = list(self.skill_history[i])
            if history:
                profile[self.skill_names[i]] = {
                    "current": float(np.mean(history[-10:])) if len(history) >= 10 else float(np.mean(history)),
                    "samples": len(history),
                    **self.get_trend(i)
                }
        return profile


class AdvancedSelfModel(nn.Module):
    """
    State-of-the-art self-awareness system.
    
    Integrates:
    - Conformal prediction for calibrated uncertainty
    - Bayesian capability estimation
    - Multi-scale confidence
    - Metacognitive monitoring
    - Skill tracking
    """
    
    def __init__(self, config: Optional[AdvancedSelfModelConfig] = None):
        super().__init__()
        self.config = config or AdvancedSelfModelConfig()
        
        # Core components
        self.bayesian_capabilities = BayesianCapabilityHead(
            self.config.d_model,
            self.config.d_self,
            self.config.num_skills
        )
        
        self.confidence = MultiScaleConfidence(
            self.config.d_model,
            self.config.num_confidence_heads
        )
        
        self.metacognition = MetacognitiveMonitor(self.config.d_model)
        
        # Conformal predictors for each skill
        self.conformal_predictors = {
            i: ConformalPredictor(self.config.conformal_alpha)
            for i in range(self.config.num_skills)
        }
        
        # Skill tracker
        self.skill_tracker = SkillTracker(
            self.config.num_skills,
            self.config.calibration_window
        )
        
        # Self-embedding
        self.self_embedding = nn.Parameter(torch.randn(self.config.d_self))
        
        # Integration
        self.integrator = nn.Sequential(
            nn.Linear(self.config.d_model + self.config.d_self + self.config.num_skills, 
                      self.config.d_self),
            nn.LayerNorm(self.config.d_self),
            nn.SiLU()
        )
    
    def forward(
        self,
        hidden: torch.Tensor,
        prev_hidden: Optional[torch.Tensor] = None,
        logits: Optional[torch.Tensor] = None,
        use_mc_dropout: bool = True
    ) -> Dict[str, Any]:
        """
        Complete self-assessment with uncertainty quantification.
        """
        # Bayesian capability estimation
        n_samples = self.config.dropout_samples if use_mc_dropout else 1
        capabilities = self.bayesian_capabilities(hidden, num_samples=n_samples)
        
        # Multi-scale confidence
        if hidden.dim() == 2:
            hidden = hidden.unsqueeze(1)
        confidence = self.confidence(hidden)
        
        # Metacognitive monitoring
        metacog = self.metacognition(hidden, prev_hidden)
        
        # Integration
        pooled = hidden.mean(dim=1) if hidden.dim() == 3 else hidden
        self_emb = self.self_embedding.unsqueeze(0).expand(pooled.shape[0], -1)
        
        integrated_input = torch.cat([
            pooled,
            self_emb,
            capabilities["means"]
        ], dim=-1)
        integrated = self.integrator(integrated_input)
        
        # Overall self-awareness score
        awareness_score = (
            confidence["mean_confidence"] * 0.3 +
            metacog["cognitive_health"] * 0.4 +
            (1 - capabilities["total_uncertainty"].mean(dim=-1)) * 0.3
            if "total_uncertainty" in capabilities else
            confidence["mean_confidence"] * 0.5 + metacog["cognitive_health"] * 0.5
        )
        
        return {
            "capabilities": capabilities,
            "confidence": confidence,
            "metacognition": metacog,
            "integrated_state": integrated,
            "self_embedding": self_emb,
            "awareness_score": awareness_score,
            "should_respond": metacog["cognitive_health"] > 0.5,
            "needs_clarification": confidence["confidence_variance"] > 0.1
        }
    
    def update_from_feedback(
        self,
        skill_idx: int,
        predicted: float,
        actual: float
    ):
        """Update conformal predictor and skill tracker with feedback."""
        # Update conformal predictor
        self.conformal_predictors[skill_idx].calibrate(
            np.array([predicted]),
            np.array([actual])
        )
        
        # Update skill tracker
        self.skill_tracker.update(skill_idx, actual)
    
    def get_prediction_interval(
        self,
        skill_idx: int,
        prediction: float
    ) -> Tuple[float, float]:
        """Get conformal prediction interval for a skill."""
        return self.conformal_predictors[skill_idx].predict_interval(prediction)
    
    def get_self_report(self) -> Dict[str, Any]:
        """Generate comprehensive self-report."""
        return {
            "skill_profile": self.skill_tracker.get_skill_profile(),
            "conformal_calibrated": sum(
                1 for cp in self.conformal_predictors.values() if cp.calibrated
            ),
            "total_skills": self.config.num_skills,
            "d_self": self.config.d_self,
            "type": "Advanced Self Model with Conformal Prediction"
        }
    
    def save(self, path: Path):
        """Save self model state."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        torch.save(self.state_dict(), path / "self_model.pt")
        
        with open(path / "self_report.json", "w") as f:
            json.dump(self.get_self_report(), f, indent=2, default=str)


def create_advanced_self_model(d_model: int = 512) -> AdvancedSelfModel:
    """Factory function."""
    config = AdvancedSelfModelConfig(d_model=d_model)
    return AdvancedSelfModel(config)


if __name__ == "__main__":
    print("Testing Advanced Self Model...")
    
    model = create_advanced_self_model()
    
    # Test forward pass
    hidden = torch.randn(2, 32, 512)
    prev_hidden = torch.randn(2, 32, 512)
    
    result = model(hidden, prev_hidden, use_mc_dropout=True)
    
    print(f"Capabilities shape: {result['capabilities']['means'].shape}")
    print(f"Confidence: {result['confidence']['mean_confidence']}")
    print(f"Awareness score: {result['awareness_score']}")
    print(f"Cognitive health: {result['metacognition']['cognitive_health']}")
    print(f"Should respond: {result['should_respond']}")
    
    if "epistemic_uncertainty" in result["capabilities"]:
        print(f"Epistemic uncertainty: {result['capabilities']['epistemic_uncertainty'].mean():.4f}")
    
    # Test feedback update
    model.update_from_feedback(0, 0.7, 0.8)
    
    # Get prediction interval
    interval = model.get_prediction_interval(0, 0.75)
    print(f"\nConformal interval: {interval}")
    
    # Get report
    report = model.get_self_report()
    print(f"\nSelf report: {report}")
    
    print("\n✅ Advanced Self Model test passed!")
