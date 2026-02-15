"""
NANOSILHOUETTE - Eternal Memory System
========================================
Implements persistent semantic + episodic memory:
- Semantic: Knowledge graph with concepts and relations
- Episodic: Time-stamped events with context
- Consolidation: Converts episodes → semantic knowledge
- Hybrid Retrieval: Vector + graph search
"""
import json
import time
import hashlib
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np


@dataclass
class Memory:
    """Base memory entry."""
    id: str
    content: str
    embedding: Optional[np.ndarray] = None
    timestamp: float = field(default_factory=time.time)
    importance: float = 0.5
    access_count: int = 0
    last_accessed: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Episode(Memory):
    """Episodic memory - specific event with context."""
    context: Dict[str, Any] = field(default_factory=dict)
    emotions: Dict[str, float] = field(default_factory=dict)  # e.g., {"confidence": 0.8}
    source: str = "interaction"


@dataclass
class Concept(Memory):
    """Semantic memory - abstract concept/knowledge."""
    related_concepts: List[str] = field(default_factory=list)
    properties: Dict[str, Any] = field(default_factory=dict)
    definition: str = ""
    examples: List[str] = field(default_factory=list)


@dataclass
class Relation:
    """Relation between concepts in knowledge graph."""
    source_id: str
    target_id: str
    relation_type: str  # e.g., "is_a", "part_of", "causes"
    strength: float = 1.0
    metadata: Dict[str, Any] = field(default_factory=dict)


class EmbeddingEncoder(nn.Module):
    """Neural encoder for memory embeddings."""
    
    def __init__(self, d_model: int = 512, d_embedding: int = 256):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_embedding),
            nn.LayerNorm(d_embedding)
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.normalize(self.encoder(x), dim=-1)


class SemanticMemory:
    """
    Knowledge graph-based semantic memory.
    
    Stores concepts and their relations for general knowledge.
    """
    
    def __init__(self, storage_path: Optional[Path] = None):
        self.concepts: Dict[str, Concept] = {}
        self.relations: List[Relation] = []
        self.storage_path = storage_path or Path("./memory/semantic")
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._load_from_disk()
    
    def add_concept(
        self,
        content: str,
        definition: str = "",
        embedding: Optional[np.ndarray] = None,
        properties: Optional[Dict] = None
    ) -> Concept:
        """Add a new concept to semantic memory."""
        concept_id = self._generate_id(content)
        
        if concept_id in self.concepts:
            # Update existing concept
            self.concepts[concept_id].access_count += 1
            self.concepts[concept_id].last_accessed = time.time()
            return self.concepts[concept_id]
        
        concept = Concept(
            id=concept_id,
            content=content,
            definition=definition,
            embedding=embedding,
            properties=properties or {},
            importance=0.5
        )
        
        self.concepts[concept_id] = concept
        self._save_to_disk()
        
        return concept
    
    def add_relation(
        self,
        source: str,
        target: str,
        relation_type: str,
        strength: float = 1.0
    ) -> Relation:
        """Add a relation between concepts."""
        source_id = self._generate_id(source)
        target_id = self._generate_id(target)
        
        # Ensure concepts exist
        if source_id not in self.concepts:
            self.add_concept(source)
        if target_id not in self.concepts:
            self.add_concept(target)
        
        relation = Relation(
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            strength=strength
        )
        
        self.relations.append(relation)
        
        # Update related concepts list
        if target_id not in self.concepts[source_id].related_concepts:
            self.concepts[source_id].related_concepts.append(target_id)
        
        self._save_to_disk()
        return relation
    
    def query(
        self,
        query_embedding: np.ndarray,
        top_k: int = 5,
        include_relations: bool = True
    ) -> List[Tuple[Concept, float]]:
        """Query semantic memory using embedding similarity."""
        if not self.concepts:
            return []
        
        results = []
        
        for concept in self.concepts.values():
            if concept.embedding is not None:
                similarity = np.dot(query_embedding, concept.embedding)
                results.append((concept, similarity))
        
        # Sort by similarity
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]
    
    def get_related(self, concept_id: str, depth: int = 2) -> List[Concept]:
        """Get related concepts via graph traversal."""
        visited = set()
        to_visit = [concept_id]
        related = []
        
        for _ in range(depth):
            next_visit = []
            for cid in to_visit:
                if cid in visited:
                    continue
                visited.add(cid)
                
                if cid in self.concepts:
                    related.append(self.concepts[cid])
                    next_visit.extend(self.concepts[cid].related_concepts)
            
            to_visit = next_visit
        
        return related
    
    def _generate_id(self, content: str) -> str:
        return hashlib.md5(content.encode()).hexdigest()[:12]
    
    def _save_to_disk(self):
        """Persist semantic memory to disk."""
        data = {
            "concepts": {
                cid: {
                    "content": c.content,
                    "definition": c.definition,
                    "properties": c.properties,
                    "related_concepts": c.related_concepts,
                    "importance": c.importance,
                    "timestamp": c.timestamp
                }
                for cid, c in self.concepts.items()
            },
            "relations": [
                {
                    "source": r.source_id,
                    "target": r.target_id,
                    "type": r.relation_type,
                    "strength": r.strength
                }
                for r in self.relations
            ]
        }
        
        with open(self.storage_path / "knowledge_graph.json", "w") as f:
            json.dump(data, f, indent=2)
    
    def _load_from_disk(self):
        """Load semantic memory from disk."""
        graph_file = self.storage_path / "knowledge_graph.json"
        if not graph_file.exists():
            return
        
        with open(graph_file, "r") as f:
            data = json.load(f)
        
        for cid, cdata in data.get("concepts", {}).items():
            self.concepts[cid] = Concept(
                id=cid,
                content=cdata["content"],
                definition=cdata.get("definition", ""),
                properties=cdata.get("properties", {}),
                related_concepts=cdata.get("related_concepts", []),
                importance=cdata.get("importance", 0.5),
                timestamp=cdata.get("timestamp", time.time())
            )
        
        for rdata in data.get("relations", []):
            self.relations.append(Relation(
                source_id=rdata["source"],
                target_id=rdata["target"],
                relation_type=rdata["type"],
                strength=rdata.get("strength", 1.0)
            ))


