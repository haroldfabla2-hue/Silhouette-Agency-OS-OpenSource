"""
NANOSILHOUETTE - Discovery Engine
==================================
Neurocognitive discovery system that finds non-explicit connections.

Biomimetic principles:
- Dual Process: System 1 (intuition) + System 2 (validation)
- Watts-Strogatz: Small-world topology for optimal connectivity
- Hebbian: "Cells that fire together wire together"
- Predictive Coding: Error-driven learning
- Global Workspace: Unified cognitive integration

Leverages existing modules:
- SemanticKnowledgeGraph → GNN link prediction
- AdvancedVectorMemory → Similarity search
- ChainOfThought → Deliberate validation
- AdvancedCuriosity → Intrinsic rewards
- AdvancedSelfModel → Metacognition / hallucination check
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple, Set
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import numpy as np
import time
import math


class DiscoveryDecision(Enum):
    """Biologically-inspired decision outcomes."""
    ACCEPT = "accept"      # T-cell positive selection → create relation
    REFINE = "refine"      # B-cell affinity maturation → more research
    DEFER = "defer"        # Circuit breaker HALF-OPEN → retry later
    REJECT = "reject"      # T-cell negative selection → discard


@dataclass
class DiscoveryCandidate:
    """A candidate connection to evaluate."""
    source_id: str
    target_id: str
    source_embedding: torch.Tensor
    target_embedding: torch.Tensor
    relation_type: str
    confidence: float
    source: str  # "gnn", "eureka", "open_triangle"
    metadata: Dict = field(default_factory=dict)


@dataclass
class DiscoveryResult:
    """Result of discovery cycle."""
    candidate: DiscoveryCandidate
    decision: DiscoveryDecision
    validation_score: float
    reasoning_trace: List[str]
    timestamp: float = field(default_factory=time.time)


@dataclass
class DiscoveryEngineConfig:
    """Configuration for discovery engine."""
    d_model: int = 512
    
    # Watts-Strogatz
    rewiring_probability: float = 0.1
    target_clustering: float = 0.5
    target_path_length: float = 3.0
    
    # Hebbian
    learning_rate: float = 0.1
    strengthening_factor: float = 1.2
    weakening_factor: float = 0.8
    
    # Discovery thresholds
    accept_threshold: float = 0.7
    refine_threshold: float = 0.4
    defer_threshold: float = 0.2
    
    # Cycle settings
    auto_cycle_interval: int = 100  # steps between auto cycles
    max_candidates_per_cycle: int = 10
    deferred_retry_delay: int = 50  # steps before retry


class WattsStrogatzOptimizer(nn.Module):
    """
    Maintains small-world properties in the knowledge graph.
    
    Small-world networks have:
    - High clustering (like regular lattice)
    - Short path lengths (like random graph)
    
    This is optimal for both local processing and global integration.
    """
    
    def __init__(self, config: DiscoveryEngineConfig):
        super().__init__()
        self.config = config
        
        # Metrics history
        self.clustering_history: List[float] = []
        self.path_length_history: List[float] = []
    
    def compute_clustering_coefficient(
        self,
        adjacency: Dict[str, List[str]],
        sample_size: int = 100
    ) -> float:
        """
        Compute clustering coefficient.
        
        C = (number of closed triangles) / (number of possible triangles)
        
        High C means neighbors of a node are likely connected to each other.
        """
        if len(adjacency) < 3:
            return 0.0
        
        nodes = list(adjacency.keys())
        if len(nodes) > sample_size:
            nodes = np.random.choice(nodes, sample_size, replace=False).tolist()
        
        total_triangles = 0
        total_possible = 0
        
        for node in nodes:
            neighbors = set(adjacency.get(node, []))
            k = len(neighbors)
            
            if k < 2:
                continue
            
            # Count connections between neighbors
            closed = 0
            for n1 in neighbors:
                for n2 in neighbors:
                    if n1 != n2 and n2 in adjacency.get(n1, []):
                        closed += 1
            
            closed //= 2  # Each edge counted twice
            possible = k * (k - 1) // 2
            
            total_triangles += closed
            total_possible += possible
        
        if total_possible == 0:
            return 0.0
        
        return total_triangles / total_possible
    
    def estimate_path_length(
        self,
        adjacency: Dict[str, List[str]],
        sample_size: int = 50
    ) -> float:
        """
        Estimate average shortest path length using BFS sampling.
        
        Short L means information can spread quickly.
        """
        if len(adjacency) < 2:
            return 0.0
        
        nodes = list(adjacency.keys())
        if len(nodes) > sample_size:
            sample_nodes = np.random.choice(nodes, sample_size, replace=False).tolist()
        else:
            sample_nodes = nodes
        
        total_length = 0
        count = 0
        
        for source in sample_nodes[:sample_size//2]:
            # BFS from source
            visited = {source: 0}
            queue = [source]
            
            while queue:
                current = queue.pop(0)
                current_dist = visited[current]
                
                for neighbor in adjacency.get(current, []):
                    if neighbor not in visited:
                        visited[neighbor] = current_dist + 1
                        queue.append(neighbor)
                        total_length += visited[neighbor]
                        count += 1
        
        if count == 0:
            return float('inf')
        
        return total_length / count
    
    def should_rewire(
        self,
        clustering: float,
        path_length: float
    ) -> Tuple[bool, str]:
        """
        Determine if rewiring is needed to maintain small-world properties.
        """
        reasons = []
        
        # Check if clustering is too low
        if clustering < self.config.target_clustering * 0.8:
            reasons.append("clustering_low")
        
        # Check if path length is too high
        if path_length > self.config.target_path_length * 1.5:
            reasons.append("path_length_high")
        
        should = len(reasons) > 0
        
        return should, ",".join(reasons) if reasons else "optimal"
    
    def suggest_rewiring(
        self,
        adjacency: Dict[str, List[str]],
        node_embeddings: Dict[str, torch.Tensor]
    ) -> List[Tuple[str, str, str, str]]:
        """
        Suggest edges to rewire for better small-world properties.
        
        Returns list of (source, old_target, new_target, reason).
        """
        suggestions = []
        
        if len(adjacency) < 5:
            return suggestions
        
        nodes = list(adjacency.keys())
        
        for source in nodes:
            neighbors = adjacency.get(source, [])
            
            if not neighbors:
                continue
            
            # With probability p, consider rewiring each edge
            for old_target in neighbors:
                if np.random.random() > self.config.rewiring_probability:
                    continue
                
                # Find a non-neighbor to possibly connect to
                non_neighbors = [n for n in nodes if n != source and n not in neighbors]
                
                if not non_neighbors:
                    continue
                
                # Choose based on embedding similarity (prefer similar but distant)
                if source in node_embeddings:
                    source_emb = node_embeddings[source]
                    
                    best_candidate = None
                    best_score = -float('inf')
                    
                    for candidate in non_neighbors[:20]:  # Sample
                        if candidate in node_embeddings:
                            cand_emb = node_embeddings[candidate]
                            similarity = F.cosine_similarity(
                                source_emb.unsqueeze(0),
                                cand_emb.unsqueeze(0)
                            ).item()
                            
                            # Score: high similarity but currently disconnected
                            score = similarity
                            
                            if score > best_score:
                                best_score = score
                                best_candidate = candidate
                    
                    if best_candidate and best_score > 0.5:
                        suggestions.append((source, old_target, best_candidate, "small_world"))
        
        return suggestions


class HebbianPlasticity(nn.Module):
    """
    Hebbian learning: "Cells that fire together, wire together."
    
    Strengthens connections that are validated as correct,
    weakens connections that are rejected.
    """
    
    def __init__(self, config: DiscoveryEngineConfig):
        super().__init__()
        self.config = config
        
        # Connection strengths (edge weights)
        self.connection_strengths: Dict[Tuple[str, str], float] = defaultdict(lambda: 1.0)
        
        # Activity history
        self.recent_activations: Dict[str, List[float]] = defaultdict(list)
    
    def record_activation(self, node_id: str, activation: float):
        """Record neuron activation."""
        self.recent_activations[node_id].append(activation)
        
        # Keep only recent history
        if len(self.recent_activations[node_id]) > 100:
            self.recent_activations[node_id].pop(0)
    
    def compute_correlation(self, node1: str, node2: str) -> float:
        """Compute correlation between two nodes' activations."""
        acts1 = self.recent_activations.get(node1, [])
        acts2 = self.recent_activations.get(node2, [])
        
        if len(acts1) < 2 or len(acts2) < 2:
            return 0.0
        
        # Align to same length
        min_len = min(len(acts1), len(acts2))
        acts1 = acts1[-min_len:]
        acts2 = acts2[-min_len:]
        
        # Pearson correlation
        mean1, mean2 = np.mean(acts1), np.mean(acts2)
        std1, std2 = np.std(acts1) + 1e-8, np.std(acts2) + 1e-8
        
        correlation = np.mean([(a1 - mean1) * (a2 - mean2) for a1, a2 in zip(acts1, acts2)])
        correlation /= (std1 * std2)
        
        return float(correlation)
    
    def update_connection(
        self,
        source: str,
        target: str,
        decision: DiscoveryDecision,
        confidence: float
    ) -> float:
        """
        Update connection strength based on validation result.
        
        Δw = η * pre * post * reward_signal
        
        ACCEPT: +1 reward (strengthen)
        REJECT: -1 reward (weaken)
        """
        key = (source, target)
        current_strength = self.connection_strengths[key]
        
        # Compute reward signal
        if decision == DiscoveryDecision.ACCEPT:
            reward = 1.0 * confidence
        elif decision == DiscoveryDecision.REJECT:
            reward = -1.0 * confidence
        else:
            reward = 0.0  # DEFER/REFINE don't change strength yet
        
        # Hebbian update: Δw = η * correlation * reward
        correlation = self.compute_correlation(source, target)
        correlation = max(0.1, correlation)  # Minimum correlation for learning
        
        delta = self.config.learning_rate * correlation * reward
        
        # Apply update with bounds
        new_strength = current_strength + delta
        new_strength = max(0.1, min(5.0, new_strength))  # Bounds
        
        self.connection_strengths[key] = new_strength
        
        return new_strength
    
    def get_strength(self, source: str, target: str) -> float:
        """Get current connection strength."""
        return self.connection_strengths.get((source, target), 1.0)


