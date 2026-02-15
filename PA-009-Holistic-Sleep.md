# PA-009: Holistic Sleep Cycle (Neural + Memory)

## 1. Goal
Implement a robust "Sleep Cycle" that performs both:
1.  **Neural Plasticity**: Fine-tuning the LLM weights using LoRA (`train_lora.py`).
2.  **Memory Consolidation**: Optimizing the Continuum Memory (promoting Short -> Medium, saving snapshots, cleaning vector DB).

## 2. Architecture Changes

### A. Services
1.  **`services/continuumMemory.ts`**:
    *   [NEW] `public async forceConsolidation()`: Triggers `tickMedium` and `saveSnapshot` immediately.

2.  **`services/dreamerService.ts`**:
    *   [MODIFY] Refactor `triggerNeuralTraining` to be reusable/public (or part of `forceSleepCycle`).
    *   [NEW] `public async forceSleepCycle(options: { train: boolean, consolidate: boolean })`: 
        *   step 1: `continuum.forceConsolidation()`
        *   step 2: `triggerNeuralTraining()` (if enabled)
    *   [MODIFY] Ensure `triggerNeuralTraining` emits `TRAINING_LOG` events to `systemBus` so the UI (Terminal) can see them. Currently it logs to console.

3.  **`services/training/trainingService.ts`**:
    *   [MODIFY] Update to use `dreamerService.forceSleepCycle()` instead of spawning its own process. This avoids code duplication.

4.  **`services/actionExecutor.ts`**:
    *   [NO CHANGE] It calls `trainingService.startSleepCycle()`, which will now delegate correctly.

## 3. Execution Steps
1.  Update `continuumMemory` to expose consolidation.
2.  Update `dreamerService` to implement the holistic cycle and event emission.
3.  Update `trainingService` to be a thin wrapper.
4.  Verify via the UI button (which calls `/v1/training/sleep`). wait, `/v1/training/sleep` currently spawns the process directly in `server/index.ts`.
    *   [CRITICAL] I MUST update `server/index.ts` to use `trainingService` (or `dreamerService`) instead of raw spawn, so the API *also* triggers the holistic cycle.

## 4. Verification
1.  Trigger Sleep via Button.
2.  Verify logs in UI show "Consolidating Memory..." then "Starting Training...".
3.  Verify Python script runs.
4.  Verify Memory Snapshot is saved.
