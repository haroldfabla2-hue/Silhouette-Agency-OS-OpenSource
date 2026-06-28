
import { toolHandler } from '../services/tools/toolHandler';

async function verifyTools() {
    console.log("🔍 Verifying Agent Tools...");

    // Test 1: List Visual Assets (Mock)
    console.log("\n[TEST 1] Testing list_visual_assets...");
    try {
        const result = await toolHandler.handleFunctionCall('list_visual_assets', { filter_type: 'all', limit: 2 });
        console.log("✅ List Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("❌ List Failed:", e);
    }

    // Test 2: Generate Video (Validation Check - should fail or queue local)
    console.log("\n[TEST 2] Testing generate_video (Validation)...");
    try {
        // Missing prompt
        const errorResult = await toolHandler.handleFunctionCall('generate_video', {});
        console.log("✅ Validation Result (Expected Error):", errorResult);
    } catch (e) {
        console.error("❌ Validation Test Failed:", e);
    }

    console.log("\n[TEST 3] Testing generate_video (Queueing)...");
    try {
        const queueResult = await toolHandler.handleFunctionCall('generate_video', {
            prompt: "Test video generation",
            engine: "WAN"
        });
        console.log("✅ Queue Result:", queueResult);
    } catch (e) {
        console.error("❌ Queue Test Failed:", e);
    }
}

verifyTools().catch(console.error);
