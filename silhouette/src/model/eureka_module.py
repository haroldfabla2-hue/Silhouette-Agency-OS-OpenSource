"""
NANOSILHOUETTE - Eureka Module
================================
Cross-domain gap detection for serendipitous discoveries.

Finds "gaps" - nodes that are semantically similar but not connected
in the knowledge graph. These are prime candidates for novel insights.

Leverages existing modules:
- AdvancedVectorMemory for similarity search
- SemanticKnowledgeGraph for connection verification

Biological analog: Serendipitous synaptic connections
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple, Set
from dataclasses import dataclass, field
import numpy as np


@dataclass
class GapCandidate:
    """A detected semantic gap."""
    source_id: str
    target_id: str
    source_embedding: torch.Tensor
    target_embedding: torch.Tensor
    similarity: float
    is_cross_domain: bool
    source_tags: Set[str]
    target_tags: Set[str]
    gap_score: float  # Higher = more interesting gap


@dataclass
class EurekaConfig:
    """Configuration for eureka detection."""
    d_model: int = 512
    
    # Similarity thresholds (cosine similarity 0-1)
    high_similarity_threshold: float = 0.85  # Very similar
    gap_threshold: float = 0.60  # Minimum for interesting gap
    
    # Cross-domain detection
    tag_overlap_threshold: float = 0.3  # Below this = cross-domain
    
    # Search parameters
    max_candidates_per_search: int = 20
    top_k_similar: int = 50


class CrossDomainDetector(nn.Module):
    """
    Detects when two nodes are from different domains.
    
    Uses both tag-based and embedding-based detection.
    """
    
    def __init__(self, d_model: int, num_domains: int = 32):
        super().__init__()
        
        # Domain encoder
        self.domain_encoder = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.SiLU(),
            nn.Linear(128, num_domains)
        )
        
        # Domain distance metric
        self.domain_distance = nn.Sequential(
            nn.Linear(num_domains * 2, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def compute_domain(self, embedding: torch.Tensor) -> torch.Tensor:
        """Encode embedding into domain space."""
        return F.softmax(self.domain_encoder(embedding), dim=-1)
    
    def is_cross_domain(
        self,
        emb1: torch.Tensor,
        emb2: torch.Tensor
    ) -> Tuple[bool, float]:
        """
        Determine if two embeddings are from different domains.
        
        Returns (is_cross_domain, distance_score).
        """
        domain1 = self.compute_domain(emb1)
        domain2 = self.compute_domain(emb2)
        
        # Combine domains
        combined = torch.cat([domain1, domain2], dim=-1)
        distance = self.domain_distance(combined).squeeze(-1).item()
        
        # Cross-domain if distance is high
        return distance > 0.5, distance


class AnalogyScoringNetwork(nn.Module):
    """
    Scores analogy candidates.
    
    A good analogy: A is to B as C is to D
    High similarity in *relationship structure*, not just content.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Relation encoder
        self.relation_encoder = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_model)
        )
        
        # Analogy scorer
        self.scorer = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def encode_relation(
        self,
        source_emb: torch.Tensor,
        target_emb: torch.Tensor
    ) -> torch.Tensor:
        """Encode the relationship between two entities."""
        combined = torch.cat([source_emb, target_emb], dim=-1)
        return self.relation_encoder(combined)
    
    def score_analogy(
        self,
        relation1: torch.Tensor,
        relation2: torch.Tensor
    ) -> float:
        """Score how good an analogy is between two relations."""
        # Relations should be similar for a good analogy
        similarity = F.cosine_similarity(relation1, relation2, dim=-1)
        
        # Also use learned scorer
        combined = relation1 + relation2  # Mean relationship
        learned_score = self.scorer(combined).squeeze(-1).item()
        
        return (similarity.item() + learned_score) / 2


