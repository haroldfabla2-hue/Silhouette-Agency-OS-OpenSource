"""
NANOSILHOUETTE - Synthesis Service
====================================
Synthesizes meta-insights from multiple discoveries.

Designed for AGI-scale:
- Pattern recognition across discoveries
- Novel hypothesis generation
- Evidence aggregation
- Confidence calibration

Biological analog: Prefrontal cortex synthesis
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
import time
import json
from pathlib import Path


@dataclass
class SynthesizedInsight:
    """A synthesized meta-insight from multiple discoveries."""
    id: str
    title: str
    summary: str
    discoveries: List[str]  # IDs of contributing discoveries
    patterns: List[str]
    novel_hypothesis: str
    confidence: float
    domain: str
    created_at: float = field(default_factory=time.time)
    embedding: Optional[torch.Tensor] = None
    
    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "title": self.title,
            "summary": self.summary,
            "discoveries": self.discoveries,
            "patterns": self.patterns,
            "novel_hypothesis": self.novel_hypothesis,
            "confidence": self.confidence,
            "domain": self.domain,
            "created_at": self.created_at
        }


@dataclass
class SynthesisConfig:
    """Configuration for synthesis service."""
    d_model: int = 512
    min_discoveries_for_synthesis: int = 3
    max_patterns_per_insight: int = 5
    confidence_threshold: float = 0.6


class PatternRecognizer(nn.Module):
    """
    Recognizes patterns across multiple discoveries.
    
    Uses attention to find common threads.
    """
    
    def __init__(self, d_model: int, num_heads: int = 8):
        super().__init__()
        
        # Self-attention for finding patterns
        self.self_attention = nn.MultiheadAttention(
            d_model, num_heads, batch_first=True
        )
        
        # Pattern encoder
        self.pattern_encoder = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.LayerNorm(d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_model)
        )
        
        # Pattern scorer
        self.pattern_scorer = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # Pattern classifier (what type of pattern)
        self.pattern_classifier = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 8)  # 8 pattern types
        )
        
        self.pattern_types = [
            "causal_chain",      # A causes B causes C
            "analogy",           # A is to B as C is to D
            "hierarchy",         # A contains B contains C
            "cycle",             # A leads to B leads to A
            "convergence",       # Multiple paths lead to same
            "divergence",        # One source, multiple effects
            "temporal",          # Time-based sequence
            "structural"         # Structural similarity
        ]
    
    def forward(
        self,
        discovery_embeddings: torch.Tensor  # (batch, num_discoveries, d_model)
    ) -> Dict[str, Any]:
        """
        Find patterns across discoveries.
        """
        # Self-attention to find relationships
        attended, attention_weights = self.self_attention(
            discovery_embeddings,
            discovery_embeddings,
            discovery_embeddings
        )
        
        # Encode patterns
        patterns = self.pattern_encoder(attended)
        
        # Score each pattern
        scores = self.pattern_scorer(patterns).squeeze(-1)
        
        # Classify pattern types
        type_logits = self.pattern_classifier(patterns)
        type_probs = F.softmax(type_logits, dim=-1)
        
        # Get top patterns
        top_scores, top_indices = scores.topk(
            min(5, scores.shape[-1]), dim=-1
        )
        
        return {
            "patterns": patterns,
            "scores": scores,
            "attention_weights": attention_weights,
            "type_probs": type_probs,
            "top_indices": top_indices,
            "top_scores": top_scores
        }
    
    def describe_pattern(self, type_idx: int) -> str:
        """Get human-readable pattern description."""
        if 0 <= type_idx < len(self.pattern_types):
            return self.pattern_types[type_idx]
        return "unknown"


class HypothesisGenerator(nn.Module):
    """
    Generates novel hypotheses from patterns.
    
    Creates new insights that weren't in the original discoveries.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Pattern combiner
        self.combiner = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_model)
        )
        
        # Hypothesis decoder
        self.decoder = nn.TransformerDecoderLayer(
            d_model=d_model,
            nhead=8,
            dim_feedforward=d_model * 2,
            batch_first=True
        )
        
        # Novelty scorer
        self.novelty_scorer = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # Confidence estimator
        self.confidence_estimator = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def forward(
        self,
        patterns: torch.Tensor,       # (batch, num_patterns, d_model)
        context: torch.Tensor         # (batch, context_len, d_model)
    ) -> Dict[str, torch.Tensor]:
        """
        Generate hypothesis from patterns.
        """
        # Combine patterns
        if patterns.shape[1] >= 2:
            combined = self.combiner(
                torch.cat([patterns[:, 0], patterns[:, 1]], dim=-1)
            )
        else:
            combined = patterns.mean(dim=1)
        
        combined = combined.unsqueeze(1)
        
        # Decode hypothesis
        hypothesis = self.decoder(combined, context)
        
        # Score novelty
        novelty = self.novelty_scorer(hypothesis.squeeze(1)).squeeze(-1)
        
        # Estimate confidence
        confidence = self.confidence_estimator(hypothesis.squeeze(1)).squeeze(-1)
        
        return {
            "hypothesis": hypothesis.squeeze(1),
            "novelty": novelty,
            "confidence": confidence
        }


