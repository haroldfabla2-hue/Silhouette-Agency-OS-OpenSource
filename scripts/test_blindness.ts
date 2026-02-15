
import { introspection } from '../services/introspectionEngine';
import { systemBus } from '../services/systemBus';

async function runTest() {
    try {
        console.log("--- TEST: SENSORY DEPRIVATION (BLINDNESS) ---");
        console.log("1. Starting Cognitive Cycle without Frontend (Eyes Closed)...");

        // We run the cycle. Since no Frontend is listening to 'PROTOCOL_VISUAL_REQUEST',
        // the 'observe()' method will timeout (2s) and return undefined snapshot.

        console.log("   [WAITING] Waiting for Visual Timeout (2s)...");
        const decision = await introspection.runCognitiveCycle();

        console.log("2. Cycle Complete. analyzing Decision...");
        console.log("   - Priority:", decision.priority);
        console.log("   - Reasoning:", decision.reasoning);

        // Check internal state directly (since runCognitiveCycle returns the final decision)
        // We can inspect the recent thoughts to see if "Sensory Deprivation" was logged.
        const thoughts = introspection.getRecentThoughts();
        const blindnessDetected = thoughts.some(t => t.includes("Sensory Deprivation") || t.includes("Visual Cortex Offline"));

        if (blindnessDetected) {
            console.log("✅ SUCCESS: Agent detected its own blindness.");
            console.log("   - Proof:", thoughts.find(t => t.includes("Sensory Deprivation") || t.includes("Visual Cortex Offline")));
        } else {
            console.error("❌ FAILURE: Agent did not notice it was blind.");
            console.log("   - Internal Thoughts:", thoughts.slice(-3));
        }

    } catch (error) {
        console.error("❌ Test Failed:", error);
    }
}

runTest();
