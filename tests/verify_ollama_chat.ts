
import { ollamaService } from "../services/ollamaService";

async function verifyOllamaChat() {
    console.log("🧪 VERIFYING OLLAMA CHAT & MEMORY RETENTION");

    // 1. Define a Conversation History that requires memory
    const messages = [
        { role: 'system', content: "You are a precise data retrieval assistant." },
        { role: 'user', content: "My secret codename is 'OMEGA-7'." },
        { role: 'assistant', content: "Understood. I have recorded your codename as OMEGA-7." },
        { role: 'user', content: "What is my secret codename? Answer with just the codename." }
    ];

    console.log("📝 Input Messages:", JSON.stringify(messages, null, 2));
    console.log("⏳ Streaming response from Local Brain (Ollama)...");

    try {
        const stream = ollamaService.generateChatStream(messages, 'llama3.2:light');
        let fullResponse = "";

        for await (const chunk of stream) {
            process.stdout.write(chunk);
            fullResponse += chunk;
        }

        console.log("\n\n✅ Stream Complete.");

        // 2. Verification
        if (fullResponse.includes("OMEGA-7")) {
            console.log("✅ SUCCESS: Memory Retained. The model correctly recalled the codename.");
        } else {
            console.error("❌ FAILURE: Amnesia detected. The model did not recall the codename.");
            process.exit(1);
        }

    } catch (error) {
        console.error("❌ ERROR:", error);
        process.exit(1);
    }
}

verifyOllamaChat();
