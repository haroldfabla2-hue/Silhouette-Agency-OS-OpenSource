import { ollamaService } from '../services/ollamaService';

async function main() {
    console.log("🔍 Verifying Robust Ollama Architecture...");

    // 1. Initialize Service (Checks Connection)
    console.log("1️⃣  Initializing Service...");
    await ollamaService.initialize();

    // 2. Test Status
    const isOnline = await ollamaService.checkStatus();
    console.log(`2️⃣  Status Check: ${isOnline ? "ONLINE 🟢" : "OFFLINE 🔴"}`);

    if (!isOnline) {
        console.error("❌ Ollama is offline. Ensure 'ollama serve' is running.");
        process.exit(1);
    }

    // 3. Test Queue & Worker (Generation)
    console.log("3️⃣  Testing Queue (Gridlock Solver)...");
    const prompt = "Explain the concept of 'queue' in 10 words.";
    console.log(`   📝 Prompt: "${prompt}"`);

    try {
        const start = Date.now();
        const response = await ollamaService.generateCompletion(prompt);
        const duration = Date.now() - start;

        console.log(`   ✅ Response Received in ${duration}ms:`);
        console.log(`   💬 "${response.trim()}"`);
    } catch (e: any) {
        console.error("   ❌ Queue Test Failed:", e.message);
    }

    // 4. Test Embedding
    console.log("4️⃣  Testing Embedding...");
    try {
        const embedding = await ollamaService.generateEmbedding("Hello robust world");
        console.log(`   ✅ Embedding Generated. Dimensions: ${embedding.length}`);
    } catch (e: any) {
        console.error("   ❌ Embedding Failed (Make sure nomic-embed-text is pulled):", e.message);
    }

    console.log("🏁 Verification Complete.");
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
