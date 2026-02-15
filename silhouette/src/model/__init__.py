# SILHOUETTE Model Package
# Homeostatic AGI with auto-scaling resource management

# Main Model (with backward compatibility aliases)
from .nanosilhouette import (
    SilhouetteModel,
    SilhouetteConfig,
    create_model,
    # Backward compatibility
    NanoSilhouetteModel,
    NanoSilhouetteConfig,
)

# Homeostatic Resource Management
from .homeostasis import (
    HomeostasisManager,
    get_homeostasis_manager,
    get_optimal_config,
    ScalableConfig,
    ResourceProfile,
    EnvironmentState,
)

# Core Architecture
from .mamba_block import MambaBlock
from .mamba2_block import Mamba2Block
from .transformer_block import TransformerBlock
from .cms_memory import ContinuumMemorySystem
from .jepa_head import JEPAHead
from .introspection import IntrospectionModule
from .moe import MoELayer
from .deep_optimizer import DeepOptimizer
from .eternal_memory import (
    EternalMemory,
    SemanticMemory,
    EpisodicMemory,
    MemoryConsolidation
)

# AGI Components (Basic)
from .world_model import WorldModel, create_world_model
from .self_model import SelfModel, create_self_model
from .curiosity_module import CuriosityModule, create_curiosity_module
from .goal_system import GoalSystem, create_goal_system
from .agi_core import AGICore, AGIEnhancedModel, create_agi_core

# AGI Components (Advanced - State-of-the-Art)
from .advanced_memory import AdvancedVectorMemory, create_advanced_memory
from .advanced_world_model import AdvancedWorldModel, create_advanced_world_model
from .advanced_self_model import AdvancedSelfModel, create_advanced_self_model
from .advanced_curiosity import AdvancedCuriosity, create_advanced_curiosity
from .advanced_goal_system import AdvancedGoalSystem, create_advanced_goal_system
from .chain_of_thought import ChainOfThought, create_chain_of_thought
from .semantic_knowledge_graph import SemanticKnowledgeGraph, create_semantic_kg
from .advanced_agi_core import AdvancedAGICore, create_advanced_agi_core

# Discovery System (Neurocognitive Discovery)
from .discovery_engine import DiscoveryEngine, create_discovery_engine
from .discovery_journal import DiscoveryJournal, create_discovery_journal
from .synthesis_service import SynthesisService, create_synthesis_service
from .eureka_module import EurekaModule, create_eureka_module

# Universal Knowledge (Ingestion)
from .discovery.universal_ingestor import UniversalPromptIngestor, create_universal_ingestor

__all__ = [
    # ============ Main Model (Homeostatic) ============
    "SilhouetteModel",
    "SilhouetteConfig",
    "create_model",
    # Backward compatibility
    "NanoSilhouetteModel",
    "NanoSilhouetteConfig",
    
    # ============ Homeostatic Resource Management ============
    "HomeostasisManager",
    "get_homeostasis_manager",
    "get_optimal_config",
    "ScalableConfig",
    "ResourceProfile",
    "EnvironmentState",
    
    # ============ Core Architecture ============
    "MambaBlock",
    "Mamba2Block",
    "TransformerBlock",
    "ContinuumMemorySystem",
    "JEPAHead",
    "IntrospectionModule",
    "MoELayer",
    "DeepOptimizer",
    
    # ============ Memory System ============
    "EternalMemory",
    "SemanticMemory",
    "EpisodicMemory",
    "MemoryConsolidation",
    
    # ============ AGI Components (Basic) ============
    "WorldModel",
    "SelfModel",
    "CuriosityModule",
    "GoalSystem",
    "AGICore",
    "AGIEnhancedModel",
    "create_world_model",
    "create_self_model",
    "create_curiosity_module",
    "create_goal_system",
    "create_agi_core",
    
    # ============ AGI Components (Advanced) ============
    # Advanced Memory (HNSW + Attention)
    "AdvancedVectorMemory",
    "create_advanced_memory",
    
    # Advanced World Model (Dreamer-v3 RSSM)
    "AdvancedWorldModel",
    "create_advanced_world_model",
    
    # Advanced Self Model (Conformal + Bayesian)
    "AdvancedSelfModel",
    "create_advanced_self_model",
    
    # Advanced Curiosity (RND + Go-Explore + Empowerment)
    "AdvancedCuriosity",
    "create_advanced_curiosity",
    
    # Advanced Goal System (Options + HRL + HER)
    "AdvancedGoalSystem",
    "create_advanced_goal_system",
    
    # Chain of Thought (ToT + Self-Consistency + Reflexion)
    "ChainOfThought",
    "create_chain_of_thought",
    
    # Semantic Knowledge Graph (GNN + Multi-hop)
    "SemanticKnowledgeGraph",
    "create_semantic_kg",
    
    # Advanced AGI Core (Full Integration)
    "AdvancedAGICore",
    "create_advanced_agi_core",
    
    # ============ Discovery System (Neurocognitive) ============
    # Discovery Engine (Watts-Strogatz + Hebbian + SEAL)
    "DiscoveryEngine",
    "create_discovery_engine",
    
    # Discovery Journal (SQLite persistence)
    "DiscoveryJournal",
    "create_discovery_journal",
    
    # Synthesis Service (Meta-insights)
    "SynthesisService",
    "create_synthesis_service",
    
    # Eureka Module (Cross-domain gaps)
    "EurekaModule",
    "create_eureka_module",
    
    # ============ Capability System (Autonomous Tooling) ============
    # Tool Executor + Veracity + MCP
    "CapabilitySystem",
    "create_capability_system",

    # ============ Universal Knowledge (Ingestion) ============
    "UniversalPromptIngestor",
    "create_universal_ingestor",
]




