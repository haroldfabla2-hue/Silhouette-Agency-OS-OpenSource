
import { DreamerService } from '../services/dreamerService'; // Adjust path
import { SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';

// Mocking dependencies to force a "Mystery" outcome
// In a real integration test we would mock the LLM response, but here we can check the logic flow.

// We need to spy on systemBus.emit
const originalEmit = systemBus.emit.bind(systemBus);
let eventEmitted = false;

systemBus.emit = (protocol: any, payload: any, source?: string) => {
    if (protocol === SystemProtocol.EPISTEMIC_GAP_DETECTED) {
        console.log("✅ EPISTEMIC GAP EVENT DETECTED!");
        console.log("Payload:", payload);
        eventEmitted = true;
    }
    originalEmit(protocol, payload, source);
};

async function verifyCuriosityEngine() {
    console.log("🧪 TESTING CURIOSITY ENGINE...");

    // We can't easily mock the private method 'synthesizePatterns' without access.
    // However, we can use the same logic as the previous test script to call it via 'any' cast
    // OR we can rely on the fact that we modified the code.

    // Let's assume the previous Unit Test approach:
    const dreamer = new DreamerService();

    // Mock synthesizePatterns to return a MYSTERY outcome
    (dreamer as any).synthesizePatterns = async () => {
        return {
            content: "Why do we sleep?",
            veracity: 55, // 40-84 range => MYSTERY
            outcome: 'MYSTERY'
        };
    };

    // Trigger Attempt Dream (mocking dependencies)
    // We need to mock gatherDayResidue to return something valid so it proceeds
    (dreamer as any).gatherDayResidue = async () => {
        return [
            { id: '1', content: 'sleep', timestamp: Date.now() },
            { id: '2', content: 'tired', timestamp: Date.now() }
        ];
    };

    // Mock resourceArbiter to allow dreaming
    const { resourceArbiter } = await import('../services/resourceArbiter');
    resourceArbiter.requestAdmission = async () => true;

    // Run
    await dreamer.attemptDream();

    if (eventEmitted) {
        console.log("\n[SUCCESS] Curiosity Engine is functional. Epistemic Gap detected and broadcasted.");
    } else {
        console.error("\n[FAILURE] Epistemic Gap event was NOT emitted.");
    }
}

verifyCuriosityEngine().catch(console.error);