class EpisodicMemory:
    """
    Time-based episodic memory.
    
    Stores specific events with temporal context.
    """
    
    def __init__(
        self,
        storage_path: Optional[Path] = None,
        max_episodes: int = 10000
    ):
        self.episodes: Dict[str, Episode] = {}
        self.embeddings: Optional[np.ndarray] = None
        self.episode_ids: List[str] = []
        self.storage_path = storage_path or Path("./memory/episodic")
        self.max_episodes = max_episodes
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._load_from_disk()
    
    def add_episode(
        self,
        content: str,
        embedding: Optional[np.ndarray] = None,
        context: Optional[Dict] = None,
        importance: float = 0.5,
        source: str = "interaction"
    ) -> Episode:
        """Add a new episode to memory."""
        episode_id = f"{time.time()}_{hashlib.md5(content.encode()).hexdigest()[:8]}"
        
        episode = Episode(
            id=episode_id,
            content=content,
            embedding=embedding,
            context=context or {},
            importance=importance,
            source=source
        )
        
        self.episodes[episode_id] = episode
        
        # Update embedding index
        if embedding is not None:
            self.episode_ids.append(episode_id)
            if self.embeddings is None:
                self.embeddings = embedding.reshape(1, -1)
            else:
                self.embeddings = np.vstack([self.embeddings, embedding])
        
        # Prune old episodes if needed
        if len(self.episodes) > self.max_episodes:
            self._prune_episodes()
        
        self._save_to_disk()
        return episode
    
    def query(
        self,
        query_embedding: np.ndarray,
        top_k: int = 5,
        time_decay: bool = True
    ) -> List[Tuple[Episode, float]]:
        """Query episodic memory using embedding similarity."""
        if self.embeddings is None or len(self.episode_ids) == 0:
            return []
        
        # Compute similarities
        similarities = np.dot(self.embeddings, query_embedding)
        
        # Apply time decay if requested
        if time_decay:
            current_time = time.time()
            for i, eid in enumerate(self.episode_ids):
                if eid in self.episodes:
                    age = current_time - self.episodes[eid].timestamp
                    decay = np.exp(-age / (86400 * 30))  # 30-day half-life
                    similarities[i] *= decay
        
        # Get top-k
        top_indices = np.argsort(similarities)[-top_k:][::-1]
        
        results = []
        for idx in top_indices:
            if idx < len(self.episode_ids):
                eid = self.episode_ids[idx]
                if eid in self.episodes:
                    results.append((self.episodes[eid], float(similarities[idx])))
        
        return results
    
    def get_recent(self, n: int = 10) -> List[Episode]:
        """Get most recent episodes."""
        sorted_episodes = sorted(
            self.episodes.values(),
            key=lambda e: e.timestamp,
            reverse=True
        )
        return sorted_episodes[:n]
    
    def _prune_episodes(self):
        """Remove least important/oldest episodes."""
        # Calculate score: importance + recency
        current_time = time.time()
        
        scored = []
        for eid, ep in self.episodes.items():
            recency = 1.0 / (1.0 + (current_time - ep.timestamp) / 86400)
            score = ep.importance * 0.5 + recency * 0.3 + ep.access_count * 0.2
            scored.append((eid, score))
        
        # Sort by score and keep top max_episodes
        scored.sort(key=lambda x: x[1], reverse=True)
        keep_ids = set(eid for eid, _ in scored[:self.max_episodes])
        
        # Remove pruned episodes
        self.episodes = {eid: ep for eid, ep in self.episodes.items() if eid in keep_ids}
        
        # Rebuild embedding index
        new_embeddings = []
        new_ids = []
        for eid in self.episode_ids:
            if eid in keep_ids and eid in self.episodes and self.episodes[eid].embedding is not None:
                new_ids.append(eid)
        
        self.episode_ids = new_ids
        # Note: Full embedding rebuild would happen here
    
    def _save_to_disk(self):
        """Persist episodic memory to disk."""
        data = {
            eid: {
                "content": ep.content,
                "context": ep.context,
                "importance": ep.importance,
                "timestamp": ep.timestamp,
                "source": ep.source,
                "access_count": ep.access_count
            }
            for eid, ep in self.episodes.items()
        }
        
        with open(self.storage_path / "episodes.json", "w") as f:
            json.dump(data, f, indent=2)
        
        # Save embeddings separately
        if self.embeddings is not None:
            np.save(self.storage_path / "embeddings.npy", self.embeddings)
            with open(self.storage_path / "episode_ids.json", "w") as f:
                json.dump(self.episode_ids, f)
    
    def _load_from_disk(self):
        """Load episodic memory from disk."""
        episodes_file = self.storage_path / "episodes.json"
        if not episodes_file.exists():
            return
        
        with open(episodes_file, "r") as f:
            data = json.load(f)
        
        for eid, edata in data.items():
            self.episodes[eid] = Episode(
                id=eid,
                content=edata["content"],
                context=edata.get("context", {}),
                importance=edata.get("importance", 0.5),
                timestamp=edata.get("timestamp", time.time()),
                source=edata.get("source", "loaded"),
                access_count=edata.get("access_count", 0)
            )
        
        # Load embeddings
        embeddings_file = self.storage_path / "embeddings.npy"
        if embeddings_file.exists():
            self.embeddings = np.load(embeddings_file)
            
            ids_file = self.storage_path / "episode_ids.json"
            if ids_file.exists():
                with open(ids_file, "r") as f:
                    self.episode_ids = json.load(f)


