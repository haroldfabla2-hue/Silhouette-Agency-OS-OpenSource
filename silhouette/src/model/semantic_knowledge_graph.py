"""
NANOSILHOUETTE - Semantic Knowledge Graph
==========================================
State-of-the-art semantic memory with:
- Graph neural network for knowledge representation
- Relation learning and reasoning
- Knowledge extraction from context
- Multi-hop reasoning
- Concept clustering and hierarchy

Based on: Knowledge Graphs, GNNs, Relation Networks, ConceptNet
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Tuple, Set
from dataclasses import dataclass, field
from collections import defaultdict
import numpy as np
import json
from pathlib import Path
import time


@dataclass
class SemanticKGConfig:
    """Configuration for semantic knowledge graph."""
    d_model: int = 512
    d_node: int = 256  # Node embedding dimension
    d_edge: int = 64   # Edge/relation embedding dimension
    num_relation_types: int = 32
    gnn_layers: int = 4
    max_nodes: int = 100000
    attention_heads: int = 8


@dataclass
class KnowledgeNode:
    """A node in the knowledge graph."""
    id: str
    concept: str
    embedding: np.ndarray
    node_type: str = "concept"  # concept, entity, relation, attribute
    created_at: float = field(default_factory=time.time)
    access_count: int = 0
    importance: float = 0.5
    metadata: Dict = field(default_factory=dict)


@dataclass
class KnowledgeEdge:
    """An edge (relation) in the knowledge graph."""
    source_id: str
    target_id: str
    relation_type: str
    weight: float = 1.0
    embedding: Optional[np.ndarray] = None
    metadata: Dict = field(default_factory=dict)


class RelationEmbedding(nn.Module):
    """Learns embeddings for relation types."""
    
    def __init__(self, num_relations: int, d_edge: int):
        super().__init__()
        self.embeddings = nn.Embedding(num_relations, d_edge)
        
        # Relation type names
        self.relation_names = [
            "is_a", "has_a", "part_of", "related_to",
            "causes", "enables", "prevents", "requires",
            "before", "after", "during", "location",
            "property", "attribute", "similar", "opposite",
            "instance_of", "subclass_of", "member_of", "contains",
            "created_by", "used_for", "made_of", "located_in",
            "synonym", "antonym", "hypernym", "hyponym",
            "entails", "contradicts", "supports", "exemplifies"
        ][:num_relations]
        
        self.name_to_idx = {name: i for i, name in enumerate(self.relation_names)}
    
    def forward(self, relation_ids: torch.Tensor) -> torch.Tensor:
        return self.embeddings(relation_ids)
    
    def get_relation_id(self, relation_name: str) -> int:
        return self.name_to_idx.get(relation_name, 0)


class GraphAttentionLayer(nn.Module):
    """
    Graph Attention Network layer.
    
    Aggregates information from neighbors with attention.
    """
    
    def __init__(
        self,
        d_node: int,
        d_edge: int,
        num_heads: int = 8,
        dropout: float = 0.1
    ):
        super().__init__()
        self.num_heads = num_heads
        self.head_dim = d_node // num_heads
        
        # Node transformations
        self.W_node = nn.Linear(d_node, d_node)
        self.W_query = nn.Linear(d_node, d_node)
        self.W_key = nn.Linear(d_node, d_node)
        self.W_value = nn.Linear(d_node, d_node)
        
        # Edge transformation
        self.W_edge = nn.Linear(d_edge, d_node)
        
        # Attention
        self.attention = nn.Sequential(
            nn.Linear(d_node * 3, d_node),
            nn.LeakyReLU(0.2),
            nn.Linear(d_node, num_heads)
        )
        
        self.dropout = nn.Dropout(dropout)
        self.layer_norm = nn.LayerNorm(d_node)
    
    def forward(
        self,
        node_features: torch.Tensor,  # (num_nodes, d_node)
        edge_index: torch.Tensor,      # (2, num_edges)
        edge_features: torch.Tensor    # (num_edges, d_edge)
    ) -> torch.Tensor:
        """
        Perform graph attention.
        """
        num_nodes = node_features.shape[0]
        
        # Transform nodes
        h = self.W_node(node_features)
        query = self.W_query(node_features)
        key = self.W_key(node_features)
        value = self.W_value(node_features)
        
        # Transform edges
        edge_h = self.W_edge(edge_features)
        
        # Compute attention for each edge
        src_nodes = edge_index[0]
        tgt_nodes = edge_index[1]
        
        src_features = query[src_nodes]  # (num_edges, d_node)
        tgt_features = key[tgt_nodes]    # (num_edges, d_node)
        
        # Attention input: source, target, edge
        attn_input = torch.cat([src_features, tgt_features, edge_h], dim=-1)
        attn_scores = self.attention(attn_input)  # (num_edges, num_heads)
        
        # Softmax over neighbors
        attn_scores = F.leaky_relu(attn_scores, 0.2)
        
        # Aggregate with attention
        tgt_values = value[tgt_nodes]  # (num_edges, d_node)
        
        # Weighted aggregation (simplified - in practice use scatter)
        output = torch.zeros_like(node_features)
        attn_weights = F.softmax(attn_scores.mean(dim=-1), dim=0)
        
        for i in range(edge_index.shape[1]):
            src = src_nodes[i]
            output[src] = output[src] + attn_weights[i] * tgt_values[i]
        
        # Residual + norm
        output = self.layer_norm(h + self.dropout(output))
        
        return output


class KnowledgeExtractor(nn.Module):
    """
    Extracts knowledge (nodes and edges) from context.
    """
    
    def __init__(self, d_model: int, d_node: int, d_edge: int, num_relations: int):
        super().__init__()
        
        # Concept extractor
        self.concept_extractor = nn.Sequential(
            nn.Linear(d_model, 512),
            nn.SiLU(),
            nn.Linear(512, d_node)
        )
        
        # Relation extractor
        self.relation_extractor = nn.Sequential(
            nn.Linear(d_model * 2, 256),
            nn.SiLU(),
            nn.Linear(256, num_relations)
        )
        
        # Relation embedding
        self.relation_emb = RelationEmbedding(num_relations, d_edge)
        
        # Confidence scorer
        self.confidence = nn.Sequential(
            nn.Linear(d_node, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
    
    def extract_concepts(
        self,
        hidden: torch.Tensor,
        num_concepts: int = 5
    ) -> List[Tuple[torch.Tensor, float]]:
        """Extract concept embeddings from hidden states."""
        if hidden.dim() == 3:
            # Pool different positions as potential concepts
            concepts = []
            for i in range(min(num_concepts, hidden.shape[1])):
                h = hidden[:, i]
                emb = self.concept_extractor(h)
                conf = self.confidence(emb).squeeze(-1)
                concepts.append((emb, conf.mean().item()))
            return concepts
        else:
            emb = self.concept_extractor(hidden)
            conf = self.confidence(emb).squeeze(-1)
            return [(emb, conf.mean().item())]
    
    def extract_relations(
        self,
        concept1: torch.Tensor,
        concept2: torch.Tensor
    ) -> Tuple[int, float, torch.Tensor]:
        """Extract relation between two concepts."""
        combined = torch.cat([concept1, concept2], dim=-1)
        relation_logits = self.relation_extractor(combined)
        relation_probs = F.softmax(relation_logits, dim=-1)
        
        relation_id = relation_probs.argmax(dim=-1)
        confidence = relation_probs.max(dim=-1)[0]
        
        relation_emb = self.relation_emb(relation_id)
        
        return relation_id.item(), confidence.mean().item(), relation_emb


class MultiHopReasoner(nn.Module):
    """
    Reasons over the knowledge graph with multi-hop attention.
    """
    
    def __init__(self, d_node: int, d_edge: int, max_hops: int = 3):
        super().__init__()
        self.max_hops = max_hops
        
        # Hop selector
        self.hop_controller = nn.GRUCell(d_node, d_node)
        
        # Neighbor scorer
        self.neighbor_scorer = nn.Sequential(
            nn.Linear(d_node * 2 + d_edge, 128),
            nn.SiLU(),
            nn.Linear(128, 1)
        )
        
        # Path aggregator
        self.path_aggregator = nn.Sequential(
            nn.Linear(d_node * max_hops, d_node * 2),
            nn.SiLU(),
            nn.Linear(d_node * 2, d_node)
        )
    
    def reason(
        self,
        query_node: torch.Tensor,
        graph_nodes: torch.Tensor,  # (num_nodes, d_node)
        adjacency: Dict[int, List[Tuple[int, torch.Tensor]]]  # node -> [(neighbor, edge)]
    ) -> Dict[str, Any]:
        """
        Multi-hop reasoning from query node.
        """
        current = query_node
        path_embeddings = [current]
        visited = {0}  # Start node
        attention_history = []
        
        for hop in range(self.max_hops):
            # Score neighbors
            neighbors = []
            scores = []
            
            for node_idx in visited:
                if node_idx in adjacency:
                    for neighbor_idx, edge_emb in adjacency[node_idx]:
                        if neighbor_idx < graph_nodes.shape[0]:
                            neighbor_emb = graph_nodes[neighbor_idx]
                            combined = torch.cat([current, neighbor_emb, edge_emb], dim=-1)
                            score = self.neighbor_scorer(combined)
                            neighbors.append((neighbor_idx, neighbor_emb))
                            scores.append(score)
            
            if not neighbors:
                break
            
            # Select best neighbor
            scores_tensor = torch.cat(scores)
            best_idx = scores_tensor.argmax()
            next_node_idx, next_emb = neighbors[best_idx]
            
            # Update state
            current = self.hop_controller(next_emb.squeeze(0), current.squeeze(0)).unsqueeze(0)
            path_embeddings.append(current)
            visited.add(next_node_idx)
            attention_history.append({
                "hop": hop,
                "node": next_node_idx,
                "score": scores_tensor[best_idx].item()
            })
        
        # Aggregate path
        if len(path_embeddings) < self.max_hops:
            # Pad
            while len(path_embeddings) < self.max_hops:
                path_embeddings.append(torch.zeros_like(path_embeddings[0]))
        
        path_concat = torch.cat(path_embeddings[:self.max_hops], dim=-1)
        aggregated = self.path_aggregator(path_concat)
        
        return {
            "result": aggregated,
            "path_length": len(path_embeddings),
            "visited_nodes": visited,
            "attention_history": attention_history
        }


class SemanticKnowledgeGraph(nn.Module):
    """
    Complete Semantic Knowledge Graph system.
    
    Maintains a graph of concepts and relations,
    enabling semantic reasoning and memory.
    """
    
    def __init__(self, config: Optional[SemanticKGConfig] = None):
        super().__init__()
        self.config = config or SemanticKGConfig()
        
        # Components
        self.relation_embedding = RelationEmbedding(
            self.config.num_relation_types,
            self.config.d_edge
        )
        
        self.gnn_layers = nn.ModuleList([
            GraphAttentionLayer(
                self.config.d_node,
                self.config.d_edge,
                self.config.attention_heads
            )
            for _ in range(self.config.gnn_layers)
        ])
        
        self.extractor = KnowledgeExtractor(
            self.config.d_model,
            self.config.d_node,
            self.config.d_edge,
            self.config.num_relation_types
        )
        
        self.reasoner = MultiHopReasoner(
            self.config.d_node,
            self.config.d_edge
        )
        
        # Node encoder
        self.node_encoder = nn.Sequential(
            nn.Linear(self.config.d_model, self.config.d_node),
            nn.LayerNorm(self.config.d_node)
        )
        
        # Graph storage
        self.nodes: Dict[str, KnowledgeNode] = {}
        self.edges: List[KnowledgeEdge] = []
        self.adjacency: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
        self.node_counter = 0
        
        # Tensor storage for GNN
        self.node_embeddings: Optional[torch.Tensor] = None
        self.edge_index: Optional[torch.Tensor] = None
        self.edge_embeddings: Optional[torch.Tensor] = None
    
    def add_concept(
        self,
        concept: str,
        embedding: torch.Tensor,
        node_type: str = "concept",
        importance: float = 0.5
    ) -> str:
        """Add a concept node to the graph."""
        self.node_counter += 1
        node_id = f"node_{self.node_counter}"
        
        # Encode embedding
        if embedding.dim() > 1:
            embedding = embedding.mean(dim=0)
        
        encoded = self.node_encoder(embedding.unsqueeze(0)).squeeze(0)
        
        node = KnowledgeNode(
            id=node_id,
            concept=concept,
            embedding=encoded.detach().cpu().numpy(),
            node_type=node_type,
            importance=importance
        )
        
        self.nodes[node_id] = node
        self._invalidate_cache()
        
        return node_id
    
    def add_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        weight: float = 1.0
    ) -> bool:
        """Add a relation (edge) between nodes."""
        if source_id not in self.nodes or target_id not in self.nodes:
            return False
        
        relation_id = self.relation_embedding.get_relation_id(relation_type)
        relation_emb = self.relation_embedding(
            torch.tensor([relation_id])
        ).detach().cpu().numpy().squeeze()
        
        edge = KnowledgeEdge(
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            weight=weight,
            embedding=relation_emb
        )
        
        self.edges.append(edge)
        self.adjacency[source_id].append((target_id, relation_type))
        self._invalidate_cache()
        
        return True
    
    def _invalidate_cache(self):
        """Invalidate cached tensors."""
        self.node_embeddings = None
        self.edge_index = None
        self.edge_embeddings = None
    
    def _build_tensors(self, device: torch.device):
        """Build tensors for GNN operations."""
        if self.node_embeddings is not None:
            return
        
        if not self.nodes:
            return
        
        # Node embeddings
        node_list = list(self.nodes.values())
        node_embs = np.stack([n.embedding for n in node_list])
        self.node_embeddings = torch.tensor(node_embs, dtype=torch.float32, device=device)
        
        # Node ID to index mapping
        self.id_to_idx = {n.id: i for i, n in enumerate(node_list)}
        
        # Edge index and embeddings
        if self.edges:
            src_indices = []
            tgt_indices = []
            edge_embs = []
            
            for edge in self.edges:
                if edge.source_id in self.id_to_idx and edge.target_id in self.id_to_idx:
                    src_indices.append(self.id_to_idx[edge.source_id])
                    tgt_indices.append(self.id_to_idx[edge.target_id])
                    edge_embs.append(edge.embedding)
            
            if src_indices:
                self.edge_index = torch.tensor(
                    [src_indices, tgt_indices],
                    dtype=torch.long,
                    device=device
                )
                self.edge_embeddings = torch.tensor(
                    np.stack(edge_embs),
                    dtype=torch.float32,
                    device=device
                )
    
    def forward(
        self,
        query: torch.Tensor,
        device: torch.device = torch.device("cpu")
    ) -> Dict[str, Any]:
        """
        Query the knowledge graph.
        """
        self._build_tensors(device)
        
        if self.node_embeddings is None:
            return {"result": None, "num_nodes": 0, "num_edges": 0}
        
        # Encode query
        query_emb = self.node_encoder(
            query.mean(dim=1) if query.dim() == 3 else query
        )
        
        # Apply GNN layers
        node_features = self.node_embeddings
        
        if self.edge_index is not None and self.edge_embeddings is not None:
            for gnn_layer in self.gnn_layers:
                node_features = gnn_layer(
                    node_features,
                    self.edge_index,
                    self.edge_embeddings
                )
        
        # Find most similar nodes
        similarities = F.cosine_similarity(
            query_emb.unsqueeze(1),
            node_features.unsqueeze(0),
            dim=-1
        )
        
        top_k = min(5, node_features.shape[0])
        top_scores, top_indices = similarities.topk(top_k, dim=-1)
        
        # Get node info
        node_list = list(self.nodes.values())
        retrieved_nodes = []
        for i in range(top_k):
            idx = top_indices[0, i].item()
            if idx < len(node_list):
                node = node_list[idx]
                node.access_count += 1
                retrieved_nodes.append({
                    "id": node.id,
                    "concept": node.concept,
                    "similarity": top_scores[0, i].item(),
                    "importance": node.importance
                })
        
        # Multi-hop reasoning
        reasoning_result = None
        if retrieved_nodes:
            best_node_idx = top_indices[0, 0].item()
            best_node_emb = node_features[best_node_idx].unsqueeze(0)
            
            # Build adjacency for reasoner
            idx_adjacency = {}
            for src_id, neighbors in self.adjacency.items():
                if src_id in self.id_to_idx:
                    src_idx = self.id_to_idx[src_id]
                    idx_adjacency[src_idx] = []
                    for tgt_id, rel_type in neighbors:
                        if tgt_id in self.id_to_idx:
                            tgt_idx = self.id_to_idx[tgt_id]
                            rel_id = self.relation_embedding.get_relation_id(rel_type)
                            rel_emb = self.relation_embedding(
                                torch.tensor([rel_id], device=device)
                            )
                            idx_adjacency[src_idx].append((tgt_idx, rel_emb.squeeze(0)))
            
            reasoning_result = self.reasoner.reason(
                best_node_emb,
                node_features,
                idx_adjacency
            )
        
        return {
            "retrieved_nodes": retrieved_nodes,
            "node_features": node_features,
            "query_embedding": query_emb,
            "reasoning": reasoning_result,
            "num_nodes": len(self.nodes),
            "num_edges": len(self.edges)
        }
    
    def extract_and_store(
        self,
        hidden: torch.Tensor,
        context: str = ""
    ) -> List[str]:
        """Extract knowledge from context and store in graph."""
        # Extract concepts
        concepts = self.extractor.extract_concepts(hidden)
        
        added_nodes = []
        for i, (emb, confidence) in enumerate(concepts):
            if confidence > 0.5:
                node_id = self.add_concept(
                    concept=f"{context}_concept_{i}" if context else f"concept_{i}",
                    embedding=emb.squeeze(0) if emb.dim() > 1 else emb,
                    importance=confidence
                )
                added_nodes.append(node_id)
        
        # Extract relations between consecutive concepts
        for i in range(len(added_nodes) - 1):
            src_node = self.nodes[added_nodes[i]]
            tgt_node = self.nodes[added_nodes[i + 1]]
            
            src_emb = torch.tensor(src_node.embedding, device=hidden.device)
            tgt_emb = torch.tensor(tgt_node.embedding, device=hidden.device)
            
            rel_id, conf, _ = self.extractor.extract_relations(
                src_emb.unsqueeze(0),
                tgt_emb.unsqueeze(0)
            )
            
            if conf > 0.3:
                rel_name = self.relation_embedding.relation_names[rel_id]
                self.add_relation(added_nodes[i], added_nodes[i + 1], rel_name)
        
        return added_nodes
    
    def get_stats(self) -> Dict[str, Any]:
        """Get graph statistics."""
        return {
            "num_nodes": len(self.nodes),
            "num_edges": len(self.edges),
            "num_relation_types": self.config.num_relation_types,
            "avg_degree": len(self.edges) / max(1, len(self.nodes)),
            "type": "Semantic Knowledge Graph with GNN"
        }
    
    def save(self, path: Path):
        """Save knowledge graph."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        # Save nodes
        nodes_data = {}
        for node_id, node in self.nodes.items():
            nodes_data[node_id] = {
                "concept": node.concept,
                "node_type": node.node_type,
                "importance": node.importance,
                "access_count": node.access_count,
                "embedding": node.embedding.tolist()
            }
        
        with open(path / "nodes.json", "w") as f:
            json.dump(nodes_data, f, indent=2)
        
        # Save edges
        edges_data = []
        for edge in self.edges:
            edges_data.append({
                "source": edge.source_id,
                "target": edge.target_id,
                "relation": edge.relation_type,
                "weight": edge.weight
            })
        
        with open(path / "edges.json", "w") as f:
            json.dump(edges_data, f, indent=2)
        
        # Save model
        torch.save(self.state_dict(), path / "kg_model.pt")
    
    def load(self, path: Path):
        """Load knowledge graph."""
        path = Path(path)
        
        if (path / "nodes.json").exists():
            with open(path / "nodes.json") as f:
                nodes_data = json.load(f)
            
            for node_id, data in nodes_data.items():
                node = KnowledgeNode(
                    id=node_id,
                    concept=data["concept"],
                    embedding=np.array(data["embedding"]),
                    node_type=data["node_type"],
                    importance=data["importance"],
                    access_count=data["access_count"]
                )
                self.nodes[node_id] = node
        
        if (path / "edges.json").exists():
            with open(path / "edges.json") as f:
                edges_data = json.load(f)
            
            for data in edges_data:
                self.add_relation(
                    data["source"],
                    data["target"],
                    data["relation"],
                    data["weight"]
                )


