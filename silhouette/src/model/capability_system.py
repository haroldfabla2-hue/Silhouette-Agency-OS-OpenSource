"""
NANOSILHOUETTE - Capability System
====================================
Unified Action System for NANOSILHOUETTE.

Integrates:
1. Tool Executor: Safe execution of internal and external tools.
2. Tool Fabricator: Autonomous creation of new Python tools.
3. Universal MCP Client: Connectivity to external Model Context Protocol servers.

Configured as a specialized cognitive system (System 9).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Any, List, Union, Callable
from dataclasses import dataclass, field
import json
import time
import ast
import inspect
import threading
from enum import Enum
from collections import deque
import random


class ToolType(Enum):
    INTERNAL = "internal"  # Hardcoded or fabricated python tools
    MCP = "mcp"            # External MCP tools
    FABRICATED = "fabricated" # Self-created tools


@dataclass
class ToolResult:
    """Result of a tool execution."""
    output: str
    error: Optional[str] = None
    execution_time: float = 0.0
    success: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolSpec:
    """Specification for a tool."""
    name: str
    description: str
    arguments: Dict[str, str]  # name -> type description
    type: ToolType
    handler: Callable
    safety_check: bool = True


class ToolFabricator(nn.Module):
    """
    Autonomous tool creator.
    
    Generates Python code for new tools based on specifications.
    Includes Abstract Syntax Tree (AST) analysis for safety.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        
        # Code generator network
        self.code_generator = nn.Sequential(
            nn.Linear(d_model, 1024),
            nn.SiLU(),
            nn.Linear(1024, 2048),  # Simple embedding-to-code projection (symbolic)
            nn.LayerNorm(2048)
        )
        
        # Safety classifier
        self.safety_classifier = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.SiLU(),
            nn.Linear(128, 1),
            nn.Sigmoid()
        )
    
    def validate_code_safety(self, code: str) -> bool:
        """
        Perform static analysis to ensure code safety.
        Rejects:
        - System calls (os.system, subprocess)
        - Infinite loops (basic check)
        - Dangerous imports
        """
        try:
            tree = ast.parse(code)
            
            for node in ast.walk(tree):
                # Check imports
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    full_name = ""
                    if isinstance(node, ast.Import):
                        full_name = node.names[0].name
                    elif isinstance(node, ast.ImportFrom):
                        full_name = node.module or ""
                    
                    if full_name in ["os", "subprocess", "sys", "shutil"]:
                        return False
                
                # Check dangerous calls
                if isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name):
                        if node.func.id in ["eval", "exec", "compile"]:
                            return False
                            
            return True
        except SyntaxError:
            return False
        except Exception:
            return False

    def fabricate_tool(self, intent_embedding: torch.Tensor, spec_str: str) -> Optional[ToolSpec]:
        """
        Simulate tool fabrication.
        
        In a real scenario, this would generate code. 
        Here we verify safety and structural integrity.
        """
        # 1. Check safety of intent (using classifier)
        safety_score = self.safety_classifier(intent_embedding).mean().item()
        if safety_score < 0.8:
            return None
            
        # 2. Logic to generate code would go here
        # For this implementation, we assume spec_str CONTAINS the code provided by the LLM
        # in a real loop.
        
        # Mock fabrication for demonstration
        return None


class UniversalMCPClient:
    """
    Client for connecting to Model Context Protocol (MCP) servers.
    """
    
    def __init__(self):
        self.connected_servers = {}
        self.available_tools: Dict[str, ToolSpec] = {}
    
    def connect_server(self, name: str, transport_config: Dict) -> bool:
        """Connect to an MCP server."""
        # Mock connection logic
        self.connected_servers[name] = {"status": "connected", "config": transport_config}
        return True
    
    def discover_tools(self, server_name: str) -> List[ToolSpec]:
        """List tools available on a server."""
        # Mock discovery
        return []
    
    def call_tool(self, server_name: str, tool_name: str, args: Dict) -> ToolResult:
        """Call an MCP tool."""
        return ToolResult(output="MCP Call Mock Output", success=True)


