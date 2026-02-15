
import { SystemProtocol, MemoryTier, MemoryNode } from '../types';
import { systemBus } from '../services/systemBus';
import { contextJanitor } from '../services/contextJanitor';
import { continuum } from '../services/continuumMemory';

// Mock Continuum to return corrupt data
// Using the correct MemoryTier enum values (WORKING, MEDIUM, LONG)
continuum.getAllNodes = async (): Promise<Record<MemoryTier, MemoryNode[]>> => {
    return {
        [MemoryTier.WORKING]: [
            { id: 'valid-1', content: 'Valid Memory', tier: MemoryTier.WORKING } as unknown as MemoryNode,
            { id: 'corrupt-1', content: undefined, tier: MemoryTier.WORKING } as unknown as MemoryNode, // ⚠️ THE BAD APPLE
        ],
        [MemoryTier.MEDIUM]: [],
        [MemoryTier.LONG]: [],
        [MemoryTier.DEEP]: []
    };
};

// Mock Orchestrator's handleDataCorruption to verify receipt
const originalEmit = systemBus.emit.bind(systemBus);
let corruptionDetected = false;

systemBus.emit = (event: SystemProtocol, payload: any) => {
    if (event === SystemProtocol.DATA_CORRUPTION) {
        console.log(`[TEST] ✅ SUCCESS: DATA_CORRUPTION Event Detected!`);
        console.log(`[TEST] Payload:`, payload);
        corruptionDetected = true;
    }
    // Pass through to actual bus so Orchestrator (if running) would hear it
    return originalEmit(event, payload);
};

async function runTest() {
    console.log('[TEST] 🧹 Running Janitor Maintenance with Corrupt Data...');

    await contextJanitor.runMaintenance();

    if (corruptionDetected) {
        console.log('[TEST] 🏁 Test Passed: System detected and reported the corruption.');
        process.exit(0);
    } else {
        console.error('[TEST] ❌ Test Failed: Janitor did not emit DATA_CORRUPTION.');
        process.exit(1);
    }
}

runTest().catch(console.error);
