import sys
import os
import torch

# Add src to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.model.discovery.universal_ingestor import create_universal_ingestor

def dummy_encoder(texts):
    """Mock encoder for testing."""
    # Returns random vectors
    return torch.randn(len(texts), 128)

def main():
    print("=== Testing Universal Ingestor ===")
    
    # fix path for user environment
    root = r"D:\Proyectos personales\nanosilhouette\universalprompts"
    if not os.path.exists(root):
        print(f"Path not found: {root}")
        # Create a dummy dir for testing if real one missing (fallback)
        os.makedirs("temp_prompts/AgentX", exist_ok=True)
        with open("temp_prompts/AgentX/Prompt.txt", "w") as f:
            f.write("Always be polite.\nNever delete system files.")
        root = "temp_prompts"
        
    ingestor = create_universal_ingestor(root)
    
    # 1. Scan
    print("Scanning...")
    kb = ingestor.scan()
    print(f"Found {len(kb)} agents.")
    
    for name, data in kb.items():
        print(f" - {name}: {len(data.heuristics)} heuristics found.")
        if data.heuristics:
             print(f"   Sample: {data.heuristics[0]}")

    # 2. Index
    print("\nIndexing...")
    ingestor.index_knowledge(dummy_encoder)
    
    # 3. Search
    print("\nSearching query: 'How to be safe?'")
    results = ingestor.search("How to be safe?", dummy_encoder)
    
    for r in results:
        print(f"Match [{r['score']:.2f}]: {r['heuristic']} ({r['agent']})")
        
    print("\n=== Test Complete ===")

if __name__ == "__main__":
    main()