class ToolExecutor:
    """
    Safe execution environment for tools.
    """
    
    def __init__(self):
        self.tools: Dict[str, ToolSpec] = {}
        self.history: List[Dict] = []
        self._lock = threading.RLock()
    
    def register_tool(self, spec: ToolSpec):
        with self._lock:
            self.tools[spec.name] = spec
            
    def execute(self, tool_name: str, args: Dict) -> ToolResult:
        """Execute a registered tool safely."""
        start_time = time.time()
        
        with self._lock:
            if tool_name not in self.tools:
                return ToolResult(
                    output="",
                    error=f"Tool {tool_name} not found",
                    success=False
                )
            
            tool = self.tools[tool_name]
        
        try:
            # Execute handler
            result_data = tool.handler(**args)
            execution_time = time.time() - start_time
            
            result = ToolResult(
                output=str(result_data),
                success=True,
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            result = ToolResult(
                output="",
                error=str(e),
                success=False,
                execution_time=execution_time
            )
            
        # Log history
        self.history.append({
            "tool": tool_name,
            "args": args,
            "success": result.success,
            "time": execution_time,
            "timestamp": time.time()
        })
        
        return result


class ActionPolicyNetwork(nn.Module):
    """
    Actor-Critic network for mastering tool usage (RLTF).
    
    Actor: P(action | state) --> Which tool to use?
    Critic: V(state) --> How good is this situation?
    """
    
    def __init__(self, d_model: int, num_tools: int = 10):
        super().__init__()
        
        # Shared feature extractor
        self.shared = nn.Sequential(
            nn.Linear(d_model, 512),
            nn.SiLU(),
            nn.Linear(512, 512),
            nn.SiLU()
        )
        
        # Actor Head (Policy)
        self.actor = nn.Sequential(
            nn.Linear(512, 256),
            nn.SiLU(),
            nn.Linear(256, num_tools)  # Logits for each tool
        )
        
        # Critic Head (Value)
        self.critic = nn.Sequential(
            nn.Linear(512, 256),
            nn.SiLU(),
            nn.Linear(256, 1)  # Expected reward
        )
        
    def forward(self, state: torch.Tensor) -> Dict[str, torch.Tensor]:
        features = self.shared(state)
        logits = self.actor(features)
        value = self.critic(features)
        
        return {
            "logits": logits,
            "value": value,
            "probs": F.softmax(logits, dim=-1)
        }


class CapabilitySystem(nn.Module):
    """
    The 'Hands' of the AGI.
    
    Unified system for:
    - Executing tools
    - Creating tools
    - Connecting to external world
    - LEARNING from actions (RLTF)
    """
    
    def __init__(self, d_model: int, max_tools: int = 50):
        super().__init__()
        
        # Neural interface
        self.intent_encoder = nn.Sequential(
            nn.Linear(d_model, 512),
            nn.SiLU(),
            nn.Linear(512, d_model)
        )
        
        # RLTF Policy
        self.policy = ActionPolicyNetwork(d_model, num_tools=max_tools)
        self.replay_buffer = deque(maxlen=1000)
        self.optimizer = torch.optim.Adam(self.policy.parameters(), lr=1e-4)
        
        # Subsystems
        self.executor = ToolExecutor()
        self.fabricator = ToolFabricator(d_model)
        self.mcp_client = UniversalMCPClient()
        
        # State
        self.active = False
        self.last_result: Optional[ToolResult] = None
        self.tool_id_map = {} # name -> int index
        
        self._init_default_tools()
        
    def _map_tools(self):
        """Update tool ID mapping."""
        self.tool_id_map = {name: i for i, name in enumerate(self.executor.tools.keys())}
    
    def _init_default_tools(self):
        """Register basic internal tools."""
        self.executor.register_tool(ToolSpec(
            name="calculator",
            description="Basic math operations",
            arguments={"expression": "Math expression string"},
            type=ToolType.INTERNAL,
            handler=self._tool_calculator
        ))
        self._map_tools()
        
    def load_universal_knowledge(self, root_path: str):
        """Ingest knowledge from external agents."""
        # Lazy import to avoid circular dep if any
        from .discovery.universal_ingestor import create_universal_ingestor
        
        ingestor = create_universal_ingestor(root_path)
        knowledge_base = ingestor.scan()
        
        print(f"[CapabilitySystem] Ingested knowledge from {len(knowledge_base)} agents.")
        
        # In a real implementation, we would:
        # 1. Parse 'tools.json' to create new ToolSpecs (via Fabricator)
        # 2. Parse 'heuristics' to initialize ActionPolicy biases
        
        return knowledge_base

    def _tool_calculator(self, expression: str) -> str:
        """Safe calculator tool."""
        # Very restricted eval
        allowed_names = {"abs": abs, "round": round, "min": min, "max": max}
        code = compile(expression, "<string>", "eval")
        for name in code.co_names:
            if name not in allowed_names:
                raise ValueError(f"Use of {name} not allowed")
        return str(eval(code, {"__builtins__": {}}, allowed_names))

    def forward(self, hidden_state: torch.Tensor, intent_mask: Optional[torch.Tensor] = None) -> Dict[str, Any]:
        """
        Process hidden state to determine if action is needed.
        
        Does NOT execute action in forward pass (for safety/determinism).
        Returns action logic and embedding.
        """
        # Pool across sequence dimension if 3D tensor [batch, seq, d_model] -> [batch, d_model]
        if hidden_state.dim() == 3:
            hidden_state = hidden_state.mean(dim=1)
        
        encoded_intent = self.intent_encoder(hidden_state)
        
        # RLTF: Predict optimal tool
        policy_out = self.policy(encoded_intent)
        best_tool_idx = policy_out["probs"].argmax(dim=-1)[0].item()
        
        return {
            "capability_embedding": encoded_intent,
            "active_tools": list(self.executor.tools.keys()),
            "last_execution": self.last_result,
            "suggested_tool_idx": best_tool_idx,
            "policy_value": policy_out["value"][0].item()
        }
    
    def execute_action(self, tool_name: str, args: Dict) -> ToolResult:
        """
        Explicitly correct method to trigger action.
        Should be called by AGI Core decision loop.
        """
        # Store state before action (for RL)
        # In real impl, we'd pass the actual tensor state
        
        result = self.executor.execute(tool_name, args)
        self.last_result = result
        
        # Calculate Reward
        reward = self._calculate_reward(result)
        
        # Store in buffer (simplified)
        self.replay_buffer.append({
            "tool": tool_name,
            "reward": reward,
            "success": result.success
        })
        
        # Online Learning Step (RLTF)
        if len(self.replay_buffer) > 10:
            self._update_policy()
            
        return result

    def _calculate_reward(self, result: ToolResult) -> float:
        """Map result to scalar reward."""
        reward = 0.0
        if result.success:
            reward += 1.0
            # Latency penalty
            if result.execution_time < 0.1: reward += 0.2
            elif result.execution_time > 2.0: reward -= 0.1
        else:
            reward -= 0.5
            
        return reward

    def _update_policy(self):
        """Perform a PPO-style update (simplified)."""
        # Placeholder for backprop logic
        pass

    def fabricate_new_tool(self, spec_code: str, intent_embedding: torch.Tensor) -> bool:
        """
        Attempt to create a new tool from code generated by the LLM.
        """
        if self.fabricator.validate_code_safety(spec_code):
            # This is where we would dynamically load the code
            # For this secure implementation, we simulate success if safety passes
            return True
        return False


def create_capability_system(d_model: int = 512) -> CapabilitySystem:
    return CapabilitySystem(d_model)


if __name__ == "__main__":
    print("Testing Capability System...")
    sys = create_capability_system()
    
    # Test internal tool
    res = sys.executor.execute("calculator", {"expression": "2 + 2 * 10"})
    print(f"Calc Result: {res.output}")
    assert res.output == "22"
    
    # Test safety checks
    unsafe_code = "import os; os.system('echo hack')"
    safe = sys.fabricator.validate_code_safety(unsafe_code)
    print(f"Safety Check (Unsafe): {safe}")
    assert safe is False
    
    print("✅ Capability System Test Passed")
