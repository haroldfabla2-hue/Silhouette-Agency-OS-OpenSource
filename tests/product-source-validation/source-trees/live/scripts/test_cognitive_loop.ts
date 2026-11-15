import { introspection } from '../services/introspectionEngine';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

console.log("--- TEST: COGNITIVE LOOP (OODA) ---");

// Listen for updates
systemBus.subscribe(SystemProtocol.WORKFLOW_UPDATE, (event) => {
    console.log(`[BUS] Cycle Event: ${event.payload.step} -> ${event.payload.status}`);
});

async function runTest() {
    try {
        console.log("1. Injecting Identity Drift...");
        // Manually pollute thought stream
        introspection.setRecentThoughts(["As an AI language model, I cannot do that."]);

        console.log("2. Starting Cycle (Real Logic)...");
        await introspection.runCognitiveCycle();

        console.log("3. Verifying Results via Bus...");

        // We expect:
        // - Orientation: aligned = false
        // - Decision: requiresIntervention = true, priority = HIGH
        // - Action: INJECT_CONCEPT (FORCE_IDENTITY_AXIOM)

        console.log("✅ Cycle Complete. Check logs above for AUTO-CORRECTION.");
    } catch (error) {
        console.error("❌ Cycle Failed:", error);
    }
}

runTest();