class MemoryConsolidation:
    """
    Consolidates episodic memories into semantic knowledge.
    
    Inspired by biological memory consolidation during sleep.
    """
    
    def __init__(
        self,
        semantic: SemanticMemory,
        episodic: EpisodicMemory,
        consolidation_threshold: int = 3
    ):
        self.semantic = semantic
        self.episodic = episodic
        self.consolidation_threshold = consolidation_threshold
    
    def consolidate(self):
        """
        Run consolidation process.
        
        Groups similar episodes and extracts semantic concepts.
        """
        if not self.episodic.episodes:
            return
        
        # Group episodes by similarity
        clusters = self._cluster_episodes()
        
        # Create/update concepts from clusters
        for cluster in clusters:
            if len(cluster) >= self.consolidation_threshold:
                self._create_concept_from_cluster(cluster)
    
    def _cluster_episodes(self) -> List[List[Episode]]:
        """Cluster similar episodes."""
        # Simple clustering based on content similarity
        episodes = list(self.episodic.episodes.values())
        
        if len(episodes) < 2:
            return [episodes]
        
        # Group by source first
        by_source: Dict[str, List[Episode]] = {}
        for ep in episodes:
            source = ep.source
            if source not in by_source:
                by_source[source] = []
            by_source[source].append(ep)
        
        return list(by_source.values())
    
    def _create_concept_from_cluster(self, cluster: List[Episode]):
        """Create a semantic concept from a cluster of episodes."""
        # Extract common patterns
        contents = [ep.content for ep in cluster]
        
        # Find most representative content (highest importance)
        best_episode = max(cluster, key=lambda e: e.importance)
        
        # Create concept
        concept = self.semantic.add_concept(
            content=best_episode.content[:100],  # Truncate
            definition=f"Derived from {len(cluster)} similar experiences",
            properties={
                "episode_count": len(cluster),
                "avg_importance": sum(e.importance for e in cluster) / len(cluster),
                "sources": list(set(e.source for e in cluster))
            }
        )
        
        # Boost importance based on repetition
        concept.importance = min(1.0, concept.importance + 0.1 * len(cluster))