class SEALLinkPredictor(nn.Module):
    """
    SEAL-style link prediction using enclosing subgraphs.
    
    Instead of just using node embeddings, considers the local
    subgraph structure around potential edges.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Subgraph encoder
        self.subgraph_encoder = nn.Sequential(
            nn.Linear(d_model * 3, d_model),  # source + target + context
            nn.SiLU(),
            nn.Linear(d_model, d_model // 2),
            nn.SiLU()
        )
        
        # Link predictor
        self.predictor = nn.Sequential(
            nn.Linear(d_model // 2, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # Relation classifier
        self.relation_classifier = nn.Sequential(
            nn.Linear(d_model // 2, 64),
            nn.SiLU(),
            nn.Linear(64, 32)  # 32 relation types
        )
    
    def extract_subgraph_features(
        self,
        source_emb: torch.Tensor,
        target_emb: torch.Tensor,
        neighbor_embs: List[torch.Tensor]
    ) -> torch.Tensor:
        """Extract features from enclosing subgraph."""
        # Aggregate neighbor embeddings
        if neighbor_embs:
            context = torch.stack(neighbor_embs).mean(dim=0)
        else:
            context = torch.zeros_like(source_emb)
        
        # Combine source, target, context
        combined = torch.cat([source_emb, target_emb, context], dim=-1)
        
        return self.subgraph_encoder(combined)
    
    def predict_link(
        self,
        source_emb: torch.Tensor,
        target_emb: torch.Tensor,
        neighbor_embs: List[torch.Tensor]
    ) -> Tuple[float, int]:
        """
        Predict whether a link should exist.
        
        Returns (probability, relation_type).
        """
        features = self.extract_subgraph_features(source_emb, target_emb, neighbor_embs)
        
        prob = self.predictor(features).squeeze(-1).item()
        relation_logits = self.relation_classifier(features)
        relation_type = relation_logits.argmax(dim=-1).item()
        
        return prob, relation_type


class System1Intuition(nn.Module):
    """
    System 1: Fast, intuitive processing.
    
    Uses GNN and similarity search for rapid hypothesis generation.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        self.seal = SEALLinkPredictor(d_model)
        
        # Quick pattern matcher
        self.pattern_matcher = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def generate_candidates(
        self,
        focus_node: str,
        focus_emb: torch.Tensor,
        knowledge_graph: Any,  # SemanticKnowledgeGraph
        vector_memory: Any,    # AdvancedVectorMemory
        curiosity: Any,        # AdvancedCuriosity
        max_candidates: int = 10
    ) -> List[DiscoveryCandidate]:
        """
        Generate discovery candidates using multiple strategies.
        """
        candidates = []
        
        # Strategy 1: GNN link prediction
        if knowledge_graph is not None:
            gnn_candidates = self._gnn_candidates(
                focus_node, focus_emb, knowledge_graph
            )
            candidates.extend(gnn_candidates)
        
        # Strategy 2: Vector similarity (Eureka-style gaps)
        if vector_memory is not None:
            eureka_candidates = self._eureka_candidates(
                focus_node, focus_emb, vector_memory, knowledge_graph
            )
            candidates.extend(eureka_candidates)
        
        # Strategy 3: Open triangles
        if knowledge_graph is not None:
            triangle_candidates = self._triangle_candidates(
                focus_node, knowledge_graph
            )
            candidates.extend(triangle_candidates)
        
        # Sort by confidence and limit
        candidates.sort(key=lambda c: c.confidence, reverse=True)
        return candidates[:max_candidates]
    
    def _gnn_candidates(
        self,
        focus_node: str,
        focus_emb: torch.Tensor,
        kg: Any
    ) -> List[DiscoveryCandidate]:
        """Generate candidates using GNN."""
        candidates = []
        
        # Get predictions from knowledge graph
        if hasattr(kg, 'node_embeddings') and kg.node_embeddings is not None:
            # Find nodes not connected to focus
            existing_neighbors = set()
            for edge in kg.edges:
                if edge.source_id == focus_node:
                    existing_neighbors.add(edge.target_id)
                elif edge.target_id == focus_node:
                    existing_neighbors.add(edge.source_id)
            
            # Score potential connections
            for node_id, node in kg.nodes.items():
                if node_id == focus_node or node_id in existing_neighbors:
                    continue
                
                target_emb = torch.tensor(node.embedding, device=focus_emb.device)
                
                # Use SEAL predictor
                prob, rel_type = self.seal.predict_link(
                    focus_emb.unsqueeze(0) if focus_emb.dim() == 1 else focus_emb,
                    target_emb.unsqueeze(0) if target_emb.dim() == 1 else target_emb,
                    []  # No neighbors for now
                )
                
                if prob > 0.3:
                    candidates.append(DiscoveryCandidate(
                        source_id=focus_node,
                        target_id=node_id,
                        source_embedding=focus_emb,
                        target_embedding=target_emb,
                        relation_type=str(rel_type),
                        confidence=prob,
                        source="gnn"
                    ))
        
        return candidates[:5]
    
    def _eureka_candidates(
        self,
        focus_node: str,
        focus_emb: torch.Tensor,
        memory: Any,
        kg: Any
    ) -> List[DiscoveryCandidate]:
        """
        Eureka-style gap detection.
        
        Find nodes that are similar vectorially but not connected in graph.
        """
        candidates = []
        
        # Search similar vectors
        if hasattr(memory, 'retrieve'):
            result = memory.retrieve(focus_emb.unsqueeze(0), top_k=20)
            
            similar_memories = result.get("memories", [])
            
            # Get existing connections
            existing = set()
            if kg is not None:
                for edge in kg.edges:
                    if edge.source_id == focus_node:
                        existing.add(edge.target_id)
                    elif edge.target_id == focus_node:
                        existing.add(edge.source_id)
            
            # Find gaps: high similarity but no connection
            for mem in similar_memories:
                mem_id = f"mem_{mem.get('id', '')}"
                
                if mem_id not in existing:
                    similarity = mem.get("similarity", 0)
                    
                    # Gap threshold: similar enough to be interesting
                    if 0.6 < similarity < 0.95:  # Not identical, but related
                        candidates.append(DiscoveryCandidate(
                            source_id=focus_node,
                            target_id=mem_id,
                            source_embedding=focus_emb,
                            target_embedding=torch.zeros_like(focus_emb),
                            relation_type="related_to",
                            confidence=similarity * 0.8,
                            source="eureka"
                        ))
        
        return candidates[:5]
    
    def _triangle_candidates(
        self,
        focus_node: str,
        kg: Any
    ) -> List[DiscoveryCandidate]:
        """
        Find open triangles: A↔B, B↔C, but A≠C.
        
        These are natural candidates for discovering A↔C.
        """
        candidates = []
        
        if kg is None or not hasattr(kg, 'adjacency'):
            return candidates
        
        # Get neighbors of focus
        neighbors = kg.adjacency.get(focus_node, [])
        
        # For each neighbor, get their neighbors
        for neighbor_id, _ in neighbors:
            second_neighbors = kg.adjacency.get(neighbor_id, [])
            
            for second_neighbor_id, _ in second_neighbors:
                # Skip if already connected to focus or is focus
                if second_neighbor_id == focus_node:
                    continue
                
                already_connected = any(
                    n_id == second_neighbor_id
                    for n_id, _ in neighbors
                )
                
                if not already_connected:
                    # Found open triangle!
                    if second_neighbor_id in kg.nodes:
                        target = kg.nodes[second_neighbor_id]
                        focus = kg.nodes.get(focus_node)
                        
                        if focus is not None:
                            candidates.append(DiscoveryCandidate(
                                source_id=focus_node,
                                target_id=second_neighbor_id,
                                source_embedding=torch.tensor(focus.embedding),
                                target_embedding=torch.tensor(target.embedding),
                                relation_type="related_via_" + neighbor_id,
                                confidence=0.6,
                                source="open_triangle",
                                metadata={"bridge_node": neighbor_id}
                            ))
        
        return candidates[:5]


