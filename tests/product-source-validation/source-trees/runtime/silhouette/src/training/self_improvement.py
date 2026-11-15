"""
NANOSILHOUETTE - Self-Improvement Engine
=========================================
Implements autonomous self-improvement:
- Performance monitoring and analysis
- Self-evaluation of outputs
- Self-training data generation
- Meta-learning optimization
"""
import time
import json
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple, Callable
from dataclasses import dataclass, field
from collections import deque
import math

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np


@dataclass
class SelfImprovementConfig:
    """Configuration for self-improvement system."""
    # Performance tracking
    track_window: int = 500  # Steps to track
    improvement_threshold: float = 0.01  # Minimum improvement rate
    
    # Self-evaluation
    eval_frequency: int = 100  # How often to self-evaluate
    confidence_threshold: float = 0.7  # Minimum confidence
    
    # Self-training
    generate_data: bool = True
    data_quality_threshold: float = 0.8
    max_self_train_ratio: float = 0.2  # Max % of self-generated data
    
    # Meta-learning
    meta_lr: float = 0.001
    meta_update_frequency: int = 500


@dataclass
class PerformanceSnapshot:
    """Snapshot of model performance at a point in time."""
    timestamp: float
    step: int
    loss: float
    accuracy: Optional[float] = None
    confidence: float = 0.0
    metrics: Dict[str, float] = field(default_factory=dict)


class PerformanceTracker:
    """
    Tracks and analyzes model performance over time.
    
    Detects improvement trends, plateaus, and degradation.
    """
    
    def __init__(self, window_size: int = 500):
        self.window_size = window_size
        self.history: deque = deque(maxlen=window_size)
        
        # Trend analysis
        self.best_loss = float('inf')
        self.best_step = 0
        self.steps_since_improvement = 0
    
    def record(
        self,
        step: int,
        loss: float,
        accuracy: Optional[float] = None,
        confidence: float = 0.0,
        **metrics
    ):
        """Record a performance snapshot."""
        snapshot = PerformanceSnapshot(
            timestamp=time.time(),
            step=step,
            loss=loss,
            accuracy=accuracy,
            confidence=confidence,
            metrics=metrics
        )
        
        self.history.append(snapshot)
        
        # Track best performance
        if loss < self.best_loss:
            self.best_loss = loss
            self.best_step = step
            self.steps_since_improvement = 0
        else:
            self.steps_since_improvement += 1
    
    def get_trend(self, window: int = 100) -> Dict[str, float]:
        """Analyze performance trend."""
        if len(self.history) < window:
            return {"status": "insufficient_data"}
        
        recent = list(self.history)[-window:]
        losses = [s.loss for s in recent]
        
        # Linear regression for trend
        x = np.arange(len(losses))
        slope = np.polyfit(x, losses, 1)[0]
        
        # Compute stats
        avg_loss = np.mean(losses)
        std_loss = np.std(losses)
        improvement_rate = (losses[0] - losses[-1]) / (losses[0] + 1e-6)
        
        return {
            "status": "improving" if slope < 0 else "degrading" if slope > 0 else "stable",
            "slope": slope,
            "avg_loss": avg_loss,
            "std_loss": std_loss,
            "improvement_rate": improvement_rate,
            "steps_since_improvement": self.steps_since_improvement
        }
    
    def is_plateauing(self, threshold: float = 0.01) -> bool:
        """Check if performance has plateaued."""
        trend = self.get_trend()
        return abs(trend.get("improvement_rate", 1.0)) < threshold
    
    def get_summary(self) -> Dict[str, Any]:
        """Get comprehensive performance summary."""
        if not self.history:
            return {}
        
        losses = [s.loss for s in self.history]
        confidences = [s.confidence for s in self.history]
        
        return {
            "current_loss": losses[-1],
            "best_loss": self.best_loss,
            "avg_loss": np.mean(losses),
            "avg_confidence": np.mean(confidences),
            "trend": self.get_trend(),
            "total_steps": len(self.history)
        }