class GapScorer(nn.Module):
    """
    Scores how interesting a gap is.
    
    Higher score = more valuable potential discovery.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Gap interest scorer
        self.scorer = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 128),
            nn.SiLU(),
            nn.Linear(128, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # Novelty estimator
        self.novelty_estimator = nn.Sequential(
            nn.Linear(d_model * 2, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def score(
        self,
        source_emb: torch.Tensor,
        target_emb: torch.Tensor,
        similarity: float,
        is_cross_domain: bool,
        tag_overlap: float
    ) -> float:
        """
        Score the gap's interest level.
        
        Interesting gaps are:
        - Similar enough to be related
        - Different enough to be novel
        - Cross-domain (bonus)
        - Low tag overlap (hidden connection)
        """
        combined = torch.cat([source_emb, target_emb], dim=-1)
        
        # Base score from network
        base_score = self.scorer(combined).squeeze(-1).item()
        
        # Novelty bonus
        novelty = self.novelty_estimator(combined).squeeze(-1).item()
        
        # Similarity in "goldilocks zone" (not too similar, not too different)
        similarity_bonus = 0.0
        if 0.6 < similarity < 0.85:
            # In the sweet spot
            similarity_bonus = 0.2
        elif similarity >= 0.85:
            # Very similar but not connected - interesting!
            similarity_bonus = 0.3
        
        # Cross-domain bonus
        cross_domain_bonus = 0.3 if is_cross_domain else 0.0
        
        # Low tag overlap bonus (hidden connection)
        tag_bonus = max(0, (1 - tag_overlap) * 0.2)
        
        # Combine
        final_score = (
            base_score * 0.4 +
            novelty * 0.2 +
            similarity_bonus +
            cross_domain_bonus +
            tag_bonus
        )
        
        return min(1.0, final_score)


class EurekaModule(nn.Module):
    """
    Main module for finding semantic gaps and cross-domain analogies.
    
    Leverages:
    - AdvancedVectorMemory for efficient similarity search
    - SemanticKnowledgeGraph for connection verification
    """
    
    def __init__(self, config: Optional[EurekaConfig] = None):
        super().__init__()
        self.config = config or EurekaConfig()
        
        # Core components
        self.cross_domain_detector = CrossDomainDetector(self.config.d_model)
        self.analogy_scorer = AnalogyScoringNetwork(self.config.d_model)
        self.gap_scorer = GapScorer(self.config.d_model)
        
        # External modules (set during integration)
        self.vector_memory = None
        self.knowledge_graph = None
        
        # Statistics
        self.stats = {
            "total_searches": 0,
            "gaps_found": 0,
            "cross_domain_gaps": 0
        }
    
    def attach_modules(
        self,
        vector_memory=None,
        knowledge_graph=None
    ):
        """Attach existing NANOSILHOUETTE modules."""
        self.vector_memory = vector_memory
        self.knowledge_graph = knowledge_graph
    
    def find_gaps(
        self,
        focus_embedding: torch.Tensor,
        focus_id: str,
        focus_tags: Optional[Set[str]] = None
    ) -> List[GapCandidate]:
        """
        Find semantic gaps for a given focus node.
        
        Gaps are nodes that are:
        - Semantically similar (high cosine similarity)
        - Not connected in the knowledge graph
        """
        self.stats["total_searches"] += 1
        gaps = []
        
        focus_tags = focus_tags or set()
        
        # Ensure proper shape
        if focus_embedding.dim() == 1:
            focus_embedding = focus_embedding.unsqueeze(0)
        
        # Get existing connections
        connected = self._get_connected_nodes(focus_id)
        
        # Search for similar nodes
        similar_nodes = self._search_similar(focus_embedding, focus_id)
        
        for node_id, node_emb, similarity, node_tags in similar_nodes:
            # Skip if already connected
            if node_id in connected or node_id == focus_id:
                continue
            
            # Skip if not in gap threshold
            if similarity < self.config.gap_threshold:
                continue
            
            # Compute tag overlap
            tag_overlap = self._compute_tag_overlap(focus_tags, node_tags)
            
            # Check for cross-domain
            is_cross_domain, domain_distance = self.cross_domain_detector.is_cross_domain(
                focus_embedding,
                node_emb
            )
            
            # Also consider low tag overlap as cross-domain indicator
            if tag_overlap < self.config.tag_overlap_threshold:
                is_cross_domain = True
            
            # Score the gap
            gap_score = self.gap_scorer.score(
                focus_embedding.squeeze(0),
                node_emb.squeeze(0) if node_emb.dim() > 1 else node_emb,
                similarity,
                is_cross_domain,
                tag_overlap
            )
            
            # Create candidate
            gap = GapCandidate(
                source_id=focus_id,
                target_id=node_id,
                source_embedding=focus_embedding.squeeze(0),
                target_embedding=node_emb.squeeze(0) if node_emb.dim() > 1 else node_emb,
                similarity=similarity,
                is_cross_domain=is_cross_domain,
                source_tags=focus_tags,
                target_tags=node_tags,
                gap_score=gap_score
            )
            
            gaps.append(gap)
            self.stats["gaps_found"] += 1
            
            if is_cross_domain:
                self.stats["cross_domain_gaps"] += 1
        
        # Sort by gap score
        gaps.sort(key=lambda g: -g.gap_score)
        
        return gaps[:self.config.max_candidates_per_search]
    
    def find_analogies(
        self,
        source1: torch.Tensor,
        target1: torch.Tensor,
        max_analogies: int = 5
    ) -> List[Tuple[str, str, float]]:
        """
        Find analogies: A is to B as C is to D.
        
        Given relation (source1 → target1), find similar relations.
        """
        # Encode the reference relation
        ref_relation = self.analogy_scorer.encode_relation(source1, target1)
        
        analogies = []
        
        # Search for similar relations in knowledge graph
        if self.knowledge_graph is not None:
            for edge in self.knowledge_graph.edges:
                if edge.source_id not in self.knowledge_graph.nodes:
                    continue
                if edge.target_id not in self.knowledge_graph.nodes:
                    continue
                
                source_node = self.knowledge_graph.nodes[edge.source_id]
                target_node = self.knowledge_graph.nodes[edge.target_id]
                
                source_emb = torch.tensor(source_node.embedding)
                target_emb = torch.tensor(target_node.embedding)
                
                # Encode this relation
                candidate_relation = self.analogy_scorer.encode_relation(
                    source_emb, target_emb
                )
                
                # Score analogy
                analogy_score = self.analogy_scorer.score_analogy(
                    ref_relation, candidate_relation
                )
                
                if analogy_score > 0.5:
                    analogies.append((
                        edge.source_id,
                        edge.target_id,
                        analogy_score
                    ))
        
        # Sort by score
        analogies.sort(key=lambda x: -x[2])
        
        return analogies[:max_analogies]
    
    def _get_connected_nodes(self, node_id: str) -> Set[str]:
        """Get nodes already connected to focus node."""
        connected = {node_id}  # Include self
        
        if self.knowledge_graph is not None:
            for edge in self.knowledge_graph.edges:
                if edge.source_id == node_id:
                    connected.add(edge.target_id)
                elif edge.target_id == node_id:
                    connected.add(edge.source_id)
        
        return connected
    
    def _search_similar(
        self,
        embedding: torch.Tensor,
        exclude_id: str
    ) -> List[Tuple[str, torch.Tensor, float, Set[str]]]:
        """Search for similar nodes."""
        results = []
        
        # Try vector memory first
        if self.vector_memory is not None:
            try:
                retrieved = self.vector_memory.retrieve(
                    embedding,
                    top_k=self.config.top_k_similar
                )
                
                memories = retrieved.get("memories", [])
                for mem in memories:
                    mem_id = f"mem_{mem.get('id', '')}"
                    similarity = mem.get("similarity", 0)
                    
                    # We don't have tags here, so use empty set
                    results.append((
                        mem_id,
                        torch.zeros(self.config.d_model),  # Placeholder
                        similarity,
                        set()
                    ))
            except Exception:
                pass
        
        # Also search knowledge graph
        if self.knowledge_graph is not None:
            for node_id, node in self.knowledge_graph.nodes.items():
                if node_id == exclude_id:
                    continue
                
                node_emb = torch.tensor(node.embedding)
                
                # Compute similarity
                if embedding.dim() == 2:
                    query = embedding.squeeze(0)
                else:
                    query = embedding
                
                similarity = F.cosine_similarity(
                    query.unsqueeze(0),
                    node_emb.unsqueeze(0)
                ).item()
                
                # Get tags (domains)
                tags = set(node.metadata.get("tags", []))
                
                results.append((node_id, node_emb, similarity, tags))
        
        # Sort by similarity
        results.sort(key=lambda x: -x[2])
        
        return results[:self.config.top_k_similar]
    
    def _compute_tag_overlap(
        self,
        tags1: Set[str],
        tags2: Set[str]
    ) -> float:
        """Compute Jaccard overlap between tag sets."""
        if not tags1 and not tags2:
            return 0.0
        
        if not tags1 or not tags2:
            return 0.0
        
        intersection = len(tags1 & tags2)
        union = len(tags1 | tags2)
        
        return intersection / max(1, union)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get eureka statistics."""
        return {
            **self.stats,
            "cross_domain_rate": (
                self.stats["cross_domain_gaps"] / 
                max(1, self.stats["gaps_found"])
            )
        }


def create_eureka_module(d_model: int = 512) -> EurekaModule:
    """Factory function."""
    config = EurekaConfig(d_model=d_model)
    return EurekaModule(config)


if __name__ == "__main__":
    print("Testing Eureka Module...")
    
    eureka = create_eureka_module()
    
    # Test gap finding
    focus_emb = torch.randn(512)
    gaps = eureka.find_gaps(focus_emb, "test_node", {"science", "ai"})
    
    print(f"Found {len(gaps)} gaps")
    print(f"Stats: {eureka.get_stats()}")
    
    # Test analogy finding
    source = torch.randn(512)
    target = torch.randn(512)
    analogies = eureka.find_analogies(source, target)
    
    print(f"Found {len(analogies)} analogies")
    
    print("\n✅ Eureka Module test passed!")