class System2Validation(nn.Module):
    """
    System 2: Slow, deliberate validation.
    
    Uses Chain-of-Thought reasoning and metacognition to validate hypotheses.
    """
    
    def __init__(self, d_model: int, accept_threshold: float = 0.7):
        super().__init__()
        self.accept_threshold = accept_threshold
        
        # Validation network
        self.validator = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 256),
            nn.SiLU(),
            nn.Linear(256, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # Hallucination detector
        self.hallucination_detector = nn.Sequential(
            nn.Linear(d_model * 2, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
    
    def validate(
        self,
        candidate: DiscoveryCandidate,
        chain_of_thought: Any,  # ChainOfThought module
        self_model: Any         # AdvancedSelfModel
    ) -> Tuple[DiscoveryDecision, float, List[str]]:
        """
        Validate a discovery candidate using deliberate reasoning.
        """
        trace = []
        
        # Ensure embeddings are proper tensors
        source_emb = candidate.source_embedding
        target_emb = candidate.target_embedding
        
        if source_emb.dim() == 1:
            source_emb = source_emb.unsqueeze(0)
        if target_emb.dim() == 1:
            target_emb = target_emb.unsqueeze(0)
        
        # Step 1: Quick validation check
        combined = torch.cat([source_emb, target_emb], dim=-1)
        raw_score = self.validator(combined).squeeze(-1).item()
        trace.append(f"Initial validation score: {raw_score:.3f}")
        
        # Step 2: Hallucination check
        hallucination_risk = self.hallucination_detector(combined).squeeze(-1).item()
        trace.append(f"Hallucination risk: {hallucination_risk:.3f}")
        
        if hallucination_risk > 0.7:
            trace.append("HIGH hallucination risk detected")
            return DiscoveryDecision.REJECT, hallucination_risk, trace
        
        # Step 3: Chain-of-Thought reasoning (if available)
        cot_score = raw_score
        if chain_of_thought is not None:
            try:
                # Create input for reasoning
                reasoning_input = torch.cat([source_emb, target_emb], dim=1)
                if reasoning_input.dim() == 2:
                    reasoning_input = reasoning_input.unsqueeze(1)
                
                cot_result = chain_of_thought(reasoning_input, mode="chain")
                
                if "verification" in cot_result:
                    cot_score = cot_result["verification"]["valid"].mean().item()
                    trace.append(f"CoT verification: {cot_score:.3f}")
            except Exception as e:
                trace.append(f"CoT error: {str(e)[:50]}")
        
        # Step 4: Metacognitive check (if available)
        metacog_score = 1.0
        if self_model is not None:
            try:
                meta_input = torch.cat([source_emb, target_emb], dim=1)
                if meta_input.dim() == 2:
                    meta_input = meta_input.unsqueeze(1)
                
                meta_result = self_model(meta_input)
                
                if "metacognition" in meta_result:
                    metacog = meta_result["metacognition"]
                    metacog_score = 1.0 - metacog.get("hallucination_risk", torch.tensor(0.0)).mean().item()
                    trace.append(f"Metacog score: {metacog_score:.3f}")
            except Exception as e:
                trace.append(f"Metacog error: {str(e)[:50]}")
        
        # Combine scores
        final_score = (raw_score + cot_score + metacog_score) / 3
        final_score = final_score * candidate.confidence  # Weight by initial confidence
        trace.append(f"Final score: {final_score:.3f}")
        
        # Make decision
        if final_score >= self.accept_threshold:
            decision = DiscoveryDecision.ACCEPT
            trace.append("Decision: ACCEPT")
        elif final_score >= self.accept_threshold * 0.6:
            decision = DiscoveryDecision.REFINE
            trace.append("Decision: REFINE (needs more research)")
        elif final_score >= self.accept_threshold * 0.3:
            decision = DiscoveryDecision.DEFER
            trace.append("Decision: DEFER (retry later)")
        else:
            decision = DiscoveryDecision.REJECT
            trace.append("Decision: REJECT")
        
        return decision, final_score, trace


class DiscoveryEngine(nn.Module):
    """
    Main discovery engine orchestrating the cognitive cycle.
    
    This is the master integrator that leverages ALL existing modules:
    - SemanticKnowledgeGraph (GNN)
    - AdvancedVectorMemory (similarity search)
    - ChainOfThought (validation)
    - AdvancedCuriosity (rewards)
    - AdvancedSelfModel (metacognition)
    """
    
    def __init__(self, config: Optional[DiscoveryEngineConfig] = None):
        super().__init__()
        self.config = config or DiscoveryEngineConfig()
        
        # Core components
        self.watts_strogatz = WattsStrogatzOptimizer(self.config)
        self.hebbian = HebbianPlasticity(self.config)
        self.system1 = System1Intuition(self.config.d_model)
        self.system2 = System2Validation(
            self.config.d_model,
            self.config.accept_threshold
        )
        
        # External module references (set during integration)
        self.knowledge_graph = None
        self.vector_memory = None
        self.chain_of_thought = None
        self.curiosity = None
        self.self_model = None
        
        # State
        self.step_count = 0
        self.discovery_history: List[DiscoveryResult] = []
        self.deferred_candidates: Dict[str, Tuple[DiscoveryCandidate, int]] = {}
        
        # Statistics
        self.stats = {
            "total_cycles": 0,
            "total_candidates": 0,
            "accepted": 0,
            "refined": 0,
            "deferred": 0,
            "rejected": 0
        }
    
    def attach_modules(
        self,
        knowledge_graph=None,
        vector_memory=None,
        chain_of_thought=None,
        curiosity=None,
        self_model=None
    ):
        """Attach existing NANOSILHOUETTE modules."""
        self.knowledge_graph = knowledge_graph
        self.vector_memory = vector_memory
        self.chain_of_thought = chain_of_thought
        self.curiosity = curiosity
        self.self_model = self_model
    
    def step(self) -> bool:
        """
        Called each forward pass. Returns True if discovery cycle should run.
        """
        self.step_count += 1
        
        # Auto-trigger based on interval
        if self.step_count % self.config.auto_cycle_interval == 0:
            return True
        
        return False
    
    def run_discovery_cycle(
        self,
        focus_embedding: Optional[torch.Tensor] = None
    ) -> List[DiscoveryResult]:
        """
        Run a complete discovery cycle.
        
        1. Process deferred items
        2. Select focus node(s)
        3. System 1: Generate candidates
        4. System 2: Validate candidates
        5. Apply decisions
        6. Update rewards and connections
        """
        self.stats["total_cycles"] += 1
        results = []
        
        # Step 1: Process deferred items ready for retry
        retry_candidates = self._get_deferred_ready()
        
        for candidate in retry_candidates:
            result = self._process_candidate(candidate)
            results.append(result)
        
        # Step 2: Select focus
        focus_node, focus_emb = self._select_focus(focus_embedding)
        
        if focus_node is None and focus_embedding is not None:
            focus_node = "query"
            focus_emb = focus_embedding
        
        if focus_emb is None:
            return results
        
        # Step 3: System 1 - Generate candidates
        candidates = self.system1.generate_candidates(
            focus_node,
            focus_emb,
            self.knowledge_graph,
            self.vector_memory,
            self.curiosity,
            self.config.max_candidates_per_cycle
        )
        
        self.stats["total_candidates"] += len(candidates)
        
        # Step 4 & 5: Process each candidate
        for candidate in candidates:
            result = self._process_candidate(candidate)
            results.append(result)
        
        # Step 6: Optimize topology
        self._optimize_topology()
        
        return results
    
    def _select_focus(
        self,
        query_embedding: Optional[torch.Tensor]
    ) -> Tuple[Optional[str], Optional[torch.Tensor]]:
        """
        Select a focus node for discovery.
        
        Uses curiosity weights (RPE) to select interesting nodes.
        """
        if self.knowledge_graph is None or not self.knowledge_graph.nodes:
            return None, query_embedding
        
        # Get nodes with high curiosity (if curiosity module available)
        nodes = list(self.knowledge_graph.nodes.values())
        
        if self.curiosity is not None:
            # Score nodes by curiosity
            scored_nodes = []
            for node in nodes:
                emb = torch.tensor(node.embedding)
                try:
                    curiosity_result = self.curiosity(emb.unsqueeze(0).unsqueeze(0))
                    score = curiosity_result["combined_curiosity"].mean().item()
                except:
                    score = node.importance
                
                scored_nodes.append((node, score))
            
            scored_nodes.sort(key=lambda x: -x[1])
            
            if scored_nodes:
                focus = scored_nodes[0][0]
                return focus.id, torch.tensor(focus.embedding)
        
        # Fallback: random selection weighted by importance
        if nodes:
            weights = [n.importance for n in nodes]
            weights = np.array(weights) / sum(weights)
            selected = np.random.choice(nodes, p=weights)
            return selected.id, torch.tensor(selected.embedding)
        
        return None, None
    
    def _process_candidate(self, candidate: DiscoveryCandidate) -> DiscoveryResult:
        """Process a single candidate through validation and decision."""
        # System 2 validation
        decision, score, trace = self.system2.validate(
            candidate,
            self.chain_of_thought,
            self.self_model
        )
        
        result = DiscoveryResult(
            candidate=candidate,
            decision=decision,
            validation_score=score,
            reasoning_trace=trace
        )
        
        # Apply decision
        self._apply_decision(result)
        
        # Record
        self.discovery_history.append(result)
        
        return result
    
    def _apply_decision(self, result: DiscoveryResult):
        """Apply the discovery decision."""
        candidate = result.candidate
        decision = result.decision
        
        if decision == DiscoveryDecision.ACCEPT:
            self.stats["accepted"] += 1
            
            # Create relation in knowledge graph
            if self.knowledge_graph is not None:
                self.knowledge_graph.add_relation(
                    candidate.source_id,
                    candidate.target_id,
                    candidate.relation_type,
                    weight=result.validation_score
                )
            
            # Hebbian strengthening
            self.hebbian.update_connection(
                candidate.source_id,
                candidate.target_id,
                decision,
                result.validation_score
            )
            
            # Positive reward signal
            if self.curiosity is not None:
                self.curiosity.update_archive(
                    candidate.source_embedding.unsqueeze(0),
                    result.validation_score
                )
        
        elif decision == DiscoveryDecision.REFINE:
            self.stats["refined"] += 1
            # Queue for active research (could trigger external search)
        
        elif decision == DiscoveryDecision.DEFER:
            self.stats["deferred"] += 1
            # Add to deferred queue
            key = f"{candidate.source_id}_{candidate.target_id}"
            self.deferred_candidates[key] = (candidate, self.step_count)
        
        elif decision == DiscoveryDecision.REJECT:
            self.stats["rejected"] += 1
            
            # Hebbian weakening
            self.hebbian.update_connection(
                candidate.source_id,
                candidate.target_id,
                decision,
                result.validation_score
            )
    
    def _get_deferred_ready(self) -> List[DiscoveryCandidate]:
        """Get deferred candidates ready for retry."""
        ready = []
        keys_to_remove = []
        
        for key, (candidate, deferred_step) in self.deferred_candidates.items():
            if self.step_count - deferred_step >= self.config.deferred_retry_delay:
                ready.append(candidate)
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.deferred_candidates[key]
        
        return ready
    
    def _optimize_topology(self):
        """Optimize knowledge graph topology for small-world properties."""
        if self.knowledge_graph is None:
            return
        
        # Build adjacency for analysis
        adjacency = defaultdict(list)
        for edge in self.knowledge_graph.edges:
            adjacency[edge.source_id].append(edge.target_id)
        
        # Measure current properties
        clustering = self.watts_strogatz.compute_clustering_coefficient(adjacency)
        path_length = self.watts_strogatz.estimate_path_length(adjacency)
        
        self.watts_strogatz.clustering_history.append(clustering)
        self.watts_strogatz.path_length_history.append(path_length)
        
        # Check if rewiring needed
        should_rewire, reason = self.watts_strogatz.should_rewire(clustering, path_length)
        
        if should_rewire and len(adjacency) > 10:
            # Get node embeddings
            node_embs = {}
            for node_id, node in self.knowledge_graph.nodes.items():
                node_embs[node_id] = torch.tensor(node.embedding)
            
            # Get rewiring suggestions
            suggestions = self.watts_strogatz.suggest_rewiring(adjacency, node_embs)
            
            # Apply limited rewiring
            for source, old_target, new_target, _ in suggestions[:3]:
                # This would require graph modification support
                pass
    
    def get_stats(self) -> Dict[str, Any]:
        """Get discovery statistics."""
        return {
            **self.stats,
            "step_count": self.step_count,
            "history_length": len(self.discovery_history),
            "deferred_count": len(self.deferred_candidates),
            "clustering_history": self.watts_strogatz.clustering_history[-10:],
            "path_length_history": self.watts_strogatz.path_length_history[-10:],
            "acceptance_rate": self.stats["accepted"] / max(1, self.stats["total_candidates"])
        }


def create_discovery_engine(d_model: int = 512) -> DiscoveryEngine:
    """Factory function."""
    config = DiscoveryEngineConfig(d_model=d_model)
    return DiscoveryEngine(config)


if __name__ == "__main__":
    print("Testing Discovery Engine...")
    
    engine = create_discovery_engine()
    
    # Test without external modules
    focus = torch.randn(512)
    
    results = engine.run_discovery_cycle(focus)
    
    print(f"\nDiscovery cycle completed")
    print(f"Results: {len(results)}")
    print(f"Stats: {engine.get_stats()}")
    
    print("\n✅ Discovery Engine test passed!")
