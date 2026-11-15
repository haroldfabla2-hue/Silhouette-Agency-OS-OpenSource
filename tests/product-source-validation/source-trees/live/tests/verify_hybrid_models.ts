
import { ollamaService } from '../services/ollamaService';

async function main() {
    console.log("🔍 Verifying Hybrid Local Architecture...");

    try {
        // 1. Test Fast Tier (Llama 3.2)
        console.log("\n⚡ Testing Fast Tier (Llama 3.2)...");
        const fastStart = Date.now();
        const fastResponse = await ollamaService.generateCompletion("Why is the sky blue?", [], 'fast');
        const fastTime = Date.now() - fastStart;
        console.log(`✅ Fast Tier Response (${fastTime}ms):`, fastResponse.substring(0, 100) + "...");

        // 2. Test Legacy Tier (Mamba)
        console.log("\n🐍 Testing Legacy Tier (Mamba)...");
        const legacyStart = Date.now();
        const legacyResponse = await ollamaService.generateCompletion("What comes after 1?", [], 'legacy');
        const legacyTime = Date.now() - legacyStart;
        console.log(`✅ Legacy Tier Response (${legacyTime}ms):`, legacyResponse.substring(0, 100) + "...");

        // 3. Test Smart Tier (GLM-4) - MIGHT FAIL if not installed
        console.log("\n🧠 Testing Smart Tier (GLM-4)...");
        console.log("NOTE: This requires 'ollama run glm4' to be installed.");
        const smartStart = Date.now();
        const smartResponse = await ollamaService.generateCompletion("Explain quantum entanglement briefly.", [], 'smart');
        const smartTime = Date.now() - smartStart;
        console.log(`✅ Smart Tier Response (${smartTime}ms):`, smartResponse.substring(0, 100) + "...");

    } catch (error: any) {
        console.error("\n❌ Error during verification:", error.message);
        if (error.message.includes("model 'glm4' not found")) {
            console.log("\n💡 TIP: It seems GLM-4 is not installed. Run 'ollama run glm4' to install it.");
        }
    }

    process.exit(0);
}

main();
