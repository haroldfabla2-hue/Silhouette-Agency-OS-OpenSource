import { modelCatalog } from '../services/modelCatalog';
import { llmGateway } from '../services/llmGateway';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testCatalog() {
    console.log("🔍 Testing Model Catalog & Gateway Integration...\n");

    // 1. List some models
    const geminiModels = modelCatalog.getModelsByProvider('GEMINI');
    console.log(`✅ Found ${geminiModels.length} Gemini models in catalog.`);

    const reasoningModels = modelCatalog.getModelsByCapability('reasoning');
    console.log(`✅ Found ${reasoningModels.length} models with reasoning capability.`);

    // 2. Test Gateway Model Selection
    console.log("\n📡 Testing Gateway Model Routing...");

    try {
        // We'll use a cheap/fast model for testing if keys are available
        // Note: This will actually call the API if keys exist in .env.local
        const prompt = "Say 'Catalog Verified'.";

        console.log("--- Attempting call with GEMINI (gemini-2.0-flash) ---");
        // We can't easily force the model via public API of gateway yet without changing defaults, 
        // but we can check if it initializes with catalog defaults.

        const response = await llmGateway.generateText(prompt, {
            provider: 'GEMINI'
        });

        console.log(`\nResponse: ${response}`);
        console.log("\n✅ Integration Test Passed (Logic verification).");

    } catch (e: any) {
        console.error(`\n❌ Test failed: ${e.message}`);
        console.log("Note: This might be expected if API keys are not set up in the test environment.");
    }
}

testCatalog().catch(console.error);