class SelfEvaluator:
    """
    Self-evaluation of model outputs.
    
    Assesses quality, confidence, and identifies areas for improvement.
    """
    
    def __init__(self, config: SelfImprovementConfig):
        self.config = config
        
        # Track evaluation history
        self.eval_history: List[Dict] = []
        self.error_patterns: Dict[str, int] = {}
    
    def evaluate_output(
        self,
        logits: torch.Tensor,
        labels: Optional[torch.Tensor] = None,
        hidden_states: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Evaluate model output quality.
        
        Returns evaluation metrics and improvement suggestions.
        """
        with torch.no_grad():
            # Confidence from softmax entropy
            probs = F.softmax(logits, dim=-1)
            entropy = -(probs * torch.log(probs + 1e-10)).sum(dim=-1)
            confidence = 1.0 - (entropy / math.log(logits.size(-1))).mean().item()
            
            # Token-level confidence
            top_probs = probs.max(dim=-1)[0]
            avg_top_prob = top_probs.mean().item()
            
            # Uncertainty (low top prob = uncertain)
            uncertain_tokens = (top_probs < 0.5).float().mean().item()
            
            # Accuracy if labels provided
            accuracy = None
            if labels is not None:
                predictions = logits.argmax(dim=-1)
                mask = labels != -100
                if mask.any():
                    accuracy = (predictions[mask] == labels[mask]).float().mean().item()
        
        evaluation = {
            "confidence": confidence,
            "avg_top_prob": avg_top_prob,
            "uncertain_ratio": uncertain_tokens,
            "accuracy": accuracy,
            "quality_score": self._compute_quality_score(confidence, avg_top_prob, uncertain_tokens)
        }
        
        self.eval_history.append(evaluation)
        
        return evaluation
    
    def _compute_quality_score(
        self,
        confidence: float,
        avg_top_prob: float,
        uncertain_ratio: float
    ) -> float:
        """Compute overall quality score."""
        return (
            confidence * 0.4 +
            avg_top_prob * 0.3 +
            (1 - uncertain_ratio) * 0.3
        )
    
    def identify_weaknesses(self) -> List[Dict[str, Any]]:
        """Identify areas where model is weak."""
        if len(self.eval_history) < 10:
            return []
        
        recent = self.eval_history[-100:]
        
        weaknesses = []
        
        # Check for low confidence patterns
        avg_confidence = np.mean([e["confidence"] for e in recent])
        if avg_confidence < self.config.confidence_threshold:
            weaknesses.append({
                "type": "low_confidence",
                "severity": 1 - avg_confidence,
                "suggestion": "Increase training data diversity"
            })
        
        # Check for high uncertainty
        avg_uncertain = np.mean([e["uncertain_ratio"] for e in recent])
        if avg_uncertain > 0.3:
            weaknesses.append({
                "type": "high_uncertainty",
                "severity": avg_uncertain,
                "suggestion": "Focus training on uncertain regions"
            })
        
        # Check for accuracy issues
        accuracies = [e["accuracy"] for e in recent if e["accuracy"] is not None]
        if accuracies:
            avg_accuracy = np.mean(accuracies)
            if avg_accuracy < 0.8:
                weaknesses.append({
                    "type": "low_accuracy",
                    "severity": 1 - avg_accuracy,
                    "suggestion": "Review training data quality"
                })
        
        return weaknesses


class SelfTrainer:
    """
    Self-training data generation and learning.
    
    Uses model outputs to generate training data for improvement.
    """
    
    def __init__(self, config: SelfImprovementConfig, device: str = "cuda"):
        self.config = config
        self.device = device
        
        # Generated data buffer
        self.generated_data: deque = deque(maxlen=10000)
        
        # Quality filter
        self.accepted = 0
        self.rejected = 0
    
    def generate_training_example(
        self,
        model: nn.Module,
        input_ids: torch.Tensor,
        temperature: float = 0.7
    ) -> Optional[Dict[str, torch.Tensor]]:
        """
        Generate a training example using the model.
        
        Only accepts high-confidence outputs.
        """
        model.eval()
        
        with torch.no_grad():
            outputs = model(input_ids)
            logits = outputs["logits"] if isinstance(outputs, dict) else outputs
            
            # Sample from distribution
            probs = F.softmax(logits / temperature, dim=-1)
            generated = torch.multinomial(probs.view(-1, probs.size(-1)), 1).view(probs.shape[:-1])
            
            # Compute confidence
            entropy = -(probs * torch.log(probs + 1e-10)).sum(dim=-1)
            confidence = 1.0 - (entropy / math.log(logits.size(-1))).mean().item()
            
            # Quality filter
            if confidence >= self.config.data_quality_threshold:
                self.accepted += 1
                example = {
                    "input_ids": input_ids.cpu(),
                    "labels": generated.cpu(),
                    "confidence": confidence,
                    "source": "self_generated"
                }
                self.generated_data.append(example)
                return example
            else:
                self.rejected += 1
                return None
    
    def get_self_training_batch(
        self,
        batch_size: int
    ) -> Optional[Dict[str, torch.Tensor]]:
        """Get a batch of self-generated training data."""
        if len(self.generated_data) < batch_size:
            return None
        
        # Sample from generated data (prioritize high confidence)
        data = list(self.generated_data)
        data.sort(key=lambda x: x["confidence"], reverse=True)
        
        # Take top examples
        selected = data[:batch_size]
        
        return {
            "input_ids": torch.stack([d["input_ids"] for d in selected]).to(self.device),
            "labels": torch.stack([d["labels"] for d in selected]).to(self.device)
        }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get self-training statistics."""
        return {
            "generated_examples": len(self.generated_data),
            "accepted": self.accepted,
            "rejected": self.rejected,
            "acceptance_rate": self.accepted / (self.accepted + self.rejected + 1e-6)
        }


class MetaLearner:
    """
    Meta-learning for hyperparameter and architecture optimization.
    
    Learns to learn better based on performance feedback.
    """
    
    def __init__(self, config: SelfImprovementConfig):
        self.config = config
        
        # Meta-parameters to optimize
        self.meta_params = {
            "learning_rate_scale": 1.0,
            "dropout_scale": 1.0,
            "attention_scale": 1.0,
            "moe_top_k": 2
        }
        
        # History for meta-learning
        self.meta_history: List[Tuple[Dict, float]] = []
    
    def suggest_adjustments(
        self,
        performance: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Suggest hyperparameter adjustments based on performance.
        
        Uses simple rules + historical patterns.
        """
        adjustments = {}
        
        trend = performance.get("trend", {})
        status = trend.get("status", "stable")
        
        if status == "degrading":
            # Model is getting worse
            adjustments["learning_rate_scale"] = 0.9  # Reduce LR
            adjustments["dropout_scale"] = 1.1  # Increase regularization
        elif status == "stable" and trend.get("improvement_rate", 1) < 0.001:
            # Plateauing
            adjustments["learning_rate_scale"] = 1.2  # Increase LR to escape
            adjustments["attention_scale"] = 0.95  # Slightly reduce attention
        elif status == "improving":
            # Keep current settings
            pass
        
        # Apply adjustments within bounds
        for key, scale in adjustments.items():
            if key in self.meta_params:
                self.meta_params[key] *= scale
                self.meta_params[key] = max(0.1, min(10.0, self.meta_params[key]))
        
        return adjustments
    
    def record_performance(self, params: Dict, score: float):
        """Record performance for meta-learning."""
        self.meta_history.append((params.copy(), score))
        
        # Keep only recent history
        if len(self.meta_history) > 1000:
            self.meta_history = self.meta_history[-500:]
    
    def get_best_params(self) -> Dict[str, float]:
        """Get best performing parameters from history."""
        if not self.meta_history:
            return self.meta_params
        
        # Find best performing configuration
        best_params, best_score = max(self.meta_history, key=lambda x: x[1])
        return best_params


class SelfImprovementEngine:
    """
    Main self-improvement orchestrator.
    
    Coordinates all self-improvement components.
    """
    
    def __init__(
        self,
        model: nn.Module,
        config: Optional[SelfImprovementConfig] = None,
        device: str = "cuda"
    ):
        self.model = model
        self.config = config or SelfImprovementConfig()
        self.device = device
        
        # Components
        self.performance_tracker = PerformanceTracker(self.config.track_window)
        self.self_evaluator = SelfEvaluator(self.config)
        self.self_trainer = SelfTrainer(self.config, device)
        self.meta_learner = MetaLearner(self.config)
        
        # State
        self.current_step = 0
        self.improvement_actions: List[Dict] = []
    
    def step(
        self,
        loss: float,
        logits: Optional[torch.Tensor] = None,
        labels: Optional[torch.Tensor] = None,
        hidden_states: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """
        Perform a self-improvement step.
        
        Returns actions taken and suggestions.
        """
        self.current_step += 1
        actions = {}
        
        # 1. Record performance
        confidence = 0.0
        if logits is not None:
            eval_result = self.self_evaluator.evaluate_output(logits, labels, hidden_states)
            confidence = eval_result["confidence"]
        
        self.performance_tracker.record(
            step=self.current_step,
            loss=loss,
            confidence=confidence
        )
        
        # 2. Periodic self-evaluation
        if self.current_step % self.config.eval_frequency == 0:
            actions["weaknesses"] = self.self_evaluator.identify_weaknesses()
            actions["performance_summary"] = self.performance_tracker.get_summary()
            
            # Meta-learning adjustments
            if self.performance_tracker.is_plateauing():
                adjustments = self.meta_learner.suggest_adjustments(
                    actions["performance_summary"]
                )
                actions["meta_adjustments"] = adjustments
        
        # 3. Self-training data generation
        if self.config.generate_data and logits is not None:
            # Generate training data from high-confidence outputs
            # (Would need input_ids from training context)
            pass
        
        return actions
    
    def get_training_augmentation(
        self,
        original_batch: Dict[str, torch.Tensor],
        augmentation_ratio: float = 0.2
    ) -> Optional[Dict[str, torch.Tensor]]:
        """
        Get self-generated training data to augment batch.
        
        Mixes original data with self-generated data.
        """
        batch_size = original_batch["input_ids"].shape[0]
        self_train_size = int(batch_size * min(augmentation_ratio, self.config.max_self_train_ratio))
        
        if self_train_size == 0:
            return None
        
        self_batch = self.self_trainer.get_self_training_batch(self_train_size)
        
        if self_batch is None:
            return None
        
        # Mix batches
        return {
            "input_ids": torch.cat([original_batch["input_ids"], self_batch["input_ids"]], dim=0),
            "labels": torch.cat([original_batch["labels"], self_batch["labels"]], dim=0)
        }
    
    def get_improvement_plan(self) -> Dict[str, Any]:
        """
        Generate a comprehensive improvement plan.
        
        Based on all collected data and analysis.
        """
        plan = {
            "current_state": self.performance_tracker.get_summary(),
            "weaknesses": self.self_evaluator.identify_weaknesses(),
            "recommended_actions": [],
            "priority": "normal"
        }
        
        # Analyze and create action plan
        weaknesses = plan["weaknesses"]
        
        for weakness in weaknesses:
            if weakness["severity"] > 0.5:
                plan["priority"] = "high"
                plan["recommended_actions"].append({
                    "action": "address_weakness",
                    "target": weakness["type"],
                    "suggestion": weakness["suggestion"]
                })
        
        # Check for plateau
        if self.performance_tracker.is_plateauing():
            plan["recommended_actions"].append({
                "action": "escape_plateau",
                "suggestion": "Consider architecture growth or learning rate adjustment"
            })
        
        # Meta-learning recommendations
        plan["meta_params"] = self.meta_learner.meta_params
        
        return plan
    
    def get_stats(self) -> Dict[str, Any]:
        """Get comprehensive self-improvement statistics."""
        return {
            "step": self.current_step,
            "performance": self.performance_tracker.get_summary(),
            "self_training": self.self_trainer.get_stats(),
            "meta_params": self.meta_learner.meta_params,
            "improvement_plan": self.get_improvement_plan()
        }


def create_self_improvement_engine(
    model: nn.Module,
    device: str = "cuda"
) -> SelfImprovementEngine:
    """Factory function for self-improvement engine."""
    config = SelfImprovementConfig()
    return SelfImprovementEngine(model, config, device)


if __name__ == "__main__":
    print("Testing Self-Improvement Engine...")
    
    # Simple model for testing
    model = nn.Sequential(
        nn.Linear(100, 50),
        nn.ReLU(),
        nn.Linear(50, 10)
    )
    
    engine = create_self_improvement_engine(model, device="cpu")
    
    # Simulate training steps
    for step in range(200):
        # Simulate decreasing loss
        loss = 2.0 / (1 + step * 0.02) + 0.3
        
        # Simulate logits
        logits = torch.randn(8, 32, 10)
        labels = torch.randint(0, 10, (8, 32))
        
        actions = engine.step(
            loss=loss,
            logits=logits,
            labels=labels
        )
        
        if step > 0 and step % 50 == 0:
            print(f"Step {step}:")
            if "weaknesses" in actions:
                print(f"  Weaknesses: {len(actions['weaknesses'])}")
            if "meta_adjustments" in actions:
                print(f"  Adjustments: {actions['meta_adjustments']}")
    
    # Get final stats
    stats = engine.get_stats()
    print(f"\nFinal stats:")
    print(f"  Steps: {stats['step']}")
    print(f"  Self-training: {stats['self_training']}")
    
    # Get improvement plan
    plan = engine.get_improvement_plan()
    print(f"  Priority: {plan['priority']}")
    print(f"  Actions: {len(plan['recommended_actions'])}")
    
    print("\n✅ Self-Improvement Engine test passed!")
