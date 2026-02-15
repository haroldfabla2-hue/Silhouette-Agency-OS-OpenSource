import os
import json
import logging
import time
from typing import Dict, List, Optional, Any, Callable
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
# Lazy import torch to allow usage in lightweight envs
# import torch
# import torch.nn.functional as F

@dataclass
class AgentKnowledge:
    name: str
    source_path: str
    system_prompt: Optional[str] = None
    tools_spec: Optional[Dict] = None
    heuristics: List[str] = field(default_factory=list)
    embeddings: Any = None # Optional[torch.Tensor]
    metadata: Dict[str, Any] = field(default_factory=dict)

class UniversalPromptIngestor:
    """
    Ingests external agent knowledge from the 'universalprompts' library.
    Acts as a 'Meta-Learning' source for the AGI.
    
    Architected for High-Scale:
    - Lazy loading
    - Robust error recovery
    - Batch embedding processing
    - Vector-DB ready interfaces
    """
    
    def __init__(self, root_path: str, device: str = "cpu"):
        self.root_path = root_path
        self.device = device
        self.knowledge_base: Dict[str, AgentKnowledge] = {}
        self.logger = logging.getLogger("UniversalIngestor")
        self.logger.setLevel(logging.INFO)

        if not os.path.exists(root_path):
            self.logger.warning(f"Universal prompts path not found: {root_path}")

    def scan(self, max_workers: int = 4) -> Dict[str, AgentKnowledge]:
        """
        Recursively scans the directory for agent definitions.
        Robust against individual file corruptions.
        """
        start_time = time.time()
        count = 0
        errors = 0
        
        # Future: Use ThreadPoolExecutor for IO-bound read if thousands of files
        # For now, safe sequential scan is robust enough for SSDs
        if not os.path.exists(self.root_path):
            return {}

        self.logger.info(f"Scanning knowledge at {self.root_path}...")

        for root, dirs, files in os.walk(self.root_path):
            agent_name = os.path.basename(root)
            
            # Identify "Agent" directories
            has_prompt = "Prompt.txt" in files or any(f.endswith("Prompt.txt") for f in files)
            has_tools = "tools.json" in files
            
            if has_prompt or has_tools:
                try:
                    knowledge = self._extract_knowledge(root, agent_name, files)
                    if knowledge:
                        self.knowledge_base[agent_name] = knowledge
                        count += 1
                except Exception as e:
                    self.logger.error(f"Failed to ingest agent {agent_name}: {e}")
                    errors += 1
        
        duration = time.time() - start_time
        self.logger.info(f"Scan complete: {count} agents loaded, {errors} errors in {duration:.2f}s")     
        return self.knowledge_base

    def index_knowledge(self, encoder_fn: Callable[[List[str]], Any], batch_size: int = 32):
        """
        Creates semantic embeddings for all extracted heuristics.
        Handles large datasets via batching.
        """
        try:
            import torch
        except ImportError:
            self.logger.warning("Torch not found. Skipping semantic indexing.")
            return
        self.logger.info("Indexing Universal Knowledge semantically...")
        all_heuristics = []
        
        # Gather all text first
        for agent, data in self.knowledge_base.items():
            if data.heuristics:
                for h in data.heuristics:
                    if len(h.strip()) > 10: # Min length filter
                        all_heuristics.append(h)
        
        if not all_heuristics:
            self.logger.warning("No heuristics found to index.")
            return

        # Batch encoding logic would go here for massive scale.
        # For current scale (~100 agents), per-agent processing is fine but wrapped in try-catch.
        
        count = 0
        try:
            for agent, data in self.knowledge_base.items():
                if data.heuristics:
                    with torch.no_grad():
                        # Assume encoder_fn handles its own device placement or returns CPU tensor
                        vectors = encoder_fn(data.heuristics)
                        if isinstance(vectors, torch.Tensor):
                            vectors = vectors.to(self.device)
                        data.embeddings = vectors
                    count += len(data.heuristics)
            
            self.logger.info(f"Indexed {count} heuristics.")
            
        except Exception as e:
            self.logger.error(f"Indexing failed: {e}")

    def search(self, query: str, encoder_fn: Callable, top_k: int = 3, threshold: float = 0.45) -> List[Dict]:
        """
        Semantic search with tensor operations.
        Robust constraints: Thresholding, Error handling.
        """
        try:
            import torch
            import torch.nn.functional as F
        except ImportError:
            self.logger.warning("Torch not found. Cannot perform semantic search.")
            return []

        try:
            with torch.no_grad():
                query_vec = encoder_fn([query])
                if isinstance(query_vec, torch.Tensor):
                    query_vec = query_vec.to(self.device)
                
            results = []
            
            for agent, data in self.knowledge_base.items():
                if data.embeddings is None:
                    continue
                    
                # Cosine similarity
                sims = F.cosine_similarity(query_vec, data.embeddings)
                
                # Filter by threshold locally
                mask = sims > threshold
                if not mask.any():
                    continue
                    
                indices = torch.nonzero(mask).squeeze(1)
                scores = sims[indices]
                
                # Handle scalar vs vector output quirks
                if indices.dim() == 0: indices = indices.unsqueeze(0)
                if scores.dim() == 0: scores = scores.unsqueeze(0)

                for idx, score in zip(indices, scores):
                    results.append({
                        "agent": agent,
                        "heuristic": data.heuristics[idx.item()],
                        "score": score.item(),
                        "source": data.source_path
                    })
                        
            # Sort globally
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:top_k]
            
        except Exception as e:
            self.logger.error(f"Search error: {e}")
            return []

    def _extract_knowledge(self, dir_path: str, agent_name: str, files: List[str]) -> Optional[AgentKnowledge]:
        """Extracts data safely."""
        try:
            heuristics = []
            prompt_content = None
            tools_spec = None
            
            # 1. Extract System Prompt
            prompt_file = next((f for f in files if f.endswith("Prompt.txt")), None)
            if prompt_file:
                p_path = os.path.join(dir_path, prompt_file)
                # Safety limit: Don't read massive logs if they pretend to be prompts
                if os.path.exists(p_path) and os.path.getsize(p_path) < 5 * 1024 * 1024: 
                    with open(p_path, 'r', encoding='utf-8', errors='ignore') as f:
                        prompt_content = f.read()
                        heuristics.extend(self._extract_heuristics(prompt_content))
                else:
                    self.logger.warning(f"Skipping file {p_path}: too large or missing")

            # 2. Extract Tools
            if "tools.json" in files:
                t_path = os.path.join(dir_path, "tools.json")
                if os.path.exists(t_path):
                    with open(t_path, 'r', encoding='utf-8', errors='ignore') as f:
                        tools_spec = json.load(f)

            return AgentKnowledge(
                name=agent_name, 
                source_path=dir_path, 
                system_prompt=prompt_content,
                tools_spec=tools_spec,
                heuristics=heuristics
            )
        except Exception as e:
            self.logger.warning(f"Partial extraction failure for {agent_name}: {e}")
            return None 

    def _extract_heuristics(self, text: str) -> List[str]:
        """Simple rule-based heuristic extractor."""
        heuristics = []
        if not text: return []
        
        lines = text.split('\n')
        # Expanded vocabulary
        keywords = ["Always", "Never", "Do not", "Must", "Should", "Crucial", "Important", "Ensure", "Verify"]
        
        for line in lines:
            line = line.strip()
            # Heuristic quality filter
            if len(line) > 20 and len(line) < 300 and any(line.startswith(k) for k in keywords):
                heuristics.append(line)
                
        return heuristics

def create_universal_ingestor(root_path: str = None) -> UniversalPromptIngestor:
    """Create ingestor with path relative to this file's location."""
    if root_path is None:
        # Use path relative to this module's location
        import pathlib
        module_dir = pathlib.Path(__file__).parent.parent.parent.parent
        root_path = str(module_dir / "universalprompts")
    return UniversalPromptIngestor(root_path)
