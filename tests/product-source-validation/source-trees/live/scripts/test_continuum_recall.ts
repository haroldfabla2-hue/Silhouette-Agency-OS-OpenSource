
import { continuum } from '../services/continuumMemory';
import { semanticMemory } from '../services/semanticMemory';
import { configureGenAI } from '../services/geminiService';

// dotenv removed - use --env-file=.env.local flag


const API_KEY = process.env.GEMINI_API_KEY;
if (API_KEY) configureGenAI(API_KEY);

async function runTest() {
    console.log("🧪 Testing Continuum Semantic Recall...");

    // 1. Ensure Qdrant is ready
    console.log("   (Checking Qdrant Connection...)");
    try {
        await semanticMemory.recall("test", 1);
        console.log("   ✅ Qdrant Connected.");
    } catch (e) {
        console.error("   ❌ Qdrant Connection Failed:", e);
        return;
    }

    // 2. Test Retrieval (Spanish Query for English Memory)
    const query = "Proyecto Chronos";
    console.log(`\n   🔍 Searching for: "${query}"...`);

    try {
        const results = await continuum.retrieve(query);

        console.log(`   📊 Found ${results.length} results.`);

        const match = results.find(n => n.content.includes("Chronos"));

        if (match) {
            console.log("   ✅ SUCCESS: Found 'Project Chronos' via Semantic Search!");
            console.log("   📝 Content:", match.content);
            console.log("   🏷️  Tags:", match.tags);
            console.log("   🔢 Score/Importance:", match.importance);
        } else {
            console.error("   ❌ FAILURE: Did not find 'Project Chronos'.");
            console.log("   Top results:", results.map(r => r.content.substring(0, 50)));
        }

    } catch (e) {
        console.error("   ❌ Retrieval Error:", e);
    }
}

runTest();
