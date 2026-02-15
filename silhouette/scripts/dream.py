
"""
scripts/dream.py
================
Biological Sleep Cycle Trigger for NanoSilhouette.
This script initiates the 'REM Sleep' process:
1. Loads the AGI Core.
2. Triggers Memory Consolidation (Synaptic Pruning).
3. Saves the optimized 'Consolidated' state.

This is equivalent to the 'Subconscious' system in the biological architecture.
"""
import sys
import os
import torch
import time
from pathlib import Path

# Add src to path
sys.path.append(str(Path(__file__).parent.parent))

from src.model.advanced_agi_core import create_advanced_agi_core

def run_dream_cycle():
    print("🌙 Initiating NanoSilhouette Dream Cycle (REM Sleep)...")
    
    # 1. Initialize Organism
    print("🧠 Awakening Subconscious (Loading Core)...")
    d_model = 512
    core = create_advanced_agi_core(d_model=d_model)
    
    # Load state if exists
    state_path = Path("./checkpoints/agi_core.pt")
    if state_path.exists():
        print(f"📂 Loading existing state from {state_path}...")
        try:
            core.load_state_dict(torch.load(state_path))
        except Exception as e:
            print(f"⚠️ Could not load state: {e}. Starting fresh dream.")
    else:
        print("🌱 No previous state. First sleep cycle.")

    # 2. Simulate some activity (to populate memory for demo purposes if empty)
    # In production, this memory would be full from daily usage.
    print("💭 Simulating recent memories (Day Residue)...")
    mock_input = torch.randn(1, 10, d_model)
    mock_action = torch.randn(1, 10, d_model)
    _ = core(mock_input, mock_input) # Forward pass populates buffers
    
    # 3. Enter Sleep
    print("💤 Entering Deep Sleep...")
    start_time = time.time()
    
    dream_report = core.enter_sleep_cycle()
    
    duration = time.time() - start_time
    
    # 4. Report
    print("\n=== ✨ Dream Report ✨ ===")
    print(f"Duration: {duration:.4f}s")
    print(f"Phase: {dream_report['phase']}")
    
    for action in dream_report['actions']:
        if action['type'] == 'memory_pruning':
            if 'stats' in action:
                stats = action['stats']
                print(f"🧠 Memory Pruning:")
                print(f"   - Pruned (Redundant) Synapses: {stats.get('pruned', 0)}")
                print(f"   - Total Memory Slots: {stats.get('total_slots', 0)}")
                total_slots = stats.get('total_slots', 1)
                if total_slots > 0:
                    efficiency = (stats.get('pruned', 0) / total_slots) * 100
                    print(f"   - Optimization Efficiency: {efficiency:.1f}%")
            else:
                print(f"🧠 Memory Pruning: {action.get('status', 'completed')}")

    print("\n✅ Sleep Cycle Complete. Memory Consolidated.")

if __name__ == "__main__":
    run_dream_cycle()
