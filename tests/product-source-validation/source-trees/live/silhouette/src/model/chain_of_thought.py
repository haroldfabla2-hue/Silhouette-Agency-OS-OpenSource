"""
NANOSILHOUETTE - Chain of Thought Module
==========================================
State-of-the-art reasoning with:
- Explicit reasoning traces
- Self-consistency decoding
- Tree of Thought exploration
- Verification and reflection
- Decomposition strategies

Based on: CoT, Self-Consistency, ToT, Reflexion, Let's Think Step by Step
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from collections import deque
import numpy as np


@dataclass
class ChainOfThoughtConfig:
    """Configuration for Chain of Thought."""
    d_model: int = 512
    d_thought: int = 256
    max_reasoning_steps: int = 10
    num_reasoning_paths: int = 5  # For self-consistency
    tree_width: int = 3  # For Tree of Thought
    tree_depth: int = 3
    verification_threshold: float = 0.7


class ThoughtEncoder(nn.Module):
    """Encodes thoughts into thought space."""
    
    def __init__(self, d_model: int, d_thought: int):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_thought * 2),
            nn.LayerNorm(d_thought * 2),
            nn.SiLU(),
            nn.Linear(d_thought * 2, d_thought),
            nn.LayerNorm(d_thought)
        )
    
    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        if hidden.dim() == 3:
            hidden = hidden.mean(dim=1)
        return self.encoder(hidden)


class ReasoningStep(nn.Module):
    """
    A single step in the reasoning chain.
    
    Takes previous thought and produces next thought.
    """
    
    def __init__(self, d_thought: int):
        super().__init__()
        
        # Thought transformation
        self.transform = nn.Sequential(
            nn.Linear(d_thought, d_thought * 2),
            nn.SiLU(),
            nn.Linear(d_thought * 2, d_thought)
        )
        
        # Gating (how much new vs carry forward)
        self.gate = nn.Sequential(
            nn.Linear(d_thought * 2, d_thought),
            nn.Sigmoid()
        )
        
        # Step type classifier
        self.step_classifier = nn.Sequential(
            nn.Linear(d_thought, 64),
            nn.SiLU(),
            nn.Linear(64, 5)  # [decompose, analyze, synthesize, verify, conclude]
        )
        
        self.step_names = ["decompose", "analyze", "synthesize", "verify", "conclude"]
    
    def forward(
        self,
        prev_thought: torch.Tensor,
        context: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Perform one reasoning step.
        """
        # Transform thought
        new_thought = self.transform(prev_thought)
        
        # Gate
        combined = torch.cat([prev_thought, new_thought], dim=-1)
        gate = self.gate(combined)
        
        # Residual with gating
        thought = gate * new_thought + (1 - gate) * prev_thought
        
        # Classify step type
        step_logits = self.step_classifier(thought)
        step_type = step_logits.argmax(dim=-1)
        
        return {
            "thought": thought,
            "gate": gate,
            "step_type": step_type,
            "step_name": [self.step_names[t.item()] for t in step_type]
        }


