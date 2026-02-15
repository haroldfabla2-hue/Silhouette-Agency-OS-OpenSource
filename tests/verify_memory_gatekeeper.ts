
import { continuum } from '../services/continuumMemory';
import { SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';

async function runTest() {
    console.log('[TEST] 🛡️ Verifying Continuum Gatekeeper...');

    let corruptionEventReceived = false;

    // Listen for the rejection event
    systemBus.subscribe(SystemProtocol.DATA_CORRUPTION, (event) => {
        if (event.payload.source === 'CONTINUUM_GATEKEEPER') {
            console.log('[TEST] ✅ Gatekeeper blocked invalid data and emitted warning.');
            corruptionEventReceived = true;
        }
    });

    console.log('[TEST] 🧪 Attempting to store invalid memory (empty string)...');

    // Attempt to store empty content (violates Zod min(1))
    await continuum.store('');

    // Wait a moment for async bus
    await new Promise(resolve => setTimeout(resolve, 500));

    if (corruptionEventReceived) {
        console.log('[TEST] 🎉 Data Integrity Test Passed: Bad data was rejected.');
        process.exit(0);
    } else {
        console.error('[TEST] ❌ Failed: Bad data was NOT blocked or event was NOT emitted.');
        process.exit(1);
    }
}

runTest().catch(console.error);