def create_semantic_kg(d_model: int = 512) -> SemanticKnowledgeGraph:
    """Factory function."""
    config = SemanticKGConfig(d_model=d_model)
    return SemanticKnowledgeGraph(config)


if __name__ == "__main__":
    print("Testing Semantic Knowledge Graph...")
    
    kg = create_semantic_kg()
    
    # Add concepts
    emb1 = torch.randn(512)
    emb2 = torch.randn(512)
    emb3 = torch.randn(512)
    
    node1 = kg.add_concept("machine_learning", emb1)
    node2 = kg.add_concept("neural_network", emb2)
    node3 = kg.add_concept("deep_learning", emb3)
    
    print(f"Added nodes: {node1}, {node2}, {node3}")
    
    # Add relations
    kg.add_relation(node1, node2, "contains")
    kg.add_relation(node2, node3, "is_a")
    
    print(f"Graph stats: {kg.get_stats()}")
    
    # Query
    query = torch.randn(1, 32, 512)
    result = kg(query)
    
    print(f"\nQuery results:")
    print(f"  Retrieved: {len(result['retrieved_nodes'])} nodes")
    for node in result['retrieved_nodes'][:3]:
        print(f"    - {node['concept']}: {node['similarity']:.3f}")
    
    if result['reasoning']:
        print(f"  Reasoning path: {result['reasoning']['path_length']} hops")
    
    # Extract from context
    context_hidden = torch.randn(1, 10, 512)
    extracted = kg.extract_and_store(context_hidden, "test_context")
    print(f"\nExtracted {len(extracted)} concepts from context")
    
    print(f"\nFinal stats: {kg.get_stats()}")
    
    print("\n✅ Semantic Knowledge Graph test passed!")
