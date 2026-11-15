"""
NANOSILHOUETTE - Self Model
==============================
Implements self-awareness and meta-cognition:
- Knowledge estimation (what do I know?)
- Capability assessment (what can I do?)
- Limitation recognition (what don't I know?)
- Performance prediction (how well will I do?)

This enables true self-awareness - the model understands itself.
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
class SelfModelConfig:
    """Configuration for self model."""
    d_model: int = 512
    d_self: int = 128  # Self-representation dimension
    num_capability_domains: int = 16  # Different skill areas
    confidence_bins: int = 10  # Discretized confidence levels
    history_size: int = 1000  # Experiences for calibration


@dataclass
class CapabilityProfile:
    """Profile of model capabilities in a domain."""
    domain: str
    confidence: float  # How confident in this domain
    accuracy: float  # Historical accuracy
    experience_count: int  # How many times used
    last_updated: float = 0.0


class KnowledgeEstimator(nn.Module):
    """
    Estimates how much the model knows about a topic.
    
    Learns to predict "do I know this?" from context.
    """
    
    def __init__(self, d_model: int, d_self: int):
        super().__init__()
        
        # Knowledge representation
        self.knowledge_encoder = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_self)
        )
        
        # Knowledge score predictor
        self.knowledge_scorer = nn.Sequential(
            nn.Linear(d_self, d_self),
            nn.SiLU(),
            nn.Linear(d_self, 1),
            nn.Sigmoid()  # 0-1 knowledge score
        )
        
        # Uncertainty estimator
        self.uncertainty_head = nn.Sequential(
            nn.Linear(d_self, d_self // 2),
            nn.SiLU(),
            nn.Linear(d_self // 2, 1),
            nn.Softplus()  # Positive uncertainty
        )
    
    def forward(
        self,
        hidden_states: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Estimate knowledge level for given context.
        
        Returns:
            knowledge_score: 0-1, how much we know
            uncertainty: How uncertain about the estimate
            knowledge_embedding: Representation of what we know
        """
        # Pool hidden states
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        # Encode to knowledge space
        knowledge_emb = self.knowledge_encoder(pooled)
        
        # Score and uncertainty
        score = self.knowledge_scorer(knowledge_emb)
        uncertainty = self.uncertainty_head(knowledge_emb)
        
        return {
            "knowledge_score": score.squeeze(-1),
            "uncertainty": uncertainty.squeeze(-1),
            "knowledge_embedding": knowledge_emb
        }


