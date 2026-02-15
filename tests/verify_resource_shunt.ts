
import { actionExecutor } from '../services/actionExecutor';
import { resourceManager } from '../services/resourceManager';
import { ActionType } from '../types';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

async function verifyResourceShunt() {
    console.log("🔋 Starting Resource Shunt Verification...");

    // 1. Listen for Shunt Events
    systemBus.subscribe(SystemProtocol.RESOURCE_SHUNT, (event) => {
        console.log(`[EVENT] Resource Shunt: ${event.payload.status} - ${event.payload.message || ''}`);
    });

    // 2. Initial State Check
    console.log(`Current Owner: ${resourceManager.getCurrentOwner()}`); // Should be LLM

    // 3. Trigger Video Generation Action
    console.log("🚀 Triggering GENERATE_VIDEO Action...");
    const result = await actionExecutor.execute({
        id: 'test-vid-1',
        agentId: 'tester',
        type: ActionType.GENERATE_VIDEO,
        payload: { prompt: "A cyberpunk city raining neon" },
        status: 'PENDING',
        timestamp: Date.now(),
        requiresApproval: false
    });

    // 4. Verify Result
    if (result.success) {
        console.log("✅ Video Action Success:", result.data);
    } else {
        console.error("❌ Video Action Failed:", result.error);
    }

    // 5. Final State Check
    console.log(`Final Owner: ${resourceManager.getCurrentOwner()}`); // Should be LLM

    if (resourceManager.getCurrentOwner() === 'LLM') {
        console.log("✅ SUCCESS: Resources restored to LLM.");
    } else {
        console.error("❌ FAILURE: Resources stuck on VIDEO.");
    }
}

verifyResourceShunt().catch(console.error);
