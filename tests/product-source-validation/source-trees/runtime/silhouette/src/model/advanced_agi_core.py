"""
NANOSILHOUETTE - Advanced AGI Core
====================================
Master integrator for ALL state-of-the-art AGI components:
- Advanced World Model (Dreamer-v3 RSSM)
- Advanced Self Model (Conformal + Bayesian)
- Advanced Curiosity (RND + Go-Explore + Empowerment)
- Advanced Goal System (Options + HRL + HER)
- Chain of Thought (ToT + Self-Consistency)
- Semantic Knowledge Graph (GNN + Multi-hop)
- Advanced Memory (HNSW + Attention)

This is the unified "mind" bringing everything together.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from pathlib import Path
import json
import time

# Import all advanced components
from .advanced_world_model import AdvancedWorldModel, create_advanced_world_model
from .advanced_self_model import AdvancedSelfModel, create_advanced_self_model
from .advanced_curiosity import AdvancedCuriosity, create_advanced_curiosity
from .advanced_goal_system import AdvancedGoalSystem, create_advanced_goal_system
from .chain_of_thought import ChainOfThought, create_chain_of_thought
from .semantic_knowledge_graph import SemanticKnowledgeGraph, create_semantic_kg
from .advanced_memory import AdvancedVectorMemory, create_advanced_memory

# Import Discovery System
from .discovery_engine import DiscoveryEngine, create_discovery_engine
from .discovery_journal import DiscoveryJournal, create_discovery_journal
from .synthesis_service import SynthesisService, create_synthesis_service
from .eureka_module import EurekaModule, create_eureka_module

# Import Capability System (Autonomous Tooling)
from .capability_system import CapabilitySystem, create_capability_system


@dataclass
class AdvancedAGIConfig:
    """Configuration for Advanced AGI Core."""
    d_model: int = 512
    
    # Component toggles
    enable_world_model: bool = True
    enable_self_model: bool = True
    enable_curiosity: bool = True
    enable_goals: bool = True
    enable_reasoning: bool = True
    enable_knowledge: bool = True
    enable_memory: bool = True
    enable_discovery: bool = True
    enable_capabilities: bool = True  # Tooling & Autonomy
    
    # Integration
    integration_heads: int = 8
    consciousness_threshold: float = 0.7
    
    # Reasoning
    default_reasoning_mode: str = "chain"  # chain, tree, consistent
    max_reasoning_steps: int = 10
    
    # Memory
    memory_path: str = "./agi_state"


class CognitiveIntegrator(nn.Module):
    """
    Integrates all cognitive subsystems into unified processing.
    """
    
    def __init__(self, d_model: int, num_systems: int = 7, num_heads: int = 8):
        super().__init__()
        self.num_systems = num_systems
        
        # System-specific encoders
        self.system_encoders = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_model, d_model),
                nn.LayerNorm(d_model),
                nn.SiLU()
            )
            for _ in range(num_systems)
        ])
        
        # Cross-system attention
        self.cross_attention = nn.MultiheadAttention(
            d_model, num_heads, batch_first=True
        )
        
        # Integration MLP
        self.integrator = nn.Sequential(
            nn.Linear(d_model * num_systems, d_model * 2),
            nn.SiLU(),
            nn.Linear(d_model * 2, d_model),
            nn.LayerNorm(d_model)
        )
        
        # Global workspace (consciousness)
        self.workspace = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.SiLU(),
            nn.Linear(d_model, d_model)
        )
        
        # System names for interpretability
        self.system_names = [
            "world", "self", "curiosity", "goals",
            "reasoning", "knowledge", "memory", "discovery",
            "capabilities"
        ]
    
    def forward(
        self,
        system_outputs: List[torch.Tensor]
    ) -> Dict[str, torch.Tensor]:
        """
        Integrate outputs from all cognitive systems.
        """
        # Ensure we have outputs from all systems
        while len(system_outputs) < self.num_systems:
            system_outputs.append(torch.zeros_like(system_outputs[0]))
        
        # Encode each system
        encoded = []
        d_model = self.system_encoders[0][0].in_features  # Get expected input size
        for i, (output, encoder) in enumerate(zip(system_outputs, self.system_encoders)):
            if output is not None and output.numel() > 0:
                # Normalize shape: ensure 2D [batch, features]
                if output.dim() == 3:
                    output = output.mean(dim=1)  # Pool sequence dimension
                elif output.dim() == 1:
                    output = output.unsqueeze(0)  # Add batch dimension
                
                # Normalize feature dimension to expected d_model
                if output.shape[-1] != d_model:
                    if output.shape[-1] < d_model:
                        output = F.pad(output, (0, d_model - output.shape[-1]))
                    else:
                        output = output[:, :d_model]
                
                enc = encoder(output)
            else:
                enc = torch.zeros_like(system_outputs[0])
            encoded.append(enc)
        
        # Stack for attention
        batch_size = encoded[0].shape[0]
        stacked = torch.stack(encoded, dim=1)  # (batch, num_systems, d_model)
        
        # Cross-system attention
        attended, attention_weights = self.cross_attention(
            stacked, stacked, stacked
        )
        
        # Flatten and integrate
        flat = attended.view(batch_size, -1)
        integrated = self.integrator(flat)
        
        # Global workspace
        workspace = self.workspace(integrated)
        
        # System contributions
        contributions = {}
        for i, name in enumerate(self.system_names):
            contributions[name] = attention_weights[:, :, i].mean(dim=1)
        
        return {
            "integrated": integrated,
            "workspace": workspace,
            "attention_weights": attention_weights,
            "system_contributions": contributions
        }


class ConsciousnessMonitor(nn.Module):
    """
    Monitors the "consciousness" state of the AGI system.
    
    This is metaphorical - tracking integration and coherence
    of cognitive processes, not claiming actual consciousness.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Integration level
        self.integration_scorer = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Coherence
        self.coherence_scorer = nn.Sequential(
            nn.Linear(d_model * 2, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
        
        # Awareness level
        self.awareness_scorer = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # State history
        self.state_history: List[Dict] = []
    
    def forward(
        self,
        workspace: torch.Tensor,
        prev_workspace: Optional[torch.Tensor] = None
    ) -> Dict[str, Any]:
        """Compute consciousness metrics."""
        integration = self.integration_scorer(workspace).squeeze(-1)
        awareness = self.awareness_scorer(workspace).squeeze(-1)
        
        coherence = torch.ones_like(integration)
        if prev_workspace is not None:
            combined = torch.cat([workspace, prev_workspace], dim=-1)
            coherence = self.coherence_scorer(combined).squeeze(-1)
        
        # Overall "consciousness" level
        consciousness = (integration + coherence + awareness) / 3
        
        state = {
            "integration": integration.mean().item(),
            "coherence": coherence.mean().item(),
            "awareness": awareness.mean().item(),
            "consciousness": consciousness.mean().item(),
            "timestamp": time.time()
        }
        self.state_history.append(state)
        
        # Keep only last 100
        if len(self.state_history) > 100:
            self.state_history.pop(0)
        
        return state


class AdvancedAGICore(nn.Module):
    """
    Advanced AGI Core - Complete integration of all systems.
    
    This module represents the culmination of all AGI components:
    1. World Model - Understanding and predicting the environment
    2. Self Model - Self-awareness and meta-cognition
    3. Curiosity - Intrinsic motivation for learning
    4. Goal System - Autonomous goal-setting and planning
    5. Chain of Thought - Explicit reasoning
    6. Knowledge Graph - Semantic understanding
    7. Memory - Long-term storage and retrieval
    
    Together, these form a unified cognitive architecture.
    """
    
    def __init__(self, config: Optional[AdvancedAGIConfig] = None):
        super().__init__()
        self.config = config or AdvancedAGIConfig()
        d = self.config.d_model
        
        # Initialize all components
        self.world_model = create_advanced_world_model(d) if self.config.enable_world_model else None
        self.self_model = create_advanced_self_model(d) if self.config.enable_self_model else None
        self.curiosity = create_advanced_curiosity(d) if self.config.enable_curiosity else None
        self.goals = create_advanced_goal_system(d) if self.config.enable_goals else None
        self.reasoning = create_chain_of_thought(d) if self.config.enable_reasoning else None
        self.knowledge = create_semantic_kg(d) if self.config.enable_knowledge else None
        self.memory = create_advanced_memory() if self.config.enable_memory else None
        self.capabilities = create_capability_system(d) if self.config.enable_capabilities else None
        
        # Discovery System (Neurocognitive Discovery)
        self.discovery = create_discovery_engine(d) if self.config.enable_discovery else None
        self.eureka = create_eureka_module(d) if self.config.enable_discovery else None
        self.synthesis = create_synthesis_service(d) if self.config.enable_discovery else None
        self.journal = create_discovery_journal() if self.config.enable_discovery else None
        
        # Attach modules to discovery engine
        if self.discovery is not None:
            self.discovery.attach_modules(
                knowledge_graph=self.knowledge,
                vector_memory=self.memory,
                chain_of_thought=self.reasoning,
                curiosity=self.curiosity,
                self_model=self.self_model
            )
        
        if self.eureka is not None:
            self.eureka.attach_modules(
                vector_memory=self.memory,
                knowledge_graph=self.knowledge
            )
        
        if self.synthesis is not None:
            self.synthesis.attach_modules(
                chain_of_thought=self.reasoning,
                knowledge_graph=self.knowledge,
                vector_memory=self.memory,
                discovery_journal=self.journal
            )
        
        # Integration (9 systems now: +capabilities)
        self.integrator = CognitiveIntegrator(d, num_systems=9, num_heads=self.config.integration_heads)
        self.consciousness = ConsciousnessMonitor(d)
        
        # Decision making
        self.decision_maker = nn.Sequential(
            nn.Linear(d, 256),
            nn.SiLU(),
            nn.Linear(256, 64),
            nn.SiLU(),
            nn.Linear(64, 6)  # [act, explore, learn, reason, remember, wait]
        )
        
        # Action encoder
        self.action_encoder = nn.Sequential(
            nn.Linear(d, d),
            nn.LayerNorm(d),
            nn.SiLU()
        )
        
        # State tracking
        self.step_count = 0
        self.prev_workspace = None
        self.agi_state = {
            "consciousness_level": 0.0,
            "active_components": 0,
            "last_decision": None
        }
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        actions: Optional[torch.Tensor] = None,
        reasoning_mode: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Complete AGI processing cycle.
        """
        self.step_count += 1
        device = hidden_states.device
        
        # Pool if needed
        if hidden_states.dim() == 3:
            pooled = hidden_states.mean(dim=1)
        else:
            pooled = hidden_states
        
        batch_size = pooled.shape[0]
        d = self.config.d_model
        
        result = {
            "step": self.step_count,
            "components": {}
        }
        
        # Collect outputs from all systems
        system_outputs = []
        
        # 1. World Model
        world_output = torch.zeros(batch_size, d, device=device)
        if self.world_model is not None:
            if actions is not None:
                obs_result = self.world_model.observe(
                    hidden_states if hidden_states.dim() == 3 else hidden_states.unsqueeze(1),
                    actions if actions.dim() == 3 else actions.unsqueeze(1)
                )
                world_output = obs_result["features"][:, -1]
                result["components"]["world"] = {
                    "active": True,
                    "features_shape": obs_result["features"].shape
                }
            else:
                result["components"]["world"] = {"active": False}
        system_outputs.append(world_output)
        
        # 2. Self Model
        self_output = torch.zeros(batch_size, d, device=device)
        if self.self_model is not None:
            self_result = self.self_model(hidden_states, use_mc_dropout=True)
            # Pad/truncate integrated_state to d_model
            integrated = self_result["integrated_state"]
            if integrated.shape[-1] < d:
                self_output = F.pad(integrated, (0, d - integrated.shape[-1]))
            else:
                self_output = integrated[:, :d]
            
            result["components"]["self"] = {
                "active": True,
                "awareness_score": self_result["awareness_score"].mean().item(),
                "should_respond": self_result["should_respond"]
            }
        system_outputs.append(self_output)
        
        # 3. Curiosity
        curiosity_output = torch.zeros(batch_size, d, device=device)
        if self.curiosity is not None:
            curiosity_result = self.curiosity(hidden_states)
            # Use encoded representation
            enc = self.curiosity.encoder(pooled)
            if enc.shape[-1] < d:
                curiosity_output = F.pad(enc, (0, d - enc.shape[-1]))
            else:
                curiosity_output = enc[:, :d]
            
            result["components"]["curiosity"] = {
                "active": True,
                "combined_curiosity": curiosity_result["combined_curiosity"].mean().item(),
                "should_explore": curiosity_result["should_explore"].tolist()
            }
        system_outputs.append(curiosity_output)
        
        # 4. Goals
        goals_output = torch.zeros(batch_size, d, device=device)
        if self.goals is not None:
            goal_result = self.goals(hidden_states, generate_new=(self.step_count % 50 == 0))
            # Use state encoding
            enc = self.goals.state_encoder(pooled)
            if enc.shape[-1] < d:
                goals_output = F.pad(enc, (0, d - enc.shape[-1]))
            else:
                goals_output = enc[:, :d]
            
            result["components"]["goals"] = {
                "active": True,
                "status": self.goals.get_status()
            }
        system_outputs.append(goals_output)
        
        # 5. Reasoning (Chain of Thought)
        reasoning_output = torch.zeros(batch_size, d, device=device)
        if self.reasoning is not None:
            mode = reasoning_mode or self.config.default_reasoning_mode
            reasoning_result = self.reasoning(hidden_states, mode=mode)
            enc = reasoning_result["output"]
            # Ensure 2D: pool sequence if 3D
            if enc.dim() == 3:
                enc = enc.mean(dim=1)
            # Ensure correct size d
            if enc.shape[-1] < d:
                reasoning_output = F.pad(enc, (0, d - enc.shape[-1]))
            else:
                reasoning_output = enc[:, :d]
            
            result["components"]["reasoning"] = {
                "active": True,
                "mode": mode,
                "num_steps": reasoning_result.get("num_steps", 0),
                "verification": reasoning_result["verification"]["valid"].mean().item()
            }
        system_outputs.append(reasoning_output)
        
        # 6. Knowledge Graph
        knowledge_output = torch.zeros(batch_size, d, device=device)
        if self.knowledge is not None:
            kg_result = self.knowledge(hidden_states, device=device)
            if kg_result.get("query_embedding") is not None:
                enc = kg_result["query_embedding"]
                if enc.shape[-1] < d:
                    knowledge_output = F.pad(enc, (0, d - enc.shape[-1]))
                else:
                    knowledge_output = enc[:, :d]
            
            result["components"]["knowledge"] = {
                "active": True,
                "num_nodes": kg_result["num_nodes"],
                "num_edges": kg_result["num_edges"],
                "retrieved": len(kg_result.get("retrieved_nodes", []))
            }
        system_outputs.append(knowledge_output)
        
        # 7. Memory
        memory_output = torch.zeros(batch_size, d, device=device)
        if self.memory is not None:
            # Store current state
            self.memory.store(
                content=f"step_{self.step_count}",
                embedding=hidden_states,
                importance=0.5
            )
            
            # Retrieve
            mem_result = self.memory.retrieve(hidden_states, top_k=5)
            if mem_result.get("attention_output") is not None:
                enc = mem_result["attention_output"]
                if enc.shape[-1] < d:
                    memory_output = F.pad(enc, (0, d - enc.shape[-1]))
                else:
                    memory_output = enc[:, :d]
            
            result["components"]["memory"] = {
                "active": True,
                "stats": self.memory.get_stats(),
                "retrieved": mem_result["num_retrieved"]
            }
        system_outputs.append(memory_output)

        # 8. Discovery (System 1 & 2)
        discovery_output = torch.zeros(batch_size, d, device=device)
        if self.discovery is not None:
            # In training/inference, discovery runs in background or on demand
            # Here we just project its state if active
            if self.step_count % 100 == 0:  # Auto-cycle every 100 steps
                self.discovery.run_discovery_cycle(pooled.detach())
                
            result["components"]["discovery"] = {
                "active": True,
                "pending_candidates": len(self.discovery.deferred_candidates),
                "journal_stats": self.journal.get_stats() if self.journal else {}
            }
        system_outputs.append(discovery_output)

        # 9. Capabilities (Action System)
        capabilities_output = torch.zeros(batch_size, d, device=device)
        if self.capabilities is not None:
            cap_result = self.capabilities(hidden_states)
            enc = cap_result["capability_embedding"]
            # Ensure 2D: pool sequence if 3D
            if enc.dim() == 3:
                enc = enc.mean(dim=1)
            # Ensure correct size d
            if enc.shape[-1] < d:
                capabilities_output = F.pad(enc, (0, d - enc.shape[-1]))
            else:
                capabilities_output = enc[:, :d]
            
            result["components"]["capabilities"] = {
                "active": True,
                "available_tools": len(cap_result["active_tools"]),
                "last_result": str(cap_result["last_execution"]) if cap_result["last_execution"] else None,
                "rltf_policy_value": cap_result.get("policy_value", 0.0), # RL Critic Value
                "suggested_action": cap_result.get("suggested_tool_idx", 0)
            }
        system_outputs.append(capabilities_output)
        
        # Integrate all systems
        integration_result = self.integrator(system_outputs)
        workspace = integration_result["workspace"]
        
        # Consciousness monitoring
        consciousness_state = self.consciousness(workspace, self.prev_workspace)
        self.prev_workspace = workspace.detach()
        
        # Decision making
        decision_logits = self.decision_maker(workspace)
        decision_probs = F.softmax(decision_logits, dim=-1)
        decision_idx = decision_logits.argmax(dim=-1)
        
        decision_names = ["act", "explore", "learn", "reason", "remember", "wait"]
        
        result["integration"] = {
            "workspace_norm": workspace.norm(dim=-1).mean().item(),
            "system_contributions": {
                k: v.mean().item() 
                for k, v in integration_result["system_contributions"].items()
            }
        }
        
        result["consciousness"] = consciousness_state
        
        result["decision"] = {
            "action": [decision_names[idx.item()] for idx in decision_idx],
            "probabilities": {
                name: decision_probs[:, i].mean().item()
                for i, name in enumerate(decision_names)
            }
        }
        
        # Update AGI state
        self.agi_state["consciousness_level"] = consciousness_state["consciousness"]
        self.agi_state["active_components"] = sum(
            1 for c in result["components"].values() 
            if c.get("active", False)
        )
        self.agi_state["last_decision"] = result["decision"]["action"]
        
        result["agi_state"] = self.agi_state.copy()
        result["workspace"] = workspace
        
        return result
    
    def think(
        self,
        context: torch.Tensor,
        depth: int = 3,
        mode: str = "chain"
    ) -> Dict[str, Any]:
        """
        Meta-cognitive thinking process.
        """
        thoughts = []
        current_context = context
        
        for i in range(depth):
            result = self.forward(current_context, reasoning_mode=mode)
            
            thought = {
                "depth": i,
                "consciousness": result["consciousness"]["consciousness"],
                "decision": result["decision"]["action"],
                "active_systems": result["agi_state"]["active_components"]
            }
            thoughts.append(thought)
            
            # Evolve context with workspace
            current_context = current_context + 0.1 * result["workspace"].unsqueeze(1).expand_as(current_context)
        
        return {
            "thoughts": thoughts,
            "final_decision": thoughts[-1]["decision"],
            "thinking_depth": depth,
            "final_consciousness": thoughts[-1]["consciousness"]
        }
    
    def reason(
        self,
        query: torch.Tensor,
        mode: str = "chain"
    ) -> Dict[str, Any]:
        """
        Explicit reasoning about a query.
        """
        if self.reasoning is None:
            return {"error": "Reasoning module not enabled"}
        
        return self.reasoning(query, mode=mode)
    
    def remember(
        self,
        content: str,
        embedding: torch.Tensor,
        importance: float = 0.5
    ) -> int:
        """Store in long-term memory."""
        if self.memory is None:
            return -1
        return self.memory.store(content, embedding, importance)
    
    def recall(
        self,
        query: torch.Tensor,
        top_k: int = 10
    ) -> Dict[str, Any]:
        """Recall from memory."""
        if self.memory is None:
            return {"memories": []}
        return self.memory.retrieve(query, top_k=top_k)
    
    def learn_concept(
        self,
        concept: str,
        embedding: torch.Tensor,
        importance: float = 0.5
    ) -> str:
        """Add concept to knowledge graph."""
        if self.knowledge is None:
            return ""
        return self.knowledge.add_concept(concept, embedding, importance=importance)
    
    def get_comprehensive_report(self) -> Dict[str, Any]:
        """
        Generate comprehensive AGI status report.
        """
        report = {
            "timestamp": time.time(),
            "step_count": self.step_count,
            "agi_state": self.agi_state.copy(),
            "components": {},
            "consciousness_history": self.consciousness.state_history[-10:]
        }
        
        # Add component-specific reports
        if self.world_model is not None:
            report["components"]["world_model"] = self.world_model.get_world_understanding()
        
        if self.self_model is not None:
            report["components"]["self_model"] = self.self_model.get_self_report()
        
        if self.curiosity is not None:
            report["components"]["curiosity"] = self.curiosity.get_stats()
        
        if self.goals is not None:
            report["components"]["goals"] = self.goals.get_status()
        
        if self.knowledge is not None:
            report["components"]["knowledge"] = self.knowledge.get_stats()
        
        if self.memory is not None:
            report["components"]["memory"] = self.memory.get_stats()
        
        return report
    
    def save_state(self, path: Path):
        """Save complete AGI state."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        
        # Save each component
        if self.knowledge is not None:
            self.knowledge.save(path / "knowledge")
        
        if self.memory is not None:
            self.memory.save(path / "memory")
        
        if self.goals is not None:
            self.goals.save(path / "goals")
        
        if self.self_model is not None:
            self.self_model.save(path / "self_model")
        
        # Save overall state
        with open(path / "agi_state.json", "w") as f:
            json.dump({
                "step_count": self.step_count,
                "agi_state": self.agi_state,
                "consciousness_history": self.consciousness.state_history
            }, f, indent=2)
        
        # Save model weights
        torch.save(self.state_dict(), path / "agi_core.pt")

    def enter_sleep_cycle(self) -> Dict[str, Any]:
        """
        Trigger Biological Sleep for Homeostasis.
        - Consolidates Memory (Synaptic Pruning)
        - Optimizes Knowledge Graph
        - Returns Dream Report
        """
        report = {"timestamp": time.time(), "phase": "REM_SLEEP", "actions": []}
        
        # 1. Memory Consolidation
        if self.memory is not None:
             # Check if it's the CMS variant we just updated
            if hasattr(self.memory, "consolidate_memory"):
                consolidation = self.memory.consolidate_memory()
                report["actions"].append({"type": "memory_pruning", "stats": consolidation})
            else:
                report["actions"].append({"type": "memory_pruning", "status": "skipped_no_cms"})
            
        return report

    def evolve_capabilities(self, universal_prompt_path: str = None) -> Dict[str, Any]:
        """
        Trigger Reproductive/Evolution Cycle.
        - Ingests universal knowledge
        - Fabricates new tools
        """
        report = {"timestamp": time.time(), "phase": "EVOLUTION", "new_tools": []}
        
        if self.capabilities:
            if universal_prompt_path:
                 # Ingest and Learn
                 try:
                    knowledge = self.capabilities.load_universal_knowledge(universal_prompt_path)
                    report["ingested_agents"] = len(knowledge)
                 except Exception as e:
                    report["error"] = str(e)
                 
                 # Here we would trigger the 'Mutation' loop
                 # For now, just reporting ingestion
        
        return report


def create_advanced_agi_core(d_model: int = 512) -> AdvancedAGICore:
    """Factory function for Advanced AGI Core."""
    config = AdvancedAGIConfig(d_model=d_model)
    return AdvancedAGICore(config)


if __name__ == "__main__":
    print("Testing Advanced AGI Core...")
    
    core = create_advanced_agi_core(d_model=512)
    
    # Test forward
    hidden = torch.randn(2, 32, 512)
    actions = torch.randn(2, 32, 512)
    
    result = core(hidden, actions)
    
    print(f"\n=== AGI State ===")
    print(f"Consciousness: {result['consciousness']['consciousness']:.3f}")
    print(f"Active components: {result['agi_state']['active_components']}")
    print(f"Decision: {result['decision']['action']}")
    
    print(f"\n=== System Contributions ===")
    for system, contribution in result['integration']['system_contributions'].items():
        print(f"  {system}: {contribution:.3f}")
    
    print(f"\n=== Component Status ===")
    for comp, data in result['components'].items():
        print(f"  {comp}: {'✅' if data.get('active') else '❌'}")
    
    # Test thinking
    print(f"\n=== Thinking Process ===")
    thoughts = core.think(hidden, depth=2)
    for t in thoughts['thoughts']:
        print(f"  Depth {t['depth']}: consciousness={t['consciousness']:.3f}, decision={t['decision']}")
    
    # Test reasoning
    print(f"\n=== Reasoning ===")
    reasoning = core.reason(hidden, mode="chain")
    print(f"  Steps: {reasoning.get('num_steps', 0)}")
    print(f"  Verification: {reasoning['verification']['valid'].mean():.3f}")
    
    # Get comprehensive report
    report = core.get_comprehensive_report()
    print(f"\n=== Comprehensive Report ===")
    print(f"  Total components: {len(report['components'])}")
    print(f"  Consciousness history: {len(report['consciousness_history'])} entries")
    
    print("\n✅ Advanced AGI Core test passed!")