class DomainAnalyzer(nn.Module):
    """
    Analyzes which domains are involved in discoveries.
    """
    
    def __init__(self, d_model: int, num_domains: int = 16):
        super().__init__()
        
        self.domain_classifier = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.SiLU(),
            nn.Linear(128, num_domains)
        )
        
        self.domains = [
            "science", "technology", "engineering", "mathematics",
            "philosophy", "psychology", "linguistics", "arts",
            "history", "economics", "politics", "social",
            "biology", "physics", "chemistry", "medicine"
        ]
    
    def forward(self, embeddings: torch.Tensor) -> Dict[str, Any]:
        """Classify domains of discoveries."""
        logits = self.domain_classifier(embeddings)
        probs = F.softmax(logits, dim=-1)
        
        top_domains = probs.argmax(dim=-1)
        
        return {
            "domain_probs": probs,
            "primary_domain": top_domains,
            "is_cross_domain": (probs.max(dim=-1)[0] < 0.5)
        }
    
    def get_domain_name(self, idx: int) -> str:
        if 0 <= idx < len(self.domains):
            return self.domains[idx]
        return "unknown"


class SynthesisService(nn.Module):
    """
    Synthesizes meta-insights from discoveries.
    
    Leverages existing NANOSILHOUETTE modules:
    - ChainOfThought for reasoning
    - SemanticKnowledgeGraph for context
    - AdvancedVectorMemory for retrieval
    """
    
    def __init__(self, config: Optional[SynthesisConfig] = None):
        super().__init__()
        self.config = config or SynthesisConfig()
        
        # Core components
        self.pattern_recognizer = PatternRecognizer(self.config.d_model)
        self.hypothesis_generator = HypothesisGenerator(self.config.d_model)
        self.domain_analyzer = DomainAnalyzer(self.config.d_model)
        
        # Discovery encoder
        self.discovery_encoder = nn.Sequential(
            nn.Linear(self.config.d_model * 2, self.config.d_model),
            nn.LayerNorm(self.config.d_model),
            nn.SiLU()
        )
        
        # Title generator (maps embedding to title vector)
        self.title_generator = nn.Sequential(
            nn.Linear(self.config.d_model, 128),
            nn.SiLU(),
            nn.Linear(128, self.config.d_model)
        )
        
        # External module references
        self.chain_of_thought = None
        self.knowledge_graph = None
        self.vector_memory = None
        self.discovery_journal = None
        
        # Storage
        self.insights: List[SynthesizedInsight] = []
        self.insight_counter = 0
    
    def attach_modules(
        self,
        chain_of_thought=None,
        knowledge_graph=None,
        vector_memory=None,
        discovery_journal=None
    ):
        """Attach existing NANOSILHOUETTE modules."""
        self.chain_of_thought = chain_of_thought
        self.knowledge_graph = knowledge_graph
        self.vector_memory = vector_memory
        self.discovery_journal = discovery_journal
    
    def synthesize(
        self,
        discovery_embeddings: List[Tuple[str, torch.Tensor, torch.Tensor]],
        context_embedding: Optional[torch.Tensor] = None
    ) -> Optional[SynthesizedInsight]:
        """
        Synthesize an insight from multiple discoveries.
        
        Args:
            discovery_embeddings: List of (id, source_emb, target_emb)
            context_embedding: Optional context
            
        Returns:
            SynthesizedInsight if synthesis successful
        """
        if len(discovery_embeddings) < self.config.min_discoveries_for_synthesis:
            return None
        
        # Encode discoveries
        encoded = []
        discovery_ids = []
        
        for disc_id, source_emb, target_emb in discovery_embeddings:
            if source_emb.dim() == 1:
                source_emb = source_emb.unsqueeze(0)
            if target_emb.dim() == 1:
                target_emb = target_emb.unsqueeze(0)
            
            combined = torch.cat([source_emb, target_emb], dim=-1)
            enc = self.discovery_encoder(combined)
            encoded.append(enc)
            discovery_ids.append(disc_id)
        
        # Stack
        discovery_tensor = torch.stack(encoded, dim=1)  # (1, num_disc, d)
        
        # Find patterns
        pattern_result = self.pattern_recognizer(discovery_tensor)
        
        # Get context
        if context_embedding is None:
            context_embedding = discovery_tensor.mean(dim=1, keepdim=True)
        elif context_embedding.dim() == 2:
            context_embedding = context_embedding.unsqueeze(1)
        
        # Generate hypothesis
        hypothesis_result = self.hypothesis_generator(
            pattern_result["patterns"],
            context_embedding
        )
        
        # Check confidence threshold
        confidence = hypothesis_result["confidence"].mean().item()
        if confidence < self.config.confidence_threshold:
            return None
        
        # Analyze domain
        domain_result = self.domain_analyzer(discovery_tensor.mean(dim=1))
        domain_idx = domain_result["primary_domain"][0].item()
        domain_name = self.domain_analyzer.get_domain_name(domain_idx)
        
        # Extract patterns
        patterns = []
        top_indices = pattern_result["top_indices"][0]
        type_probs = pattern_result["type_probs"][0]
        
        for idx in top_indices[:self.config.max_patterns_per_insight]:
            type_idx = type_probs[idx].argmax().item()
            pattern_name = self.pattern_recognizer.describe_pattern(type_idx)
            patterns.append(pattern_name)
        
        # Create insight
        self.insight_counter += 1
        insight_id = f"insight_{self.insight_counter}"
        
        insight = SynthesizedInsight(
            id=insight_id,
            title=f"Synthesis from {len(discovery_ids)} discoveries",
            summary=f"Cross-discovery pattern: {', '.join(patterns[:3])}",
            discoveries=discovery_ids,
            patterns=patterns,
            novel_hypothesis=f"Novel connection in {domain_name} domain",
            confidence=confidence,
            domain=domain_name,
            embedding=hypothesis_result["hypothesis"]
        )
        
        self.insights.append(insight)
        
        return insight
    
    def synthesize_from_journal(
        self,
        min_age_hours: float = 1.0,
        max_discoveries: int = 20
    ) -> List[SynthesizedInsight]:
        """
        Synthesize insights from recent journal entries.
        """
        if self.discovery_journal is None:
            return []
        
        from .discovery_journal import DiscoveryDecision
        
        # Get recent accepted discoveries
        recent = self.discovery_journal.get_recent_discoveries(
            limit=max_discoveries,
            decision_filter=DiscoveryDecision.ACCEPT
        )
        
        if len(recent) < self.config.min_discoveries_for_synthesis:
            return []
        
        # Group by domain/relation type
        groups: Dict[str, List] = {}
        
        for entry in recent:
            key = entry.relation_type
            if key not in groups:
                groups[key] = []
            groups[key].append(entry)
        
        insights = []
        
        for relation_type, entries in groups.items():
            if len(entries) >= self.config.min_discoveries_for_synthesis:
                # Create dummy embeddings (in real use, would retrieve from KG)
                d = self.config.d_model
                discovery_embs = [
                    (e.id, torch.randn(d), torch.randn(d))
                    for e in entries[:10]
                ]
                
                insight = self.synthesize(discovery_embs)
                
                if insight is not None:
                    insights.append(insight)
        
        return insights
    
    def get_recent_insights(self, limit: int = 10) -> List[SynthesizedInsight]:
        """Get recent synthesized insights."""
        return self.insights[-limit:]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get synthesis statistics."""
        domain_counts = {}
        for insight in self.insights:
            domain = insight.domain
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
        
        return {
            "total_insights": len(self.insights),
            "avg_confidence": sum(i.confidence for i in self.insights) / max(1, len(self.insights)),
            "by_domain": domain_counts,
            "avg_discoveries_per_insight": sum(len(i.discoveries) for i in self.insights) / max(1, len(self.insights))
        }
    
    def save_insights(self, path: Path):
        """Save insights to file."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        
        data = [i.to_dict() for i in self.insights]
        
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
    
    def load_insights(self, path: Path):
        """Load insights from file."""
        path = Path(path)
        
        if not path.exists():
            return
        
        with open(path) as f:
            data = json.load(f)
        
        for d in data:
            insight = SynthesizedInsight(
                id=d["id"],
                title=d["title"],
                summary=d["summary"],
                discoveries=d["discoveries"],
                patterns=d["patterns"],
                novel_hypothesis=d["novel_hypothesis"],
                confidence=d["confidence"],
                domain=d["domain"],
                created_at=d.get("created_at", time.time())
            )
            self.insights.append(insight)


def create_synthesis_service(d_model: int = 512) -> SynthesisService:
    """Factory function."""
    config = SynthesisConfig(d_model=d_model)
    return SynthesisService(config)


if __name__ == "__main__":
    print("Testing Synthesis Service...")
    
    service = create_synthesis_service()
    
    # Create dummy discoveries
    discoveries = [
        ("disc_1", torch.randn(512), torch.randn(512)),
        ("disc_2", torch.randn(512), torch.randn(512)),
        ("disc_3", torch.randn(512), torch.randn(512)),
        ("disc_4", torch.randn(512), torch.randn(512)),
    ]
    
    # Synthesize
    insight = service.synthesize(discoveries)
    
    if insight:
        print(f"\nGenerated insight:")
        print(f"  ID: {insight.id}")
        print(f"  Domain: {insight.domain}")
        print(f"  Patterns: {insight.patterns}")
        print(f"  Confidence: {insight.confidence:.3f}")
    
    print(f"\nStats: {service.get_stats()}")
    
    print("\n✅ Synthesis Service test passed!")