class ThoughtEvaluator(nn.Module):
    """
    Evaluates quality and progress of thoughts.
    """
    
    def __init__(self, d_thought: int):
        super().__init__()
        
        # Quality scorer
        self.quality = nn.Sequential(
            nn.Linear(d_thought, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Progress estimator (how close to answer)
        self.progress = nn.Sequential(
            nn.Linear(d_thought, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Coherence with previous
        self.coherence = nn.Sequential(
            nn.Linear(d_thought * 2, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Confidence
        self.confidence = nn.Sequential(
            nn.Linear(d_thought, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def forward(
        self,
        thought: torch.Tensor,
        prev_thought: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """Evaluate thought."""
        quality = self.quality(thought).squeeze(-1)
        progress = self.progress(thought).squeeze(-1)
        confidence = self.confidence(thought).squeeze(-1)
        
        coherence = torch.ones_like(quality)
        if prev_thought is not None:
            combined = torch.cat([prev_thought, thought], dim=-1)
            coherence = self.coherence(combined).squeeze(-1)
        
        # Overall score
        score = quality * 0.3 + progress * 0.3 + coherence * 0.2 + confidence * 0.2
        
        return {
            "quality": quality,
            "progress": progress,
            "coherence": coherence,
            "confidence": confidence,
            "overall_score": score
        }


class TreeOfThought(nn.Module):
    """
    Tree of Thought exploration.
    
    Explores multiple reasoning paths simultaneously.
    """
    
    def __init__(
        self,
        d_thought: int,
        width: int = 3,
        depth: int = 3
    ):
        super().__init__()
        self.width = width
        self.depth = depth
        
        # Branch generator
        self.branch_generator = nn.Sequential(
            nn.Linear(d_thought, d_thought * width),
            nn.SiLU()
        )
        
        # Branch scorer
        self.branch_scorer = nn.Sequential(
            nn.Linear(d_thought, 64),
            nn.SiLU(),
            nn.Linear(64, 1)
        )
        
        # Reasoning step for each branch
        self.stepper = ReasoningStep(d_thought)
    
    def expand(
        self,
        thought: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Expand thought into multiple branches."""
        batch_size = thought.shape[0]
        
        # Generate branches
        branches = self.branch_generator(thought)
        branches = branches.view(batch_size, self.width, -1)
        
        # Score branches
        scores = self.branch_scorer(branches).squeeze(-1)
        
        return branches, scores
    
    def search(
        self,
        root_thought: torch.Tensor,
        beam_size: int = 3
    ) -> Dict[str, Any]:
        """
        Beam search through thought tree.
        """
        batch_size = root_thought.shape[0]
        
        # Initialize with root
        beams = [(root_thought, 0.0, [root_thought])]  # (thought, score, path)
        
        for depth in range(self.depth):
            candidates = []
            
            for thought, score, path in beams:
                # Expand
                branches, branch_scores = self.expand(thought)
                
                for i in range(min(self.width, branches.shape[1])):
                    branch = branches[:, i]
                    
                    # Take reasoning step
                    step_result = self.stepper(branch, thought)
                    new_thought = step_result["thought"]
                    
                    # Update score
                    new_score = score + branch_scores[:, i].mean().item()
                    
                    candidates.append((
                        new_thought,
                        new_score,
                        path + [new_thought]
                    ))
            
            # Keep top beams
            candidates.sort(key=lambda x: -x[1])
            beams = candidates[:beam_size]
        
        # Best path
        best_thought, best_score, best_path = beams[0]
        
        return {
            "final_thought": best_thought,
            "score": best_score,
            "path": best_path,
            "path_length": len(best_path),
            "all_beams": beams
        }


class SelfConsistency(nn.Module):
    """
    Self-consistency decoding.
    
    Generates multiple reasoning paths and aggregates.
    """
    
    def __init__(self, d_thought: int, num_paths: int = 5):
        super().__init__()
        self.num_paths = num_paths
        
        # Path generator (adds stochasticity)
        self.path_noise = nn.Sequential(
            nn.Linear(d_thought, d_thought),
            nn.Tanh()
        )
        
        # Path weight
        self.path_weight = nn.Sequential(
            nn.Linear(d_thought, 64),
            nn.SiLU(),
            nn.Linear(64, 1)
        )
        
        # Reasoning
        self.stepper = ReasoningStep(d_thought)
    
    def forward(
        self,
        thought: torch.Tensor,
        num_steps: int = 5
    ) -> Dict[str, Any]:
        """
        Generate multiple reasoning paths and aggregate.
        """
        batch_size = thought.shape[0]
        
        all_paths = []
        all_weights = []
        
        for path_idx in range(self.num_paths):
            # Add noise for diversity
            noise = self.path_noise(torch.randn_like(thought))
            path_thought = thought + 0.1 * noise
            
            path = [path_thought]
            
            # Reason along path
            for step in range(num_steps):
                step_result = self.stepper(path_thought, path[-1] if len(path) > 1 else None)
                path_thought = step_result["thought"]
                path.append(path_thought)
            
            final_thought = path[-1]
            weight = self.path_weight(final_thought)
            
            all_paths.append(final_thought)
            all_weights.append(weight)
        
        # Stack and aggregate
        paths_stacked = torch.stack(all_paths, dim=1)  # (batch, num_paths, d)
        weights = torch.cat(all_weights, dim=-1)  # (batch, num_paths)
        weights = F.softmax(weights, dim=-1)
        
        # Weighted aggregation
        aggregated = (paths_stacked * weights.unsqueeze(-1)).sum(dim=1)
        
        # Consistency score (agreement between paths)
        pairwise_sim = F.cosine_similarity(
            paths_stacked.unsqueeze(2),
            paths_stacked.unsqueeze(1),
            dim=-1
        )
        consistency = pairwise_sim.mean(dim=(1, 2))
        
        return {
            "aggregated_thought": aggregated,
            "all_paths": paths_stacked,
            "weights": weights,
            "consistency": consistency
        }


class Verifier(nn.Module):
    """
    Verifies reasoning steps and conclusions.
    """
    
    def __init__(self, d_thought: int):
        super().__init__()
        
        # Step verifier
        self.step_verifier = nn.Sequential(
            nn.Linear(d_thought * 2, 256),
            nn.SiLU(),
            nn.Linear(256, 1),
            nn.Sigmoid()
        )
        
        # Conclusion verifier
        self.conclusion_verifier = nn.Sequential(
            nn.Linear(d_thought * 2, 256),
            nn.SiLU(),
            nn.Linear(256, 1),
            nn.Sigmoid()
        )
        
        # Error detector
        self.error_detector = nn.Sequential(
            nn.Linear(d_thought, 128),
            nn.SiLU(),
            nn.Linear(128, 5)  # [no_error, logical, factual, incomplete, circular]
        )
        
        self.error_types = ["no_error", "logical_error", "factual_error", 
                           "incomplete", "circular_reasoning"]
                           
        # Evidence Verifier (Veracity Engine)
        self.evidence_scorer = nn.Sequential(
            nn.Linear(d_thought * 2, 256),
            nn.SiLU(),
            nn.Linear(256, 128),
            nn.SiLU(),
            nn.Linear(128, 3)  # [supported, contradicts, irrelevant]
        )
    
    def verify_step(
        self,
        prev_thought: torch.Tensor,
        curr_thought: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """Verify a reasoning step."""
        combined = torch.cat([prev_thought, curr_thought], dim=-1)
        valid = self.step_verifier(combined).squeeze(-1)
        
        # Detect errors
        error_logits = self.error_detector(curr_thought)
        error_probs = F.softmax(error_logits, dim=-1)
        error_type = error_probs.argmax(dim=-1)
        
        return {
            "valid": valid,
            "error_probs": error_probs,
            "error_type": [self.error_types[t.item()] for t in error_type],
            "has_error": error_type != 0
        }
    
    def verify_conclusion(
        self,
        initial_thought: torch.Tensor,
        final_thought: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """Verify final conclusion."""
        combined = torch.cat([initial_thought, final_thought], dim=-1)
        valid = self.conclusion_verifier(combined).squeeze(-1)
        
        return {
            "valid": valid,
            "confidence": valid  # Higher validity = higher confidence
        }

    def verify_with_evidence(
        self,
        claim_embedding: torch.Tensor,
        evidence_embeddings: List[torch.Tensor]
    ) -> Dict[str, Any]:
        """
        Verify a claim against multiple pieces of evidence.
        Acts as the 'Internal Judge' for external information.
        """
        if not evidence_embeddings:
            return {"verdict": "no_evidence", "confidence": 0.0}
            
        results = []
        for evidence in evidence_embeddings:
            # Pair: [Claim, Evidence]
            combined = torch.cat([claim_embedding, evidence], dim=-1)
            scores = self.evidence_scorer(combined)
            probs = F.softmax(scores, dim=-1) # [supported, contradicts, irrelevant]
            results.append(probs)
            
        # Aggregate logic
        avg_probs = torch.stack(results).mean(dim=0)
        support_score = avg_probs[0].item()
        contradict_score = avg_probs[1].item()
        
        verdict = "ambiguous"
        confidence = 0.5
        
        if support_score > 0.7:
            verdict = "verified"
            confidence = support_score
        elif contradict_score > 0.6:
            verdict = "debunked"
            confidence = contradict_score
        elif avg_probs[2].item() > 0.6: # irrelevant
            verdict = "unsupported"
            confidence = 1.0 - avg_probs[2].item()
            
        return {
            "verdict": verdict,
            "confidence": confidence,
            "support_score": support_score,
            "contradict_score": contradict_score
        }


class Reflector(nn.Module):
    """
    Reflects on reasoning and suggests improvements.
    """
    
    def __init__(self, d_thought: int):
        super().__init__()
        
        # Critique generator
        self.critique = nn.Sequential(
            nn.Linear(d_thought * 2, 256),
            nn.SiLU(),
            nn.Linear(256, d_thought)
        )
        
        # Improvement suggester
        self.improve = nn.Sequential(
            nn.Linear(d_thought * 2, 512),
            nn.SiLU(),
            nn.Linear(512, d_thought)
        )
        
        # Retry decision
        self.should_retry = nn.Sequential(
            nn.Linear(d_thought, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def forward(
        self,
        thought: torch.Tensor,
        verification_result: Optional[Dict] = None
    ) -> Dict[str, torch.Tensor]:
        """Reflect and suggest improvements."""
        # Generate critique
        combined = torch.cat([thought, thought], dim=-1)  # Self-critique
        critique = self.critique(combined)
        
        # Generate improvement
        improvement_input = torch.cat([thought, critique], dim=-1)
        improved = self.improve(improvement_input)
        
        # Should we retry?
        retry = self.should_retry(thought).squeeze(-1)
        
        return {
            "critique": critique,
            "improved_thought": improved,
            "should_retry": retry > 0.5,
            "retry_confidence": retry
        }


class ChainOfThought(nn.Module):
    """
    Complete Chain of Thought reasoning system.
    """
    
    def __init__(self, config: Optional[ChainOfThoughtConfig] = None):
        super().__init__()
        self.config = config or ChainOfThoughtConfig()
        
        # Components
        self.encoder = ThoughtEncoder(
            self.config.d_model,
            self.config.d_thought
        )
        
        self.stepper = ReasoningStep(self.config.d_thought)
        self.evaluator = ThoughtEvaluator(self.config.d_thought)
        
        self.tree = TreeOfThought(
            self.config.d_thought,
            self.config.tree_width,
            self.config.tree_depth
        )
        
        self.consistency = SelfConsistency(
            self.config.d_thought,
            self.config.num_reasoning_paths
        )
        
        self.verifier = Verifier(self.config.d_thought)
        self.reflector = Reflector(self.config.d_thought)
        
        # Output decoder
        self.decoder = nn.Sequential(
            nn.Linear(self.config.d_thought, self.config.d_thought * 2),
            nn.SiLU(),
            nn.Linear(self.config.d_thought * 2, self.config.d_model)
        )
    
    def forward(
        self,
        hidden: torch.Tensor,
        mode: str = "chain"  # "chain", "tree", "consistent"
    ) -> Dict[str, Any]:
        """
        Perform reasoning.
        
        Modes:
        - chain: Sequential reasoning steps
        - tree: Tree of thought exploration
        - consistent: Self-consistency with multiple paths
        """
        # Encode initial thought
        initial_thought = self.encoder(hidden)
        
        if mode == "chain":
            return self._chain_reason(initial_thought)
        elif mode == "tree":
            return self._tree_reason(initial_thought)
        elif mode == "consistent":
            return self._consistent_reason(initial_thought)
        else:
            return self._chain_reason(initial_thought)
    
    def _chain_reason(
        self,
        initial_thought: torch.Tensor
    ) -> Dict[str, Any]:
        """Sequential chain of thought."""
        thought = initial_thought
        trace = [thought]
        evaluations = []
        
        for step in range(self.config.max_reasoning_steps):
            # Take step
            step_result = self.stepper(thought, trace[-1] if len(trace) > 1 else None)
            thought = step_result["thought"]
            trace.append(thought)
            
            # Evaluate
            eval_result = self.evaluator(thought, trace[-2])
            evaluations.append(eval_result)
            
            # Early stopping if high progress
            if eval_result["progress"].mean() > 0.9:
                break
        
        # Verify conclusion
        verification = self.verifier.verify_conclusion(initial_thought, thought)
        
        # Reflect if needed
        reflection = None
        if verification["valid"].mean() < self.config.verification_threshold:
            reflection = self.reflector(thought, verification)
            if reflection["should_retry"].any():
                # Try again with improved thought
                thought = reflection["improved_thought"]
        
        # Decode
        output = self.decoder(thought)
        
        return {
            "output": output,
            "final_thought": thought,
            "trace": trace,
            "evaluations": evaluations,
            "verification": verification,
            "reflection": reflection,
            "num_steps": len(trace) - 1
        }
    
    def _tree_reason(
        self,
        initial_thought: torch.Tensor
    ) -> Dict[str, Any]:
        """Tree of thought reasoning."""
        tree_result = self.tree.search(initial_thought)
        
        # Verify
        verification = self.verifier.verify_conclusion(
            initial_thought,
            tree_result["final_thought"]
        )
        
        # Decode
        output = self.decoder(tree_result["final_thought"])
        
        return {
            "output": output,
            "final_thought": tree_result["final_thought"],
            "path": tree_result["path"],
            "score": tree_result["score"],
            "verification": verification,
            "method": "tree"
        }
    
    def _consistent_reason(
        self,
        initial_thought: torch.Tensor
    ) -> Dict[str, Any]:
        """Self-consistency reasoning."""
        consist_result = self.consistency(initial_thought)
        
        # Verify
        verification = self.verifier.verify_conclusion(
            initial_thought,
            consist_result["aggregated_thought"]
        )
        
        # Decode
        output = self.decoder(consist_result["aggregated_thought"])
        
        return {
            "output": output,
            "final_thought": consist_result["aggregated_thought"],
            "consistency": consist_result["consistency"],
            "num_paths": self.config.num_reasoning_paths,
            "verification": verification,
            "method": "self-consistency"
        }
    
    def reason_with_reflection(
        self,
        hidden: torch.Tensor,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Reason with reflection loop (Reflexion-style).
        """
        result = self.forward(hidden, mode="chain")
        retries = 0
        
        while (result["verification"]["valid"].mean() < self.config.verification_threshold 
               and retries < max_retries):
            # Reflect and improve
            reflection = self.reflector(result["final_thought"])
            
            if not reflection["should_retry"].any():
                break
            
            # Re-encode improved thought
            # In reality, would use improved thought as new starting point
            result = self.forward(hidden, mode="chain")
            retries += 1
        
        result["num_retries"] = retries
        return result


def create_chain_of_thought(d_model: int = 512) -> ChainOfThought:
    """Factory function."""
    config = ChainOfThoughtConfig(d_model=d_model)
    return ChainOfThought(config)


if __name__ == "__main__":
    print("Testing Chain of Thought...")
    
    cot = create_chain_of_thought()
    
    hidden = torch.randn(2, 32, 512)
    
    # Test chain mode
    print("\n1. Chain mode:")
    result = cot(hidden, mode="chain")
    print(f"  Steps: {result['num_steps']}")
    print(f"  Verification: {result['verification']['valid'].mean():.3f}")
    
    # Test tree mode
    print("\n2. Tree mode:")
    result = cot(hidden, mode="tree")
    print(f"  Path length: {len(result['path'])}")
    print(f"  Score: {result['score']:.3f}")
    
    # Test consistent mode
    print("\n3. Self-consistency mode:")
    result = cot(hidden, mode="consistent")
    print(f"  Consistency: {result['consistency'].mean():.3f}")
    print(f"  Paths: {result['num_paths']}")
    
    # Test with reflection
    print("\n4. Reflection mode:")
    result = cot.reason_with_reflection(hidden)
    print(f"  Retries: {result['num_retries']}")
    print(f"  Final verification: {result['verification']['valid'].mean():.3f}")
    
    print("\n✅ Chain of Thought test passed!")