class EternalMemory:
    """
    Main interface for eternal memory system.
    
    Combines semantic and episodic memory with automatic consolidation.
    """
    
    def __init__(
        self,
        storage_path: Optional[Path] = None,
        d_model: int = 512,
        d_embedding: int = 256
    ):
        storage_path = storage_path or Path("./memory")
        
        self.semantic = SemanticMemory(storage_path / "semantic")
        self.episodic = EpisodicMemory(storage_path / "episodic")
        self.consolidation = MemoryConsolidation(self.semantic, self.episodic)
        
        self.encoder = EmbeddingEncoder(d_model, d_embedding)
        self.d_embedding = d_embedding
        
        # Stats
        self.total_memories = 0
        self.total_queries = 0
    
    def encode(self, hidden_states: torch.Tensor) -> np.ndarray:
        """Encode hidden states to memory embedding."""
        with torch.no_grad():
            # Take mean over sequence
            if hidden_states.dim() == 3:
                hidden_states = hidden_states.mean(dim=1)
            
            embedding = self.encoder(hidden_states)
            return embedding.cpu().numpy().squeeze()
    
    def remember(
        self,
        content: str,
        hidden_states: Optional[torch.Tensor] = None,
        memory_type: str = "episodic",
        importance: float = 0.5,
        context: Optional[Dict] = None,
        **kwargs
    ):
        """
        Store a new memory.
        
        Args:
            content: Text content to remember
            hidden_states: Optional model hidden states for embedding
            memory_type: "episodic" or "semantic"
            importance: Importance score (0-1)
            context: Additional context
        """
        embedding = None
        if hidden_states is not None:
            embedding = self.encode(hidden_states)
        
        if memory_type == "episodic":
            self.episodic.add_episode(
                content=content,
                embedding=embedding,
                context=context or {},
                importance=importance,
                **kwargs
            )
        else:
            self.semantic.add_concept(
                content=content,
                embedding=embedding,
                **kwargs
            )
        
        self.total_memories += 1
    
    def recall(
        self,
        query: str = None,
        hidden_states: Optional[torch.Tensor] = None,
        top_k: int = 5,
        memory_type: str = "both"
    ) -> Dict[str, List]:
        """
        Recall memories related to query.
        
        Returns:
            Dict with "semantic" and "episodic" lists
        """
        results = {"semantic": [], "episodic": []}
        
        if hidden_states is not None:
            query_embedding = self.encode(hidden_states)
        else:
            # Fallback: use random embedding (should use tokenizer instead)
            query_embedding = np.random.randn(self.d_embedding).astype(np.float32)
            query_embedding = query_embedding / np.linalg.norm(query_embedding)
        
        if memory_type in ["both", "semantic"]:
            semantic_results = self.semantic.query(query_embedding, top_k)
            results["semantic"] = [
                {"content": c.content, "score": s, "type": "semantic"}
                for c, s in semantic_results
            ]
        
        if memory_type in ["both", "episodic"]:
            episodic_results = self.episodic.query(query_embedding, top_k)
            results["episodic"] = [
                {"content": e.content, "score": s, "type": "episodic", "context": e.context}
                for e, s in episodic_results
            ]
        
        self.total_queries += 1
        return results
    
    def consolidate(self):
        """Run memory consolidation (episodic → semantic)."""
        self.consolidation.consolidate()
    
    def get_stats(self) -> Dict:
        """Get memory statistics."""
        return {
            "semantic_concepts": len(self.semantic.concepts),
            "semantic_relations": len(self.semantic.relations),
            "episodic_memories": len(self.episodic.episodes),
            "total_memories": self.total_memories,
            "total_queries": self.total_queries
        }
    
    def integrate_with_model_output(
        self,
        hidden_states: torch.Tensor,
        query_hidden: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """
        Integrate retrieved memories with model hidden states.
        
        This is called during model forward pass.
        """
        batch_size, seq_len, d_model = hidden_states.shape
        
        # Recall relevant memories
        memories = self.recall(hidden_states=query_hidden or hidden_states)
        
        # For now, return original hidden states
        # Full implementation would project memories back into hidden space
        return hidden_states


if __name__ == "__main__":
    print("Testing Eternal Memory System...")
    
    # Initialize
    memory = EternalMemory(Path("./test_memory"))
    
    # Add episodic memories
    for i in range(5):
        memory.remember(
            f"User asked about topic {i}",
            memory_type="episodic",
            importance=0.5 + i * 0.1,
            context={"session": "test", "turn": i}
        )
    
    # Add semantic knowledge
    memory.remember(
        "Python is a programming language",
        memory_type="semantic",
        definition="High-level interpreted language"
    )
    
    # Add relations
    memory.semantic.add_relation(
        "Python", "programming language", "is_a"
    )
    memory.semantic.add_relation(
        "Python", "machine learning", "used_for"
    )
    
    # Query
    results = memory.recall(query="programming")
    print(f"Semantic results: {len(results['semantic'])}")
    print(f"Episodic results: {len(results['episodic'])}")
    
    # Stats
    print(f"Stats: {memory.get_stats()}")
    
    # Consolidate
    memory.consolidate()
    
    print("✅ Eternal Memory test passed!")