class CapabilityAssessor(nn.Module):
    """
    Assesses model capabilities across different domains.
    
    Learns what the model is good at and what it struggles with.
    """
    
    def __init__(self, d_model: int, num_domains: int = 16):
        super().__init__()
        self.num_domains = num_domains
        
        # Domain classifier (what type of task is this?)
        self.domain_classifier = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, num_domains)
        )
        
        # Capability scores per domain
        self.domain_capabilities = nn.Parameter(torch.ones(num_domains) * 0.5)
        
        # Confidence predictor
        self.confidence_predictor = nn.Sequential(
            nn.Linear(d_model + num_domains, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid()
        )
        
        # Domain names (human readable)
        self.domain_names = [
            "language_understanding",
            "reasoning",
            "mathematics", 
            "coding",
            "factual_recall",
            "creative_writing",
            "summarization",
            "translation",
            "question_answering",
            "dialogue",
            "analysis",
            "planning",
            "common_sense",
            "specialized_knowledge",
            "meta_cognition",
            "other"
        ]
        
        # Performance history per domain
        self.domain_history: Dict[int, List[float]] = {i: [] for i in range(num_domains)}
    
    def forward(
        self,
        hidden_states: torch.Tensor
    ) -> Dict[str, Any]:
        """
        Assess capability for given task.
        
        Returns:
            domain_probs: Probability distribution over domains
            predicted_domain: Most likely domain
            capability_score: Expected performance
            confidence: Confidence in assessment
        """
        # Pool hidden states
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        # Classify domain
        domain_logits = self.domain_classifier(pooled)
        domain_probs = F.softmax(domain_logits, dim=-1)
        predicted_domain = domain_probs.argmax(dim=-1)
        
        # Get capability for predicted domain
        capabilities = torch.sigmoid(self.domain_capabilities)
        capability_score = (domain_probs * capabilities.unsqueeze(0)).sum(dim=-1)
        
        # Predict confidence
        combined = torch.cat([pooled, domain_probs], dim=-1)
        confidence = self.confidence_predictor(combined).squeeze(-1)
        
        return {
            "domain_probs": domain_probs,
            "predicted_domain": predicted_domain,
            "domain_name": [self.domain_names[d.item()] for d in predicted_domain],
            "capability_score": capability_score,
            "confidence": confidence,
            "all_capabilities": capabilities
        }
    
    def update_capability(
        self,
        domain_idx: int,
        actual_performance: float,
        learning_rate: float = 0.1
    ):
        """Update capability estimate based on actual performance."""
        # Running average
        old_cap = torch.sigmoid(self.domain_capabilities[domain_idx]).item()
        new_cap = old_cap * (1 - learning_rate) + actual_performance * learning_rate
        
        # Convert back to logit
        new_cap = max(0.01, min(0.99, new_cap))  # Clamp
        self.domain_capabilities.data[domain_idx] = torch.log(
            torch.tensor(new_cap / (1 - new_cap))
        )
        
        # Store history
        self.domain_history[domain_idx].append(actual_performance)
        if len(self.domain_history[domain_idx]) > 100:
            self.domain_history[domain_idx] = self.domain_history[domain_idx][-100:]


class LimitationDetector(nn.Module):
    """
    Detects and recognizes model limitations.
    
    Learns to identify when the model doesn't know something.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Limitation classifier
        self.detector = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, d_model // 4),
            nn.SiLU(),
            nn.Linear(d_model // 4, 3)  # [knows, unsure, doesn't_know]
        )
        
        # Specific limitation types
        self.limitation_types = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 8)  # Different limitation types
        )
        
        self.limitation_names = [
            "lack_of_knowledge",
            "ambiguous_context",
            "out_of_distribution",
            "conflicting_information",
            "requires_reasoning",
            "temporal_cutoff",
            "language_barrier",
            "insufficient_context"
        ]
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        output_logits: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Detect limitations for current context.
        
        Returns:
            knowledge_state: knows/unsure/doesn't_know
            limitation_types: Which limitations apply
            should_abstain: Whether to say "I don't know"
        """
        # Pool
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        # Knowledge state
        state_logits = self.detector(pooled)
        state_probs = F.softmax(state_logits, dim=-1)
        knowledge_state = state_probs.argmax(dim=-1)
        
        # Limitation types
        limitation_logits = self.limitation_types(pooled)
        limitation_probs = torch.sigmoid(limitation_logits)
        
        # Should abstain if doesn't know or very unsure
        should_abstain = (
            (state_probs[:, 2] > 0.5) |  # Doesn't know
            (state_probs[:, 1] > 0.7)    # Very unsure
        )
        
        # Use output entropy if available
        if output_logits is not None:
            probs = F.softmax(output_logits, dim=-1)
            entropy = -(probs * torch.log(probs + 1e-10)).sum(dim=-1)
            max_entropy = torch.log(torch.tensor(output_logits.shape[-1], dtype=torch.float))
            normalized_entropy = entropy / max_entropy
            
            # High entropy = uncertain
            should_abstain = should_abstain | (normalized_entropy.mean(dim=-1) > 0.8)
        
        return {
            "knowledge_state": knowledge_state,
            "state_probs": state_probs,  # [knows, unsure, doesn't_know]
            "limitation_types": limitation_probs,
            "active_limitations": [
                self.limitation_names[i] 
                for i, p in enumerate(limitation_probs[0]) 
                if p > 0.5
            ] if limitation_probs.shape[0] == 1 else [],
            "should_abstain": should_abstain,
            "abstention_confidence": state_probs[:, 2]  # P(doesn't know)
        }


class PerformancePredictor(nn.Module):
    """
    Predicts how well the model will perform on a task.
    
    Enables the model to know its limits before attempting.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        self.predictor = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.SiLU(),
            nn.Linear(d_model // 2, 1),
            nn.Sigmoid()
        )
        
        # Track calibration (is it accurate?)
        self.predictions: List[float] = []
        self.actuals: List[float] = []
    
    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        return self.predictor(pooled).squeeze(-1)
    
    def calibration_error(self) -> float:
        """Compute expected calibration error."""
        if len(self.predictions) < 10:
            return 1.0
        
        predictions = np.array(self.predictions[-1000:])
        actuals = np.array(self.actuals[-1000:])
        
        # Bin predictions and compute calibration
        bins = np.linspace(0, 1, 11)
        ece = 0.0
        
        for i in range(10):
            mask = (predictions >= bins[i]) & (predictions < bins[i+1])
            if mask.sum() > 0:
                avg_pred = predictions[mask].mean()
                avg_actual = actuals[mask].mean()
                ece += mask.sum() * abs(avg_pred - avg_actual)
        
        return ece / len(predictions)


class SelfModel(nn.Module):
    """
    Complete Self Model for meta-cognition and self-awareness.
    
    Integrates all self-understanding components.
    """
    
    def __init__(self, config: Optional[SelfModelConfig] = None):
        super().__init__()
        self.config = config or SelfModelConfig()
        
        # Components
        self.knowledge_estimator = KnowledgeEstimator(
            self.config.d_model,
            self.config.d_self
        )
        self.capability_assessor = CapabilityAssessor(
            self.config.d_model,
            self.config.num_capability_domains
        )
        self.limitation_detector = LimitationDetector(self.config.d_model)
        self.performance_predictor = PerformancePredictor(self.config.d_model)
        
        # Self-representation (learned identity)
        self.self_embedding = nn.Parameter(torch.randn(self.config.d_self))
        
        # History for self-improvement
        self.self_history: deque = deque(maxlen=self.config.history_size)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        output_logits: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Complete self-assessment for current context.
        
        Returns comprehensive self-awareness metrics.
        """
        # Knowledge estimation
        knowledge = self.knowledge_estimator(hidden_states)
        
        # Capability assessment
        capability = self.capability_assessor(hidden_states)
        
        # Limitation detection
        limitations = self.limitation_detector(hidden_states, output_logits)
        
        # Performance prediction
        predicted_performance = self.performance_predictor(hidden_states)
        
        # Combined self-awareness score
        self_awareness = (
            knowledge["knowledge_score"] * 0.3 +
            capability["confidence"] * 0.3 +
            (1 - limitations["abstention_confidence"]) * 0.2 +
            predicted_performance * 0.2
        )
        
        return {
            "knowledge": knowledge,
            "capability": capability,
            "limitations": limitations,
            "predicted_performance": predicted_performance,
            "self_awareness_score": self_awareness,
            "should_respond": ~limitations["should_abstain"],
            "self_embedding": self.self_embedding
        }
    
    def get_self_description(self) -> Dict[str, Any]:
        """Get a description of the model's self-understanding."""
        capabilities = torch.sigmoid(self.capability_assessor.domain_capabilities)
        
        # Find strongest and weakest areas
        cap_values = capabilities.detach().cpu().numpy()
        domain_names = self.capability_assessor.domain_names
        
        strongest = [(domain_names[i], float(cap_values[i])) 
                     for i in np.argsort(cap_values)[-3:][::-1]]
        weakest = [(domain_names[i], float(cap_values[i])) 
                   for i in np.argsort(cap_values)[:3]]
        
        return {
            "strongest_capabilities": strongest,
            "weakest_capabilities": weakest,
            "calibration_error": self.performance_predictor.calibration_error(),
            "total_experiences": len(self.self_history),
            "identity_embedding_norm": self.self_embedding.norm().item()
        }
    
    def update_from_feedback(
        self,
        hidden_states: torch.Tensor,
        actual_performance: float  # 0-1
    ):
        """Update self-model based on actual performance."""
        with torch.no_grad():
            # Get assessment
            capability = self.capability_assessor(hidden_states)
            domain_idx = capability["predicted_domain"][0].item()
            
            # Update capability estimate
            self.capability_assessor.update_capability(
                domain_idx, actual_performance
            )
            
            # Track for calibration
            predicted = self.performance_predictor(hidden_states).item()
            self.performance_predictor.predictions.append(predicted)
            self.performance_predictor.actuals.append(actual_performance)
            
            # Store experience
            self.self_history.append({
                "domain": domain_idx,
                "predicted": predicted,
                "actual": actual_performance
            })
    
    def save_self_knowledge(self, path: Path):
        """Save self-knowledge to disk."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        description = self.get_self_description()
        with open(path / "self_knowledge.json", "w") as f:
            json.dump(description, f, indent=2)
        
        torch.save(self.state_dict(), path / "self_model.pt")


def create_self_model(d_model: int = 512) -> SelfModel:
    """Factory function for self model."""
    config = SelfModelConfig(d_model=d_model)
    return SelfModel(config)


if __name__ == "__main__":
    print("Testing Self Model...")
    
    model = create_self_model(d_model=512)
    
    # Test forward pass
    hidden = torch.randn(2, 32, 512)
    logits = torch.randn(2, 32, 1000)
    
    assessment = model(hidden, logits)
    
    print(f"Knowledge score: {assessment['knowledge']['knowledge_score']}")
    print(f"Capability: {assessment['capability']['domain_name']}")
    print(f"Should respond: {assessment['should_respond']}")
    print(f"Self-awareness: {assessment['self_awareness_score']}")
    
    # Test self-description
    description = model.get_self_description()
    print(f"\nStrongest: {description['strongest_capabilities']}")
    print(f"Weakest: {description['weakest_capabilities']}")
    
    # Test feedback update
    model.update_from_feedback(hidden, actual_performance=0.8)
    
    print("\n✅ Self Model test passed!")
